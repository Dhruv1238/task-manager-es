/**
 * Two-phase sandbox seeder.
 *
 *   Phase A (pre-wizard) — runs immediately after first-entry auth resolves.
 *   Writes the bare minimum so the visitor lands deterministically on the org
 *   wizard rather than on a half-broken dashboard. Idempotent: re-running it
 *   for a returning visitor is a no-op.
 *
 *   Phase B (post-wizard, "rich seed") — runs after `setupCompleted: true`
 *   AND `activeWorkflowIds.length > 0`. Drops a populated tenant on top of the
 *   visitor's wizard choices: sample personas + a few demo projects with
 *   stage history. Sets `_meta.richSeedCompleted: true` to prevent re-runs.
 *
 *  Both phases are pure client-side; no Cloud Functions.
 */

import {
  arrayUnion,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { IS_SANDBOX, computeAccessKeys, tenantCol, tenantDoc } from './firestore'
import { captureEntry } from './leadCapture'
import { COLLAB_DEFAULT_WORKFLOW_ID, seedCollabWorkflow } from './seedCollabWorkflow'
import type { OrgStructure } from '../types/models'
import type { PersonaArchetype, SandboxMeta } from '../types/sandbox'

// --- Phase A ----------------------------------------------------------------

export async function runPhaseA(opts: { uid: string; email: string; name?: string }): Promise<void> {
  if (!IS_SANDBOX) return
  const metaRef = tenantDoc('_meta', 'main')
  const existing = await getDoc(metaRef)
  if (existing.exists()) {
    // Returning visitor in the same browser — bump lastSeen + sessions count.
    // Also opportunistically backfill the name if we have one now and didn't
    // capture it on first entry (e.g. user signed in with Google this time).
    const data = existing.data() as Partial<SandboxMeta>
    const updates: Record<string, unknown> = {
      lastSeenAt: serverTimestamp(),
      sessionsCount: (data.sessionsCount ?? 1) + 1,
    }
    if (opts.name && !data.visitor?.name) {
      updates['visitor.name'] = opts.name
    }
    const batch = writeBatch(db)
    batch.update(metaRef, updates)
    await batch.commit()
    return
  }

  // First entry: write _meta + the placeholder org/workflow docs so the
  // wizards trip on the right state.
  const batch = writeBatch(db)
  const now = Timestamp.now()
  const meta: SandboxMeta = {
    visitorUid: opts.uid,
    createdAt: now,
    lastSeenAt: now,
    sessionsCount: 1,
    richSeedCompleted: false,
    visitor: { email: opts.email, ...(opts.name ? { name: opts.name } : {}) },
    contactCapture: {
      entry: true,
      firstAction: false,
      engagement: false,
      deepIntent: false,
      exitIntent: false,
    },
    entryMode: null,
    engagement: {
      totalActiveSeconds: 0,
      lastActiveAt: now,
      actionsCompleted: [],
    },
    dismissedHints: {},
  }
  batch.set(metaRef, meta)

  // Placeholder org structure: setupCompleted=false so the org wizard fires
  // on dashboard mount.
  batch.set(tenantDoc('config', 'orgStructure'), {
    version: 0,
    updatedAt: serverTimestamp(),
    updatedBy: opts.uid,
    leadRoleName: 'Vertical Head',
    teamRoles: { hasCoordinator: false, hasValidator: false, hasSpecialist: false },
    workTypes: [],
    allotment: { mode: 'manual' },
    setupCompleted: false,
  })

  // Empty workflow registry so the workflow wizard fires after the org wizard.
  batch.set(tenantDoc('workflows', '_registry'), {
    version: 0,
    updatedAt: serverTimestamp(),
    updatedBy: opts.uid,
    activeWorkflowIds: [],
    defaultWorkflowId: null,
  })

  // Bootstrap the visitor's user doc as super_admin so they own this sandbox.
  const displayName = opts.name?.trim() || opts.email.split('@')[0] || 'You'
  batch.set(tenantDoc('users', opts.uid), {
    uid: opts.uid,
    email: opts.email,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    globalRole: 'super_admin',
    teamIds: [],
    createdAt: serverTimestamp(),
  })

  await batch.commit()

  // Write the stage-1 lead doc at top-level /leads/{uid}. Not part of the
  // tenant-prefixed batch — different security-rule scope.
  await captureEntry({ uid: opts.uid, email: opts.email, name: opts.name })
}

// --- Phase B ----------------------------------------------------------------

const PERSONAS: PersonaArchetype[] = [
  {
    uid: 'persona-vh-primary',
    displayName: 'Aarti Sharma',
    email: 'aarti@sandbox.local',
    globalRole: 'admin',
    roleChip: 'VH',
  },
  {
    uid: 'persona-cs-lead',
    displayName: 'Priya Iyer',
    email: 'priya@sandbox.local',
    globalRole: 'user',
    teamHint: 'coordinator',
    roleChip: 'CS Lead',
  },
  {
    uid: 'persona-ct-lead',
    displayName: 'Rohan Das',
    email: 'rohan@sandbox.local',
    globalRole: 'user',
    teamHint: 'validator',
    roleChip: 'CT Lead',
  },
  {
    uid: 'persona-designer-2d',
    displayName: 'Sneha Patel',
    email: 'sneha@sandbox.local',
    globalRole: 'user',
    teamHint: 'specialist',
    roleChip: 'Designer',
  },
  {
    uid: 'persona-hl',
    displayName: 'Devika Rao',
    email: 'devika@sandbox.local',
    globalRole: 'horizontal_lead',
    roleChip: 'HL',
  },
]

interface RichSeedContext {
  uid: string
  org: OrgStructure
}

/** True iff the metadata indicates rich seed should run. */
export async function shouldRunPhaseB(): Promise<boolean> {
  if (!IS_SANDBOX) return false
  const metaSnap = await getDoc(tenantDoc('_meta', 'main'))
  if (!metaSnap.exists()) return false
  const meta = metaSnap.data() as SandboxMeta
  if (meta.richSeedCompleted) return false

  const orgSnap = await getDoc(tenantDoc('config', 'orgStructure'))
  const org = orgSnap.data() as OrgStructure | undefined
  if (!org?.setupCompleted) return false

  const regSnap = await getDoc(tenantDoc('workflows', '_registry'))
  const reg = regSnap.data() as { activeWorkflowIds?: string[] } | undefined
  if (!reg?.activeWorkflowIds || reg.activeWorkflowIds.length === 0) return false

  return true
}

export async function runPhaseB(): Promise<void> {
  if (!IS_SANDBOX) return
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Phase B seed requires resolved auth')

  const orgSnap = await getDoc(tenantDoc('config', 'orgStructure'))
  if (!orgSnap.exists()) throw new Error('Phase B: org structure missing')
  const org = orgSnap.data() as OrgStructure

  const ctx: RichSeedContext = { uid, org }

  // Always seed the collab-default workflow as a guaranteed substrate so the
  // 60-second tour has the right stages/actions/personas to walk through —
  // regardless of which workflow the visitor activated in the wizard. Their
  // pick stays the default for new projects; collab-default is just always
  // available + activated alongside it. Sample projects pin to collab-default
  // so the tour's targets resolve.
  await seedCollabWorkflow(uid)
  await ensureCollabActivated(uid)

  await seedPersonas(ctx)
  await seedSampleProjects(ctx)

  // Flip the gate so we never re-seed.
  const batch = writeBatch(db)
  batch.update(tenantDoc('_meta', 'main'), {
    richSeedCompleted: true,
    lastSeenAt: serverTimestamp(),
  })
  await batch.commit()
}

async function ensureCollabActivated(adminUid: string): Promise<void> {
  const regRef = tenantDoc('workflows', '_registry')
  const snap = await getDoc(regRef)
  const reg = (snap.exists() ? snap.data() : {}) as {
    activeWorkflowIds?: string[]
    defaultWorkflowId?: string | null
  }
  const active = reg.activeWorkflowIds ?? []
  if (active.includes(COLLAB_DEFAULT_WORKFLOW_ID)) return
  const batch = writeBatch(db)
  batch.update(regRef, {
    activeWorkflowIds: arrayUnion(COLLAB_DEFAULT_WORKFLOW_ID),
    // Don't change defaultWorkflowId — visitor's pick stays as the picker default.
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  })
  await batch.commit()
}

async function seedPersonas(_ctx: RichSeedContext): Promise<void> {
  // Read the visitor's actual teams (the wizard already created them); attach
  // personas to whichever team matches their hint. If no match, skip the team
  // assignment — the persona is still useful as an "Acting as" target.
  const teamsSnap = await getDocs(tenantCol('teams'))
  const teamsByRole = new Map<string, string>() // roleId → first matching teamId
  for (const t of teamsSnap.docs) {
    const data = t.data() as { teamRoleId?: string }
    if (data.teamRoleId && !teamsByRole.has(data.teamRoleId)) {
      teamsByRole.set(data.teamRoleId, t.id)
    }
  }

  const batch = writeBatch(db)
  for (const p of PERSONAS) {
    const teamId = p.teamHint ? teamsByRole.get(p.teamHint) : undefined
    batch.set(tenantDoc('users', p.uid), {
      uid: p.uid,
      email: p.email,
      displayName: p.displayName,
      displayNameLower: p.displayName.toLowerCase(),
      globalRole: p.globalRole,
      teamIds: teamId ? [teamId] : [],
      createdAt: serverTimestamp(),
    })
    // Add the persona to the team's memberIds so swimlanes/team views render.
    if (teamId) {
      batch.update(tenantDoc('teams', teamId), {
        memberIds: arrayUnion(p.uid),
      })
    }
  }
  await batch.commit()
}

async function seedSampleProjects(ctx: RichSeedContext): Promise<void> {
  // Always pin sample projects to collab-default. That workflow was just seeded
  // unconditionally in runPhaseB, so it's guaranteed to exist. This makes the
  // 60-second tour reachable regardless of which workflow the visitor picked.
  const workflowId = COLLAB_DEFAULT_WORKFLOW_ID
  const wfSnap = await getDoc(tenantDoc('workflows', workflowId))
  const workflow = wfSnap.exists() ? (wfSnap.data() as { stages?: Array<{ id: string; order: number }> }) : null
  const firstStageId = workflow?.stages?.slice().sort((a, b) => a.order - b.order)[0]?.id ?? 'intake'

  // Look up the visitor's team roster so we can attach a specialist team to
  // each project + assign tasks to personas that actually live on that team.
  // Best-effort: if the visitor configured a slimmer org (no specialist role),
  // tasks land without a teamId and still show up on the assignee's My Tasks.
  const teamsSnap = await getDocs(tenantCol('teams'))
  const teamsByRole = new Map<string, { id: string; name: string; leadId?: string }>()
  for (const t of teamsSnap.docs) {
    const data = t.data() as { teamRoleId?: string; name?: string; leadId?: string }
    if (data.teamRoleId && !teamsByRole.has(data.teamRoleId)) {
      teamsByRole.set(data.teamRoleId, { id: t.id, name: data.name ?? 'Team', leadId: data.leadId })
    }
  }
  const specialistTeam = teamsByRole.get('specialist')

  // Projects come first so we can refer to their ids when seeding tasks.
  // Diageo gets the specialist team attached + a designer-task plus a
  // CT-review task. The others stay sparse so the dashboard variety reads.
  const diageoId = cryptoRandomId()
  const adidasId = cryptoRandomId()
  const offsiteId = cryptoRandomId()

  // Phase 2d: per-project demo values for the collab-default roles
  // (admin_head / functional_head) + custom fields (lead_poc_name /
  // lead_category) so the new sidebar Roles + Details sections and the list
  // columns/filters render populated during the tour.
  const projects = [
    {
      id: diageoId,
      title: 'Diageo Q4 Activation Pitch',
      description:
        'On-trade activation pitch for the Diageo Q4 push. Premium-led creative, two TVC cuts + social, OOH for top-12 metros. Brief in, first-cut due before client review.',
      daysAgo: 9,
      withSpecialistTeam: true,
      poc: 'Anita Desai',
      category: 'indian',
    },
    {
      id: adidasId,
      title: 'Adidas Launch Event RFP',
      description:
        'RFP response for the Adidas footwear launch event. 800-pax flagship night + influencer activation. Looking for venue concept, run-of-show, and brand-aligned production design.',
      daysAgo: 3,
      withSpecialistTeam: true,
      poc: 'Marcus Lee',
      category: 'international',
    },
    {
      id: offsiteId,
      title: 'Internal team offsite plan',
      description:
        "Two-day Q1 offsite for the studio. Half-day strategy session, evening dinner + activity, hotel block of 35. Owned internally — no client review gates, but we're using the same workflow so planning stays tight.",
      daysAgo: 12,
      withSpecialistTeam: false,
      poc: 'Studio Ops',
      category: 'indian',
    },
  ] as const

  const batch = writeBatch(db)

  for (const p of projects) {
    const ref = tenantDoc('projects', p.id)
    const created = Timestamp.fromMillis(Date.now() - p.daysAgo * 86_400_000)
    const teamIds: string[] = p.withSpecialistTeam && specialistTeam ? [specialistTeam.id] : []
    // Phase 2d: assign the collab-default roles to personas so the demo shows
    // real people (and role-based visibility) — admin_head (single) to Aarti,
    // functional_head (multiple) to Rohan. accessKeys derives from these role
    // holders ∪ the attached team's lead ∪ the creator (team membership alone no
    // longer grants access — only the lead does).
    const roleAssignments: Record<string, string | string[]> = {
      admin_head: 'persona-vh-primary',
      functional_head: ['persona-ct-lead'],
    }
    const teamLeadIds: string[] =
      p.withSpecialistTeam && specialistTeam?.leadId ? [specialistTeam.leadId] : []
    const accessKeys = computeAccessKeys(roleAssignments, ctx.uid, null, teamLeadIds, [])
    batch.set(ref, {
      title: p.title,
      titleLower: p.title.toLowerCase(),
      description: p.description,
      ownerId: ctx.uid,
      createdBy: ctx.uid,
      status: 'in_progress',
      teamIds,
      accessKeys,
      roleAssignments,
      fields: { lead_poc_name: p.poc, lead_category: p.category },
      attachments: [],
      workflowId,
      currentStageId: firstStageId,
      leadUid: null,
      iterationCount: 0,
      escalationCount: 0,
      projectHistory: [
        {
          kind: 'workflow_assignment',
          workflowId,
          assignedAt: created,
          assignedBy: ctx.uid,
        },
        {
          kind: 'stage',
          stageId: firstStageId,
          enteredAt: created,
          enteredBy: ctx.uid,
          payload: null,
        },
      ],
      createdAt: created,
      updatedAt: created,
    })

    // Mirror the project onto the specialist team's projectIds so the team
    // views render correctly (denormalisation rule from §8).
    if (p.withSpecialistTeam && specialistTeam) {
      batch.update(tenantDoc('teams', specialistTeam.id), {
        projectIds: arrayUnion(p.id),
      })
    }
  }

  // Sample tasks — give Sneha real work to look at when the tour switches
  // perspective, and put a couple in Rohan's review queue. Without these,
  // /me looks empty after a persona switch and the demo falls flat.
  const sneha = PERSONAS.find((p) => p.uid === 'persona-designer-2d')!
  const rohan = PERSONAS.find((p) => p.uid === 'persona-ct-lead')!

  type TaskSeed = {
    title: string
    description: string
    projectId: string
    projectTitle: string
    assignee: typeof sneha
    status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked'
    priority: 'low' | 'medium' | 'high'
    reviewer?: typeof rohan
    dueInDays: number
    createdDaysAgo: number
  }

  // Each persona's /me screen tells a different story when the tour switches
  // perspective. Sneha sees a designer's mixed-status pile (active work +
  // pending review + a few queued + one shipped). Rohan's review queue lands
  // populated with a few items so the "Awaiting my review" section reads as
  // a real workload, not a single demo card. Statuses + due dates span the
  // full range so visitors see what overdue / today / upcoming actually look
  // like in the UI.
  const tasks: TaskSeed[] = []
  if (specialistTeam) {
    tasks.push(
      // --- Sneha's active work --------------------------------------------
      {
        title: 'Hero key visual — 1920×1080',
        description: 'Main launch hero — concept led by Aarti, executed by Sneha.',
        projectId: diageoId,
        projectTitle: 'Diageo Q4 Activation Pitch',
        assignee: sneha,
        status: 'in_progress',
        priority: 'high',
        dueInDays: 2,
        createdDaysAgo: 4,
      },
      {
        title: 'Social tile pack — IG + LinkedIn',
        description: '6 tiles for the launch teaser. Square + 4:5 crops.',
        projectId: diageoId,
        projectTitle: 'Diageo Q4 Activation Pitch',
        assignee: sneha,
        status: 'in_progress',
        priority: 'medium',
        dueInDays: 1,
        createdDaysAgo: 2,
      },
      // --- Sneha's queue (todo) -------------------------------------------
      {
        title: 'Mood board v2',
        description: 'Second-pass mood board reflecting Adidas brand brief.',
        projectId: adidasId,
        projectTitle: 'Adidas Launch Event RFP',
        assignee: sneha,
        status: 'todo',
        priority: 'medium',
        dueInDays: 5,
        createdDaysAgo: 1,
      },
      {
        title: 'Newsletter banner refresh',
        description: 'Quarterly newsletter masthead — keep with the new palette.',
        projectId: adidasId,
        projectTitle: 'Adidas Launch Event RFP',
        assignee: sneha,
        status: 'todo',
        priority: 'low',
        dueInDays: 7,
        createdDaysAgo: 0,
      },
      // --- Sneha → Rohan (in review, fills Rohan's queue) -----------------
      {
        title: 'Copy variants for launch — CT review',
        description: 'Three headline variants. Submitted for CT validation.',
        projectId: diageoId,
        projectTitle: 'Diageo Q4 Activation Pitch',
        assignee: sneha,
        status: 'in_review',
        priority: 'high',
        reviewer: rohan,
        dueInDays: -1,
        createdDaysAgo: 5,
      },
      {
        title: 'Storyboard sign-off — Diageo TVC',
        description: '8-frame storyboard. Needs CT validation before client share.',
        projectId: diageoId,
        projectTitle: 'Diageo Q4 Activation Pitch',
        assignee: sneha,
        status: 'in_review',
        priority: 'high',
        reviewer: rohan,
        dueInDays: 1,
        createdDaysAgo: 3,
      },
      {
        title: 'Mockup approval — Adidas banner pack',
        description: 'Final mockups for the in-store banner pack. Awaiting CT.',
        projectId: adidasId,
        projectTitle: 'Adidas Launch Event RFP',
        assignee: sneha,
        status: 'in_review',
        priority: 'medium',
        reviewer: rohan,
        dueInDays: 2,
        createdDaysAgo: 2,
      },
      // --- Sneha's done work (shows shipped state) ------------------------
      {
        title: 'Brand audit deck — Adidas',
        description: 'Initial brand audit deck. Delivered and approved.',
        projectId: adidasId,
        projectTitle: 'Adidas Launch Event RFP',
        assignee: sneha,
        status: 'done',
        priority: 'medium',
        dueInDays: -3,
        createdDaysAgo: 8,
      },
      // --- Sneha blocked (waiting on external input) ----------------------
      {
        title: 'Final logo lockup — Diageo',
        description: 'Holding for client-side legal sign-off on the new mark.',
        projectId: diageoId,
        projectTitle: 'Diageo Q4 Activation Pitch',
        assignee: sneha,
        status: 'blocked',
        priority: 'medium',
        dueInDays: 4,
        createdDaysAgo: 6,
      },
    )
  }

  for (const t of tasks) {
    const taskRef = tenantDoc('tasks', cryptoRandomId())
    const createdAt = Timestamp.fromMillis(Date.now() - t.createdDaysAgo * 86_400_000)
    const dueDate = Timestamp.fromMillis(Date.now() + t.dueInDays * 86_400_000)
    batch.set(taskRef, {
      projectId: t.projectId,
      teamId: specialistTeam!.id,
      parentTaskId: null,
      title: t.title,
      description: t.description,
      assigneeId: t.assignee.uid,
      assigneeName: t.assignee.displayName,
      status: t.status,
      priority: t.priority,
      dueDate,
      teamName: specialistTeam!.name,
      projectTitle: t.projectTitle,
      subtaskCount: 0,
      subtaskDoneCount: 0,
      attachments: [],
      reviewerId: t.reviewer?.uid ?? null,
      ...(t.reviewer ? { reviewerName: t.reviewer.displayName } : {}),
      createdBy: ctx.uid,
      createdAt,
      updatedAt: createdAt,
    })
  }

  await batch.commit()
}

function cryptoRandomId(): string {
  // Lightweight 20-char id, Firestore-friendly. Avoids importing nanoid.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 20; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}
