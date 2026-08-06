/**
 * One-shot accessKeys backfill — strips the retired hierarchy-role-actor
 * spray from every project's visibility array.
 *
 * Why: computeAccessKeys used to add every holder (by level inheritance) of
 * every `role`-kind actor a workflow referenced, so tenders were born with
 * ~46 uids — every Admin Head could see every other Admin Head's projects.
 * The spray is gone from computeAccessKeys; this rebuilds already-written
 * projects to the assignment-only set:
 *   createdBy ∪ leadUid ∪ assigned project-role holders
 *   ∪ attached-team leads ∪ task assignees.
 *
 * Bulk reads (one scan each of projects / teams / tasks) instead of the
 * per-project queries recomputeProjectAccessKeys does — N projects would
 * otherwise cost 2N queries. Idempotent: a project whose recomputed set
 * matches what's stored is skipped. Run from /admin/config → Migrations,
 * DRY RUN first — it writes nothing and reports what would change.
 */
import { getDocs, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import {
  computeAccessKeys,
  recordAuditEvent,
  tenantCol,
  tenantDoc,
} from './firestore'

const PROJECTS_PER_BATCH = 200

export interface BackfillAccessKeysChange {
  projectId: string
  title: string
  before: number
  after: number
}

export interface BackfillAccessKeysResult {
  totalScanned: number
  changed: number
  unchanged: number
  // Total uids removed across all projects (negative additions never happen —
  // a rebuild can only shrink or, rarely, repair a missing assignee).
  keysRemoved: number
  keysAdded: number
  batches: number
  dryRun: boolean
  // Every project whose keys would change, biggest reduction first.
  changes: BackfillAccessKeysChange[]
}

interface ProjectRow {
  id: string
  title?: string
  accessKeys?: string[]
  createdBy?: string
  ownerId?: string
  leadUid?: string | null
  roleAssignments?: Record<string, string | string[]>
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((k) => s.has(k))
}

export async function backfillAccessKeys(
  actorUid: string,
  opts?: { dryRun?: boolean },
): Promise<BackfillAccessKeysResult> {
  const dryRun = opts?.dryRun ?? true

  // One scan each — the whole tenant's join tables in memory.
  const [projectsSnap, teamsSnap, tasksSnap] = await Promise.all([
    getDocs(tenantCol('projects')),
    getDocs(tenantCol('teams')),
    getDocs(tenantCol('tasks')),
  ])

  // team leads per project (team.projectIds mirror → team.leadId)
  const teamLeadsByProject = new Map<string, string[]>()
  for (const d of teamsSnap.docs) {
    const t = d.data() as { leadId?: string; projectIds?: string[] }
    if (!t.leadId) continue
    for (const pid of t.projectIds ?? []) {
      const list = teamLeadsByProject.get(pid) ?? []
      list.push(t.leadId)
      teamLeadsByProject.set(pid, list)
    }
  }

  // task assignees per project
  const assigneesByProject = new Map<string, string[]>()
  for (const d of tasksSnap.docs) {
    const t = d.data() as { projectId?: string; assigneeId?: string | null }
    if (!t.projectId || !t.assigneeId) continue
    const list = assigneesByProject.get(t.projectId) ?? []
    list.push(t.assigneeId)
    assigneesByProject.set(t.projectId, list)
  }

  const changes: BackfillAccessKeysChange[] = []
  const writes: Array<{ projectId: string; accessKeys: string[] }> = []
  let keysRemoved = 0
  let keysAdded = 0

  for (const d of projectsSnap.docs) {
    const p = { id: d.id, ...(d.data() as Omit<ProjectRow, 'id'>) } as ProjectRow
    const next = computeAccessKeys(
      p.roleAssignments,
      p.createdBy ?? p.ownerId,
      p.leadUid ?? null,
      teamLeadsByProject.get(p.id) ?? [],
      assigneesByProject.get(p.id) ?? [],
    )
    const current = p.accessKeys ?? []
    if (sameSet(current, next)) continue

    const currentSet = new Set(current)
    const nextSet = new Set(next)
    keysRemoved += current.filter((k) => !nextSet.has(k)).length
    keysAdded += next.filter((k) => !currentSet.has(k)).length
    changes.push({
      projectId: p.id,
      title: p.title ?? p.id,
      before: current.length,
      after: next.length,
    })
    writes.push({ projectId: p.id, accessKeys: next })
  }

  // Biggest reduction first — the dry-run table leads with the worst offenders.
  changes.sort((a, b) => b.before - b.after - (a.before - a.after))

  let batches = 0
  if (!dryRun && writes.length) {
    for (let i = 0; i < writes.length; i += PROJECTS_PER_BATCH) {
      const chunk = writes.slice(i, i + PROJECTS_PER_BATCH)
      const batch = writeBatch(db)
      for (const w of chunk) {
        batch.update(tenantDoc('projects', w.projectId), { accessKeys: w.accessKeys })
      }
      batches += 1
      await batch.commit()
    }
    // Same convention as migrateProjectHistory: reuse the generic action id,
    // discriminate via payload.migration (AuditAction is a closed union).
    recordAuditEvent({
      actorId: actorUid,
      actorName: 'migration',
      action: 'project.action_performed',
      targetType: 'project',
      targetId: 'access-keys-backfill',
      payload: {
        migration: 'accessKeys',
        totalScanned: projectsSnap.size,
        changed: writes.length,
        keysRemoved,
        keysAdded,
      },
    })
  }

  return {
    totalScanned: projectsSnap.size,
    changed: writes.length,
    unchanged: projectsSnap.size - writes.length,
    keysRemoved,
    keysAdded,
    batches,
    dryRun,
    changes,
  }
}
