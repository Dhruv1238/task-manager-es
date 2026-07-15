/**
 * Central module for multi-document Firestore writes.
 *
 * Every function here owns the denormalization rules in TASK_MANAGEMENT_MVP.md §8 — use `writeBatch` so
 * primary writes and counter updates land atomically. Components MUST go through this module for any
 * write that touches more than one document.
 *
 * Signatures live here from Sprint 0; bodies are filled in by the sprint that needs them (see plan).
 */

import type {
  Attachment,
  AuditAction,
  AuditTargetType,
  GlobalRole,
  NotificationType,
  Project,
  ProjectStatus,
  Task,
  TaskKind,
  TaskLink,
  TaskLinkRelation,
  TaskPriority,
  TaskStatus,
  User,
  WorkType,
} from '../types/models'
import { childKind, effectiveKind } from './taskKind'
import { INVERSE_RELATION } from './taskLinks'
import type {
  DetailsUpdatedEvent,
  FieldUpdatedEvent,
  ProjectHistoryEvent,
  RoleAssignedEvent,
  StageEvent,
  Workflow,
  WorkflowAssignmentEvent,
} from '../types/workflow'
import { getWorkflowSnapshot, getRolesSnapshot, getOrgStructureSnapshot } from '../contexts/AppConfigContext'
import { getCurrentStage, performAction } from './workflowEvaluator'
import { executeOutcome } from './rules/executeOutcome'
import { readActors, readOutcomes } from './rules/outcomeAdapter'
import { computeEffectivePermissions, resolveRoleHolders } from './permissions/effectivePermissions'
import type { OrgStructure, Team } from '../types/models'
import type { RoleDef, EffectivePermissions } from '../types/v2'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase'

// --- Tenant routing helpers --------------------------------------------------
// Every Firestore reference in this codebase MUST go through tenantCol /
// tenantDoc (lint-enforced — see eslint-rules/no-direct-firestore-refs.js).
//
// In production builds (VITE_IS_SANDBOX !== 'true') these are a pass-through:
// the same top-level paths the app has always used (/projects, /workflows,
// /config/orgStructure, …) get returned verbatim.
//
// In sandbox builds they prepend `sandbox/{visitorUid}/...` to every path so
// each visitor's data is path-isolated under their own subtree. The security
// rules enforce that visitors can only read/write under their own uid.
//
// Two top-level paths are intentionally NOT tenant-prefixed in sandbox mode:
// /leads/{leadId} and /sandboxConfig/main. Those are written via raw `db` +
// firestore primitives, with an ESLint exemption for the specific callers.

export const IS_SANDBOX = import.meta.env.VITE_IS_SANDBOX === 'true'

function sandboxRoot(): readonly [string, string] | null {
  if (!IS_SANDBOX) return null
  const uid = auth.currentUser?.uid
  if (!uid) {
    throw new Error(
      'tenantCol/tenantDoc called before auth resolved in sandbox build — wait for AuthContext to settle first.',
    )
  }
  return ['sandbox', uid] as const
}

export function tenantCol(path: string, ...rest: string[]): CollectionReference {
  const root = sandboxRoot()
  // NOTE: these are the only `collection(db, ...)` / `doc(db, ...)` calls
  // permitted outside `db`. The ESLint rule has an exemption for this file.
  return root
    ? collection(db, root[0], root[1], path, ...rest)
    : collection(db, path, ...rest)
}

export function tenantDoc(path: string, ...rest: string[]): DocumentReference {
  const root = sandboxRoot()
  return root
    ? doc(db, root[0], root[1], path, ...rest)
    : doc(db, path, ...rest)
}

// --- Workflow action helper --------------------------------------------------
// Thin shim used by every stage modal. Reads the project's pinned workflow
// from the cached snapshot, then delegates to workflowEvaluator.performAction.
// Throws if the snapshot isn't available — the caller surfaces that as a "try
// refreshing" error.

export interface RunWorkflowActionInput {
  project: Project
  user: User
  actionId: string
  inputs: Record<string, unknown>
  // Optional caller-supplied denormalisations to merge onto the project doc
  // alongside the action's standard patch (e.g. eligibilityNote mirroring).
  extras?: Record<string, unknown>
  // Phase 3: the named outcome the actor selected (OutcomePicker). Only used for
  // actions that carry authored v2 `outcomes`; ignored on legacy actions.
  outcomeId?: string
  // Phase 3: resolution context for `role`-kind actors + the permission re-check
  // in executeOutcome. All optional — the UI already gated rendering.
  teams?: Team[]
  org?: OrgStructure
  roles?: RoleDef[]
  // The tenant user directory, so executeOutcome can recompute accessKeys with
  // `role`-actor holders + an assignment's target. Optional.
  users?: User[]
  effective?: EffectivePermissions | null
}

export async function runWorkflowAction(input: RunWorkflowActionInput): Promise<void> {
  if (!input.project.workflowId) {
    throw new Error(
      'This project has no workflow pinned — run the project-history migration under /admin/config first.',
    )
  }
  // Phase 2c: prefer the snapshot pinned on the project at creation. Workflow
  // edits never alter the behaviour of in-flight projects. The cached snapshot
  // is the fallback for projects that pre-date the pinning migration.
  const workflow =
    input.project.pinnedWorkflow ?? getWorkflowSnapshot(input.project.workflowId)
  if (!workflow) {
    throw new Error(
      `Workflow "${input.project.workflowId}" not loaded — refresh the page or ask an admin to seed it under /admin/config.`,
    )
  }

  // Phase 3 routing: actions authored with v2 `outcomes` run through the
  // outcome transaction; everything else (every seed / legacy doc) stays on the
  // proven performAction path, byte-for-byte unchanged.
  const stage = getCurrentStage(input.project, workflow)
  const action = stage.actions.find((a) => a.id === input.actionId)
  if (action?.outcomes?.length) {
    const outcomes = readOutcomes(action)
    const outcomeId = input.outcomeId ?? (outcomes.length === 1 ? outcomes[0].id : undefined)
    if (!outcomeId) {
      throw new Error(`Action "${action.label}" needs an outcome selection.`)
    }
    // Default the role-resolution context from the cached snapshots so callers
    // that don't thread it (e.g. ActionModal) still resolve `role`-kind actors.
    const roles = input.roles ?? getRolesSnapshot()
    const effective =
      input.effective ?? computeEffectivePermissions(input.user, roles)
    await executeOutcome({
      project: input.project,
      workflow,
      user: input.user,
      actionId: input.actionId,
      outcomeId,
      inputs: input.inputs,
      teams: input.teams,
      org: input.org ?? getOrgStructureSnapshot(),
      roles,
      users: input.users,
      effective,
      extras: input.extras,
    })
    return
  }

  await performAction({
    project: input.project,
    workflow,
    user: input.user,
    actionId: input.actionId,
    inputs: input.inputs,
    extras: input.extras,
    users: input.users,
  })
}

// --- Phase 3: simple project subtasks ----------------------------------------
// A flat work item under /projects/{id}/subtasks/{sid}. Distinct from the
// task-level `addSubtask` (which writes /tasks with parentTaskId). No recursion.
// Every ref goes through tenantCol/tenantDoc so sandbox path-isolation holds.

export interface AddSubtaskItemInput {
  projectId: string
  title: string
  assigneeId?: string
  dueDate?: string
  parentStageId?: string
  createdBy: string
}

export async function addSubtaskItem(input: AddSubtaskItemInput): Promise<string> {
  const ref = doc(tenantCol('projects', input.projectId, 'subtasks'))
  await setDoc(ref, {
    title: input.title,
    status: 'todo',
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.parentStageId ? { parentStageId: input.parentStageId } : {}),
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateSubtaskItem(
  projectId: string,
  subtaskId: string,
  patch: Partial<{ title: string; status: string; assigneeId: string | null; dueDate: string | null }>,
): Promise<void> {
  await setDoc(tenantDoc('projects', projectId, 'subtasks', subtaskId), patch, { merge: true })
}

export async function deleteSubtaskItem(projectId: string, subtaskId: string): Promise<void> {
  await deleteDoc(tenantDoc('projects', projectId, 'subtasks', subtaskId))
}

// --- Audit trail -------------------------------------------------------------
// Forensic-only append-only collection. Every multi-doc helper threads the
// caller's actor identity (uid + display name) and writes an `auditEvents`
// doc inside the same writeBatch — so the audit record either lands with the
// primary write or rolls back with it. No UI surfacing yet.

export interface RecordAuditEventInput {
  actorId: string
  actorName: string
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  targetTitle?: string
  projectId?: string
  teamId?: string
  payload?: Record<string, unknown>
  // When provided, the audit doc joins the caller's batch so it's atomic
  // with the primary write. When omitted, the helper commits a standalone write.
  batch?: WriteBatch
}

export function recordAuditEvent(input: RecordAuditEventInput): Promise<void> | void {
  const ref = doc(tenantCol('auditEvents'))
  const data = {
    actorId: input.actorId,
    actorName: input.actorName,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.targetTitle ? { targetTitle: input.targetTitle } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    createdAt: serverTimestamp(),
  }
  // Sandbox: mirror the action name into engagement.actionsCompleted so the
  // capture coordinator can react and the lead doc receives an up-to-date
  // signal. Dead-code-eliminated in production builds.
  if (__IS_SANDBOX__) {
    void import('./engagement').then((m) => {
      void m.recordAction(input.action).catch(() => {})
    })
  }
  if (input.batch) {
    input.batch.set(ref, data)
    return
  }
  return setDoc(ref, data)
}

// --- Notifications (features.notifications) ----------------------------------
// In-app fan-out. Joins the triggering mutation's batch so the notification is
// atomic with the action. Write-always: we never read the recipient's prefs
// here (that would mean N extra reads + races) — each client filters by its own
// notificationPrefs at display time, making mutes retroactive (Discord-style).
export interface QueueNotificationInput {
  recipientId: string
  type: NotificationType
  actorId: string
  actorName: string
  taskId: string
  projectId: string
  taskTitle: string
  snippet?: string
}

export function queueNotification(batch: WriteBatch, input: QueueNotificationInput): void {
  // Never notify someone about their own action.
  if (input.recipientId === input.actorId) return
  // NOTE: intentionally NOT gated on isFeatureEnabled here. That gate read the
  // writer's *cached* appConfig, so a client with a stale cache (e.g. one that
  // loaded before an admin enabled notifications) would silently write nothing —
  // the recipient never got notified. Display is already gated (the bell only
  // renders when the feature is on), so always writing is safe; when the feature
  // is off the docs are simply never shown and get pruned.
  const ref = doc(tenantCol('notifications'))
  batch.set(ref, {
    recipientId: input.recipientId,
    type: input.type,
    actorId: input.actorId,
    actorName: input.actorName,
    taskId: input.taskId,
    projectId: input.projectId,
    taskTitle: input.taskTitle,
    ...(input.snippet ? { snippet: input.snippet } : {}),
    resolved: false,
    createdAt: serverTimestamp(),
  })
}

// Fan out one notification per recipient in the set, minus the actor. Used by
// status-change paths where creator + assignee may both need notifying.
function queueNotificationFanout(
  batch: WriteBatch,
  recipients: (string | null | undefined)[],
  base: Omit<QueueNotificationInput, 'recipientId'>,
): void {
  const set = new Set<string>()
  for (const r of recipients) {
    if (r && r !== base.actorId) set.add(r)
  }
  for (const recipientId of set) {
    queueNotification(batch, { ...base, recipientId })
  }
}

// Mark specific notifications resolved/unresolved (per-row toggle). Chunks at
// the 500-op batch limit.
export async function resolveNotifications(ids: string[], resolved = true): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + 500)) {
      batch.update(tenantDoc('notifications', id), { resolved })
    }
    await batch.commit()
  }
}

// "Mark all as resolved" — resolves every unresolved notification for the user.
// Queries by recipientId only (single-field index) and filters unresolved
// client-side, so no extra composite index is needed.
export async function resolveAllNotifications(uid: string): Promise<void> {
  const snap = await getDocs(query(tenantCol('notifications'), where('recipientId', '==', uid)))
  const docs = snap.docs.filter((d) => (d.data() as { resolved?: boolean }).resolved !== true)
  for (let i = 0; i < docs.length; i += 500) {
    const batch = writeBatch(db)
    for (const d of docs.slice(i, i + 500)) batch.update(d.ref, { resolved: true })
    await batch.commit()
  }
}

// Best-effort prune of the viewer's notifications older than 30 days. No TTL
// without Cloud Functions, so this runs fire-and-forget on panel open. Queries
// by recipientId only (single-field index) and filters by age client-side, so
// the notifications collection needs no composite index at all. Swallows errors.
export async function pruneOldNotifications(uid: string): Promise<void> {
  try {
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000
    const snap = await getDocs(query(tenantCol('notifications'), where('recipientId', '==', uid)))
    const old = snap.docs.filter((d) => {
      const ts = (d.data() as { createdAt?: Timestamp }).createdAt
      return ts?.toMillis ? ts.toMillis() < cutoffMs : false
    })
    for (let i = 0; i < old.length; i += 500) {
      const batch = writeBatch(db)
      for (const d of old.slice(i, i + 500)) batch.delete(d.ref)
      await batch.commit()
    }
  } catch {
    // ignore — pruning is opportunistic
  }
}

// --- Teams (Sprint 2 — Flow 1) -------------------------------------------------

export interface AddTeamInput {
  name: string
  description?: string
  leadId: string
  memberIds: string[]
  createdBy: string
  actorName: string
}

export async function addTeam(input: AddTeamInput): Promise<string> {
  const batch = writeBatch(db)
  const teamRef = doc(tenantCol('teams'))

  batch.set(teamRef, {
    name: input.name,
    description: input.description ?? '',
    leadId: input.leadId,
    memberIds: input.memberIds,
    projectIds: [],
    createdAt: serverTimestamp(),
    createdBy: input.createdBy,
  })

  for (const uid of input.memberIds) {
    batch.update(tenantDoc('users', uid), {
      teamIds: arrayUnion(teamRef.id),
    })
  }

  recordAuditEvent({
    actorId: input.createdBy,
    actorName: input.actorName,
    action: 'team.created',
    targetType: 'team',
    targetId: teamRef.id,
    targetTitle: input.name,
    teamId: teamRef.id,
    payload: { leadId: input.leadId, memberCount: input.memberIds.length },
    batch,
  })
  for (const uid of input.memberIds) {
    recordAuditEvent({
      actorId: input.createdBy,
      actorName: input.actorName,
      action: 'team.member_added',
      targetType: 'team',
      targetId: teamRef.id,
      targetTitle: input.name,
      teamId: teamRef.id,
      payload: { memberUid: uid },
      batch,
    })
  }

  await batch.commit()
  return teamRef.id
}

export interface AddMemberToTeamInput {
  teamId: string
  uid: string
  actorId: string
  actorName: string
  teamName: string
  memberName?: string
}

export async function addMemberToTeam(input: AddMemberToTeamInput): Promise<void> {
  const batch = writeBatch(db)
  batch.update(tenantDoc('teams', input.teamId), { memberIds: arrayUnion(input.uid) })
  batch.update(tenantDoc('users', input.uid), { teamIds: arrayUnion(input.teamId) })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'team.member_added',
    targetType: 'team',
    targetId: input.teamId,
    targetTitle: input.teamName,
    teamId: input.teamId,
    payload: { memberUid: input.uid, ...(input.memberName ? { memberName: input.memberName } : {}) },
    batch,
  })
  await batch.commit()
}

export interface RemoveMemberFromTeamInput {
  teamId: string
  uid: string
  actorId: string
  actorName: string
  teamName: string
  memberName?: string
}

export async function removeMemberFromTeam(input: RemoveMemberFromTeamInput): Promise<void> {
  const batch = writeBatch(db)
  batch.update(tenantDoc('teams', input.teamId), { memberIds: arrayRemove(input.uid) })
  batch.update(tenantDoc('users', input.uid), { teamIds: arrayRemove(input.teamId) })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'team.member_removed',
    targetType: 'team',
    targetId: input.teamId,
    targetTitle: input.teamName,
    teamId: input.teamId,
    payload: { memberUid: input.uid, ...(input.memberName ? { memberName: input.memberName } : {}) },
    batch,
  })
  await batch.commit()
}

// Set a team's lead. Ensures the new lead is in the team's memberIds and that
// the user doc reflects the team membership (idempotent — safe to call when
// they're already a member).
export interface SetTeamLeadInput {
  teamId: string
  newLeadUid: string
  actorId: string
  actorName: string
  teamName: string
  fromLeadId?: string
}

export async function setTeamLead(input: SetTeamLeadInput): Promise<void> {
  const batch = writeBatch(db)
  batch.update(tenantDoc('teams', input.teamId), {
    leadId: input.newLeadUid,
    memberIds: arrayUnion(input.newLeadUid),
  })
  batch.update(tenantDoc('users', input.newLeadUid), {
    teamIds: arrayUnion(input.teamId),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'team.lead_changed',
    targetType: 'team',
    targetId: input.teamId,
    targetTitle: input.teamName,
    teamId: input.teamId,
    payload: {
      ...(input.fromLeadId ? { fromLeadId: input.fromLeadId } : {}),
      toLeadId: input.newLeadUid,
    },
    batch,
  })
  await batch.commit()

  // A lead change flips access on every project this team is attached to: the
  // old lead loses access (unless still a role-holder / assignee / creator /
  // pinned lead) and the new lead gains it. Recompute AFTER the commit so the
  // teams-by-projectId read inside recomputeProjectAccessKeys reflects the new
  // leadId. Chunk the project writes to stay under the 500-op batch limit.
  const teamSnap = await getDoc(tenantDoc('teams', input.teamId))
  const projectIds = teamSnap.exists()
    ? ((teamSnap.data() as { projectIds?: string[] }).projectIds ?? [])
    : []
  if (projectIds.length) {
    const recomputed = await Promise.all(
      projectIds.map(async (pid) => ({ pid, keys: await recomputeProjectAccessKeys(pid) })),
    )
    for (let i = 0; i < recomputed.length; i += 400) {
      const writeB = writeBatch(db)
      for (const { pid, keys } of recomputed.slice(i, i + 400)) {
        writeB.update(tenantDoc('projects', pid), { accessKeys: keys, updatedAt: serverTimestamp() })
      }
      await writeB.commit()
    }
  }
}

// --- Projects (Sprint 3 — Flow 2, Sprint 4 — Flow 3) ---------------------------

// The hierarchy-role ids referenced as actors anywhere in a workflow's actions
// (canonical actor + actors[] + alsoAllow, via the adapter). These are the roles
// whose holders must be able to SEE a project on this workflow to act on it.
function roleActorIdsOf(workflow: Workflow): string[] {
  const ids = new Set<string>()
  for (const stage of workflow.stages) {
    for (const action of stage.actions) {
      for (const actor of readActors(action).all) {
        if (actor.kind === 'role') ids.add(actor.roleId)
      }
    }
  }
  return [...ids]
}

// The single place the denormalised visibility array is built. As of the
// access-scoping change, `accessKeys` is a PURE SET OF USER UIDS — team
// membership is no longer an access vector. Access =
//   createdBy ∪ leadUid (vertical head) ∪ project-role holders
//   ∪ hierarchy-role-actor holders ∪ {lead of each attached team}
//   ∪ {assignee of each task in the project}.
// Because team membership no longer grants access, callers must resolve the
// attached teams' lead uids (`teamLeadIds`) and the project's task-assignee uids
// (`assigneeIds`) up front — see `recomputeProjectAccessKeys`, which does those
// reads. This function stays pure/synchronous so seeds and tests can call it
// directly. Powers the non-admin `array-contains <uid>` query on the projects
// list + ProjectPicker, and the chat gate.
export function computeAccessKeys(
  roleAssignments: Record<string, string | string[]> | undefined,
  createdBy: string | undefined,
  // The pinned project lead (vertical head). Folded in here — NOT threaded per
  // call site — so every recompute keeps the VH visible (they previously relied
  // on a client-only fallback and were invisible in the server-queried picker).
  leadUid: string | null | undefined,
  // Resolved lead uids of every team attached to the project (replaces the old
  // raw teamIds union that leaked whole-team access).
  teamLeadIds: string[],
  // Resolved assignee uids of every task in the project (any status).
  assigneeIds: string[],
  // Phase 3.6: when supplied, also enumerate the holders of every `role`-kind
  // actor referenced by the workflow so hierarchy-role-gated projects are
  // visible to (and routable for) their holders. Omitted → not seeded.
  opts?: { workflow?: Workflow; users?: User[]; roles?: RoleDef[] },
): string[] {
  const keys = new Set<string>()
  for (const v of Object.values(roleAssignments ?? {})) {
    if (Array.isArray(v)) v.forEach((u) => u && keys.add(u))
    else if (v) keys.add(v)
  }
  if (createdBy) keys.add(createdBy)
  if (leadUid) keys.add(leadUid)
  for (const id of teamLeadIds) if (id) keys.add(id)
  for (const id of assigneeIds) if (id) keys.add(id)
  if (opts?.workflow && opts.users?.length && opts.roles?.length) {
    for (const roleId of roleActorIdsOf(opts.workflow)) {
      for (const uid of resolveRoleHolders(roleId, opts.users, opts.roles)) keys.add(uid)
    }
  }
  return [...keys]
}

// Overrides for the field(s) the current operation is mutating. Each wins over
// the value read from the project doc. Use the `leadUid` key (even with a null
// value) to force-clear the lead; omit it to keep the doc's leadUid.
export interface RecomputeAccessKeysOverrides {
  roleAssignments?: Record<string, string | string[]>
  createdBy?: string
  leadUid?: string | null
  // Resolved team-lead uids to use instead of reading the teams back — needed
  // when the team.projectIds mirror is changing in the same op (setProjectTeams).
  teamLeadIds?: string[]
  // Hierarchy-role enrichment (optional → not seeded, matching prior behaviour).
  // There is no module-level users snapshot, so callers pass the directory;
  // roles falls back to getRolesSnapshot(), workflow to the project's pinned one.
  workflow?: Workflow
  users?: User[]
  roles?: RoleDef[]
}

// Rebuilds the full UID-only accessKeys for a project. Reads the project doc for
// baseline state (createdBy / leadUid / roleAssignments / pinnedWorkflow), its
// attached teams (→ each `leadId`), and its tasks (→ each `assigneeId`), then
// unions them via computeAccessKeys. `overrides` win over the doc for whatever
// the caller is mutating. A full rebuild is the ONLY correct way to REVOKE
// (team detached, role cleared, lead changed, task reassigned): a UID can't be
// blindly arrayRemove'd because it may still be justified by another path.
// All reads happen outside any write batch — `await` this, then stage the write.
// NB: callers that mutate the team-lead set or a task assignee should recompute
// AFTER committing that change (so the teams/tasks reads reflect it), or pass
// `teamLeadIds`.
export async function recomputeProjectAccessKeys(
  projectId: string,
  overrides?: RecomputeAccessKeysOverrides,
): Promise<string[]> {
  const projSnap = await getDoc(tenantDoc('projects', projectId))
  const proj = projSnap.exists()
    ? (projSnap.data() as {
        createdBy?: string
        ownerId?: string
        leadUid?: string | null
        roleAssignments?: Record<string, string | string[]>
        pinnedWorkflow?: Workflow
      })
    : {}

  const roleAssignments = overrides?.roleAssignments ?? proj.roleAssignments
  const createdBy = overrides?.createdBy ?? proj.createdBy ?? proj.ownerId
  const leadUid =
    overrides && 'leadUid' in overrides ? overrides.leadUid : proj.leadUid ?? null
  const workflow = overrides?.workflow ?? proj.pinnedWorkflow

  let teamLeadIds = overrides?.teamLeadIds
  if (!teamLeadIds) {
    const teamsSnap = await getDocs(
      query(tenantCol('teams'), where('projectIds', 'array-contains', projectId)),
    )
    teamLeadIds = teamsSnap.docs
      .map((d) => (d.data() as { leadId?: string }).leadId)
      .filter((id): id is string => Boolean(id))
  }
  const tasksSnap = await getDocs(query(tenantCol('tasks'), where('projectId', '==', projectId)))
  const assigneeIds = tasksSnap.docs
    .map((d) => (d.data() as { assigneeId?: string | null }).assigneeId)
    .filter((id): id is string => Boolean(id))

  return computeAccessKeys(roleAssignments, createdBy, leadUid, teamLeadIds, assigneeIds, {
    workflow,
    users: overrides?.users,
    roles: overrides?.roles ?? getRolesSnapshot(),
  })
}

export interface AddProjectInput {
  title: string
  description: string
  // Phase 2d: owner retired. createdBy is the audit + baseline-capability holder.
  createdBy: string
  actorName: string
  // Required for auto-allocation: the creator's global role + team
  // memberships. performAction's permission check looks these up to decide
  // whether the canonical actor on the workflow's first action matches.
  // Without them, a hardcoded `globalRole: 'user'` shim silently fails
  // permission for any action that requires 'super_admin' or 'admin' (e.g.
  // collab.allocate, sales.assign_to_rep).
  creatorRole: GlobalRole
  creatorTeamIds?: string[]
  // Required: the workflow this project pins to. New-project form supplies
  // it from the WorkflowPicker step (or auto-pins when only one workflow is
  // active).
  workflowId: string
  deadline?: Timestamp
  attachments?: Attachment[]
  // Phase 2d: per-role assignments collected on the create form (single → uid,
  // multiple → uid[]). Keyed by workflow.projectRoles[].id. accessKeys is
  // derived from these + createdBy.
  roleAssignments?: Record<string, string | string[]>
  // Phase 2d: custom-field values collected on the create form (createForm
  // surface). Keyed by workflow.projectFields.customFields[].id.
  fields?: Record<string, unknown>
  // Phase 3.6: the tenant user directory, so accessKeys can enumerate the
  // holders of any `role`-kind actor on the workflow at creation time. Optional
  // → when omitted, role-actor holders simply aren't pre-seeded (status quo).
  users?: User[]
  // Collaborative-flow fields. Only set when picked workflow's flowType is
  // 'collaborative' — the form's CollaborativeFields subcomponent surfaces
  // these inputs and omits them for other flow types.
  submissionDate?: Timestamp
  presentationDate?: Timestamp
  // Auto-allocation hook: when the picked workflow's first-stage first action
  // is an `assign_lead` and the form supplied a lead uid, the project is
  // created at stage 1 and then immediately advanced via performAction in the
  // same commit. Falsy → project lands at stage 1 awaiting allocation.
  initialAction?: {
    actionId: string
    inputs: Record<string, unknown>
  }
}

export async function addProject(input: AddProjectInput): Promise<string> {
  const workflow = getWorkflowSnapshot(input.workflowId)
  if (!workflow) {
    throw new Error(
      `Workflow "${input.workflowId}" not loaded — refresh the page or ask an admin to seed it under /admin/config.`,
    )
  }
  const orderedFirst = [...workflow.stages].sort((a, b) => a.order - b.order)[0]
  if (!orderedFirst) {
    throw new Error(`Workflow "${input.workflowId}" has no stages — cannot pin a project.`)
  }
  // Phase 3: prefer the author-set entry task; fall back to lowest-order stage.
  const firstStage =
    (workflow.entryStageId && workflow.stages.find((s) => s.id === workflow.entryStageId)) ||
    orderedFirst

  // Initial timeline events. Always start with the workflow_assignment marker
  // so the side panel renders "pinned to {workflowName} by {creator}". Add the
  // stage event for the first stage so the project's first "Stage" entry is
  // also captured. Use Timestamp.now() — Firestore rejects serverTimestamp()
  // inside arrays.
  const now = Timestamp.now()
  const assignment: WorkflowAssignmentEvent = {
    kind: 'workflow_assignment',
    workflowId: input.workflowId,
    assignedAt: now,
    assignedBy: input.createdBy,
  }
  const initialStageEvent: StageEvent = {
    kind: 'stage',
    stageId: firstStage.id,
    enteredAt: now,
    enteredBy: input.createdBy,
    payload: null,
  }
  const projectHistory: ProjectHistoryEvent[] = [assignment, initialStageEvent]

  // Phase 2c: snapshot the workflow doc into the project so future workflow
  // edits never affect this project's behavior. Strip the live `updatedAt`
  // Timestamp — it's a Firestore Timestamp instance which round-trips fine
  // inside an object, but we don't want stale snapshot bookkeeping confusing
  // a future reader. We keep version/lastEdited as informational copies.
  const pinnedWorkflow = {
    ...workflow,
    id: workflow.id,
  }

  // Phase 2d: honour assignedToCreatorOnNew, then merge any creator-supplied
  // assignments. Owner is retired — no ownerId written; accessKeys derives from
  // role holders + the creator.
  const roleAssignments: Record<string, string | string[]> = {}
  for (const role of workflow.projectRoles ?? []) {
    if (role.assignedToCreatorOnNew) {
      roleAssignments[role.id] = role.multiple ? [input.createdBy] : input.createdBy
    }
  }
  for (const [roleId, value] of Object.entries(input.roleAssignments ?? {})) {
    if (value !== undefined && value !== null) roleAssignments[roleId] = value
  }
  const hasRoles = Object.keys(roleAssignments).length > 0

  const batch = writeBatch(db)
  const projectRef = doc(tenantCol('projects'))
  batch.set(projectRef, {
    title: input.title,
    titleLower: input.title.trim().toLowerCase(),
    description: input.description,
    createdBy: input.createdBy,
    status: 'in_progress',
    teamIds: [],
    // Brand-new project: no teams attached and no tasks yet, so team-lead and
    // assignee sets are empty. A lead assigned via auto-allocation is folded in
    // by the chained performAction below.
    accessKeys: computeAccessKeys(hasRoles ? roleAssignments : undefined, input.createdBy, null, [], [], {
      workflow,
      users: input.users,
      roles: getRolesSnapshot(),
    }),
    attachments: input.attachments ?? [],
    ...(input.deadline ? { deadline: input.deadline } : {}),
    // Phase 2d additions (omitted when empty so docs stay tidy).
    ...(hasRoles ? { roleAssignments } : {}),
    ...(input.fields && Object.keys(input.fields).length ? { fields: input.fields } : {}),
    // Workflow pinning — every project carries these post-2b.
    workflowId: input.workflowId,
    pinnedWorkflow,
    currentStageId: firstStage.id,
    leadUid: null,
    iterationCount: 0,
    escalationCount: 0,
    projectHistory,
    // Collab-flow denormalisations (only present when supplied).
    ...(input.submissionDate ? { submissionDate: input.submissionDate } : {}),
    ...(input.presentationDate ? { presentationDate: input.presentationDate } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.createdBy,
    actorName: input.actorName,
    action: 'project.created',
    targetType: 'project',
    targetId: projectRef.id,
    targetTitle: input.title,
    projectId: projectRef.id,
    payload: { workflowId: input.workflowId },
    batch,
  })

  // Auto-allocation: when the form provided the inputs the first action needs,
  // chain a performAction onto the same batch so the project lands at stage 2
  // (e.g. 'allocated' / 'assigned') in a single commit. Skips silently when
  // the action doesn't exist or the supplied inputs fail validation — the
  // project still gets created at stage 1.
  if (input.initialAction) {
    const action = firstStage.actions.find((a) => a.id === input.initialAction!.actionId)
    if (action) {
      // Reconstruct a Project shape sufficient for performAction. We don't
      // have the server-stamped ids/timestamps yet, but performAction only
      // reads workflowId/currentStageId/leadUid/ownerId/status from the
      // project to compose the patch — all known here.
      const projectShim: Project = {
        id: projectRef.id,
        title: input.title,
        description: input.description,
        createdBy: input.createdBy,
        ...(hasRoles ? { roleAssignments } : {}),
        status: 'in_progress',
        teamIds: [],
        createdAt: now,
        updatedAt: now,
        workflowId: input.workflowId,
        pinnedWorkflow,
        currentStageId: firstStage.id,
        leadUid: null,
        iterationCount: 0,
        escalationCount: 0,
        projectHistory,
      }
      const userShim: User = {
        uid: input.createdBy,
        email: '',
        displayName: input.actorName,
        // Real role + team memberships so performAction's permission check
        // sees the actual creator, not a "user"-role placeholder.
        globalRole: input.creatorRole,
        teamIds: input.creatorTeamIds ?? [],
        createdAt: now,
      }
      try {
        await performAction({
          project: projectShim,
          workflow,
          user: userShim,
          actionId: input.initialAction.actionId,
          inputs: input.initialAction.inputs,
          batch,
          users: input.users,
        })
      } catch (e) {
        // Auto-allocation is best-effort: the project is still created at
        // stage 1 in the same batch. Log so silent permission / validation
        // failures surface during dev instead of disappearing.
        console.warn(
          `addProject: auto-allocation of action "${input.initialAction.actionId}" failed; project will land at stage 1.`,
          e,
        )
      }
    }
  }

  await batch.commit()
  return projectRef.id
}

export interface UpdateProjectStatusInput {
  projectId: string
  projectTitle: string
  // Phase 2d: widened to string to allow author-configured status ids.
  fromStatus: ProjectStatus | string
  toStatus: ProjectStatus | string
  note: string
  enteredBy: string
  actorName: string
  // The stage id the project was sitting at when the update was made — used
  // as the anchor for the history event so the timeline shows the status
  // change against its workflow context.
  stageId: string
}

// Update project.status and append a stage-anchored status event to
// projectHistory atomically. Used by the direct status-pill update path (the
// `set_status` workflow effect goes through performAction). Status changes
// don't transition the stage — the event's stageId equals project.currentStageId.
export async function updateProjectStatus(input: UpdateProjectStatusInput): Promise<void> {
  const trimmed = input.note.trim()
  if (!trimmed) {
    throw new Error('A note is required when updating the project status.')
  }
  const event: StageEvent = {
    kind: 'stage',
    stageId: input.stageId,
    enteredAt: Timestamp.now(),
    enteredBy: input.enteredBy,
    payload: {
      from: input.fromStatus,
      to: input.toStatus,
      note: trimmed,
    },
  }
  const batch = writeBatch(db)
  batch.update(tenantDoc('projects', input.projectId), {
    status: input.toStatus,
    statusNote: trimmed,
    projectHistory: arrayUnion(event),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.enteredBy,
    actorName: input.actorName,
    action: 'project.status_updated',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: input.projectTitle,
    projectId: input.projectId,
    payload: { from: input.fromStatus, to: input.toStatus, note: trimmed, stageId: input.stageId },
    batch,
  })
  await batch.commit()
}

// Edit a project's core details (title/description/flow dates). Deliberately
// touches NOTHING workflow-engine-owned (status, currentStageId, workflowId,
// pinnedWorkflow, leadUid, counters, outcomeLog, stageEnteredAt) — those have
// their own paths. Recomputes `titleLower` on rename (drives Projects search/
// sort + ProjectPicker) and propagates the new title to every task's
// denormalized `projectTitle` (caption-consistency, non-atomic by design —
// navigation is id-based). Dates are presence-keyed: undefined = untouched,
// null = clear.
export interface UpdateProjectDetailsInput {
  projectId: string
  title: string
  description: string
  deadline?: Timestamp | null
  submissionDate?: Timestamp | null
  presentationDate?: Timestamp | null
  actorId: string
  actorName: string
}

export async function updateProjectDetails(input: UpdateProjectDetailsInput): Promise<void> {
  const title = input.title.trim()
  if (!title) throw new Error('Title is required.')

  const ref = tenantDoc('projects', input.projectId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Project not found')
  const project = snap.data() as {
    title?: string
    description?: string
    deadline?: Timestamp
    submissionDate?: Timestamp
    presentationDate?: Timestamp
  }

  // Diff → changes (dates as millis|null). Only changed keys are recorded.
  const dateDiff = (
    key: 'deadline' | 'submissionDate' | 'presentationDate',
  ): { from: number | null; to: number | null } | undefined => {
    const next = input[key]
    if (next === undefined) return undefined
    const fromMs = project[key]?.toMillis() ?? null
    const toMs = next?.toMillis() ?? null
    return fromMs === toMs ? undefined : { from: fromMs, to: toMs }
  }

  const titleChanged = (project.title ?? '') !== title
  const descriptionChanged = (project.description ?? '') !== input.description
  const deadlineChange = dateDiff('deadline')
  const submissionChange = dateDiff('submissionDate')
  const presentationChange = dateDiff('presentationDate')

  const changes: DetailsUpdatedEvent['changes'] = {
    ...(titleChanged ? { title: { from: project.title ?? '', to: title } } : {}),
    ...(descriptionChanged ? { description: true as const } : {}),
    ...(deadlineChange ? { deadline: deadlineChange } : {}),
    ...(submissionChange ? { submissionDate: submissionChange } : {}),
    ...(presentationChange ? { presentationDate: presentationChange } : {}),
  }
  // Nothing actually changed — don't write audit/history noise.
  if (Object.keys(changes).length === 0) return

  // Read the rename-propagation targets BEFORE the batch (batches can't read).
  let taskDocs: Awaited<ReturnType<typeof getDocs>>['docs'] = []
  if (titleChanged) {
    const tasksSnap = await getDocs(
      query(tenantCol('tasks'), where('projectId', '==', input.projectId)),
    )
    taskDocs = tasksSnap.docs
  }

  const event: DetailsUpdatedEvent = {
    kind: 'details_updated',
    changes,
    updatedAt: Timestamp.now(),
    updatedBy: input.actorId,
  }

  const batch = writeBatch(db)
  batch.update(ref, {
    title,
    ...(titleChanged ? { titleLower: title.toLowerCase() } : {}),
    description: input.description,
    ...(input.deadline !== undefined ? { deadline: input.deadline ?? deleteField() } : {}),
    ...(input.submissionDate !== undefined
      ? { submissionDate: input.submissionDate ?? deleteField() }
      : {}),
    ...(input.presentationDate !== undefined
      ? { presentationDate: input.presentationDate ?? deleteField() }
      : {}),
    projectHistory: arrayUnion(event),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'project.updated',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: title,
    projectId: input.projectId,
    payload: { changes },
    batch,
  })
  await batch.commit()

  // Propagate the rename to every task's denormalized projectTitle. Chunked at
  // the 500-op batch limit; non-atomic with the rename on purpose (caption
  // freshness, not correctness — see updateTaskDetails). Best-effort: a failed
  // chunk is swallowed so it neither aborts the remaining chunks nor fails the
  // already-committed rename. Any stragglers show the old caption (navigation is
  // id-based, so harmless) and heal on the next rename.
  if (titleChanged && taskDocs.length > 0) {
    for (let i = 0; i < taskDocs.length; i += 500) {
      const b = writeBatch(db)
      for (const d of taskDocs.slice(i, i + 500)) b.update(d.ref, { projectTitle: title })
      try {
        await b.commit()
      } catch {
        // ignore — cosmetic caption sync, retried on the next rename
      }
    }
  }
}

export interface SetProjectTeamsInput {
  projectId: string
  projectTitle: string
  // accessKeys is recomputed (UID-only) after a team change — the attached
  // teams' leads + task assignees + role-holders + creator. The caller passes
  // the project's current roleAssignments + createdBy; leadUid is read from the
  // project doc by recomputeProjectAccessKeys.
  roleAssignments?: Record<string, string | string[]>
  createdBy?: string
  previousTeamIds: string[]
  newTeamIds: string[]
  actorId: string
  actorName: string
  // Phase 3.6: keep hierarchy-role-actor holders in accessKeys across this write.
  workflow?: Workflow
  users?: User[]
}

// Atomically updates `projects/{id}.teamIds` and mirrors the change into each
// affected team's `projectIds` (§8 denormalization).
export async function setProjectTeams(input: SetProjectTeamsInput): Promise<void> {
  const previous = new Set(input.previousTeamIds)
  const next = new Set(input.newTeamIds)
  const added = [...next].filter((id) => !previous.has(id))
  const removed = [...previous].filter((id) => !next.has(id))

  // Resolve the lead uid of each team that WILL be attached. The team.projectIds
  // mirror is updated in this same batch, so a teams-by-projectId query inside
  // recomputeProjectAccessKeys would still see the OLD set — pass the new leads
  // explicitly. Detached teams' leads are simply omitted here, so they lose
  // access unless still justified by a role / task / lead / creator entry.
  const teamLeadIds: string[] = []
  for (const teamId of input.newTeamIds) {
    const tSnap = await getDoc(tenantDoc('teams', teamId))
    const lead = tSnap.exists() ? (tSnap.data() as { leadId?: string }).leadId : undefined
    if (lead) teamLeadIds.push(lead)
  }
  const accessKeys = await recomputeProjectAccessKeys(input.projectId, {
    roleAssignments: input.roleAssignments,
    createdBy: input.createdBy,
    teamLeadIds,
    workflow: input.workflow,
    users: input.users,
  })

  const batch = writeBatch(db)
  batch.update(tenantDoc('projects', input.projectId), {
    teamIds: input.newTeamIds,
    accessKeys,
    updatedAt: serverTimestamp(),
  })
  for (const teamId of added) {
    batch.update(tenantDoc('teams', teamId), {
      projectIds: arrayUnion(input.projectId),
    })
  }
  for (const teamId of removed) {
    batch.update(tenantDoc('teams', teamId), {
      projectIds: arrayRemove(input.projectId),
    })
  }
  if (added.length || removed.length) {
    recordAuditEvent({
      actorId: input.actorId,
      actorName: input.actorName,
      action: 'project.teams_updated',
      targetType: 'project',
      targetId: input.projectId,
      targetTitle: input.projectTitle,
      projectId: input.projectId,
      payload: { added, removed },
      batch,
    })
  }
  await batch.commit()
}

// --- Project roles + custom fields (Phase 2d) --------------------------------

export interface SetProjectRoleInput {
  projectId: string
  projectTitle: string
  roleId: string
  // single role → uid | null (clear); multiple role → full desired uid[].
  value: string | string[] | null
  // Current denormalised state so accessKeys recomputes without an extra read.
  currentRoleAssignments?: Record<string, string | string[]>
  teamIds: string[]
  createdBy?: string
  actorId: string
  actorName: string
  // Phase 3.6: keep hierarchy-role-actor holders in accessKeys across this write.
  workflow?: Workflow
  users?: User[]
}

// Assign / reassign / clear one project-role slot. Recomputes accessKeys, appends
// a role_assigned timeline event, and stamps an audit event — all atomically.
export async function setProjectRole(input: SetProjectRoleInput): Promise<void> {
  const merged: Record<string, string | string[]> = { ...(input.currentRoleAssignments ?? {}) }
  if (input.value === null || (Array.isArray(input.value) && input.value.length === 0)) {
    delete merged[input.roleId]
  } else {
    merged[input.roleId] = input.value
  }
  const event: RoleAssignedEvent = {
    kind: 'role_assigned',
    roleId: input.roleId,
    value: input.value,
    assignedAt: Timestamp.now(), // serverTimestamp() is rejected inside arrays
    assignedBy: input.actorId,
  }
  // Role membership is changing; team-lead and assignee sets are not, so a
  // full recompute (with the merged roleAssignments as the override) keeps the
  // array honest and correctly drops a cleared role-holder if nothing else
  // justifies their access.
  const accessKeys = await recomputeProjectAccessKeys(input.projectId, {
    roleAssignments: merged,
    createdBy: input.createdBy,
    workflow: input.workflow,
    users: input.users,
  })
  const batch = writeBatch(db)
  batch.update(tenantDoc('projects', input.projectId), {
    roleAssignments: merged,
    accessKeys,
    projectHistory: arrayUnion(event),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'project.role_assigned',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: input.projectTitle,
    projectId: input.projectId,
    payload: { roleId: input.roleId, value: input.value },
    batch,
  })
  await batch.commit()
}

// --- User hierarchy-role assignment (Phase 3.6) ------------------------------

export interface SetUserRolesInput {
  uid: string
  // Full desired set of hierarchy-role ids (the multi-select source of truth).
  roleIds: string[]
  // Previous set, for the audit diff (optional).
  fromRoleIds?: string[]
  actorId: string
  actorName: string
  targetName: string
}

// The platform access tier (globalRole) a set of configured roles confers, via
// their legacy bridge tags. Configured roles are now the source of truth; this
// keeps globalRole — which Firestore rules + the super-admin bypass still read —
// in sync. super_admin wins over admin; anything else is a plain user.
export function deriveGlobalRole(roleIds: string[], roles: RoleDef[]): GlobalRole {
  const held = roles.filter((r) => roleIds.includes(r.id))
  if (held.some((r) => r.legacyGlobalRole === 'super_admin')) return 'super_admin'
  if (held.some((r) => r.legacyGlobalRole === 'admin')) return 'admin'
  return 'user'
}

// Assign the full set of hierarchy roles a user holds (overwrites user.roleIds)
// and re-derive their globalRole tier from those roles. Used by both the Members
// page (per-user) and the Roles page (per-role) — they edit the same field.
// Light write (single doc + audit); does NOT retro-rebuild accessKeys of
// pre-existing role-gated projects (no Cloud Functions — those converge on the
// next project write; see plan's eventual-consistency note).
export async function setUserRoles(input: SetUserRolesInput): Promise<void> {
  const globalRole = deriveGlobalRole(input.roleIds, getRolesSnapshot())
  const batch = writeBatch(db)
  batch.update(tenantDoc('users', input.uid), { roleIds: input.roleIds, globalRole })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'user.roles_changed',
    targetType: 'user',
    targetId: input.uid,
    targetTitle: input.targetName,
    payload: { fromRoleIds: input.fromRoleIds ?? [], toRoleIds: input.roleIds, globalRole },
    batch,
  })
  await batch.commit()
}

export interface SetUserStatusInput {
  uid: string
  status: 'active' | 'deactivated'
  actorId: string
  actorName: string
  targetName: string
}

// Toggle a member's account activation state. Light write (single doc + audit),
// mirroring setUserRoles. A 'deactivated' user is bounced at sign-in
// (AuthContext) and denied all data by the isActive() Firestore rule.
// status is optional on the User doc (missing ⇒ active), so reactivation just
// sets status:'active'. No accessKeys recompute needed.
export async function setUserStatus(input: SetUserStatusInput): Promise<void> {
  const patch =
    input.status === 'deactivated'
      ? { status: 'deactivated', deactivatedAt: serverTimestamp(), deactivatedBy: input.actorId }
      : { status: 'active', reactivatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(tenantDoc('users', input.uid), patch)
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: input.status === 'deactivated' ? 'user.deactivated' : 'user.reactivated',
    targetType: 'user',
    targetId: input.uid,
    targetTitle: input.targetName,
    batch,
  })
  await batch.commit()
}

export interface SetProjectFieldInput {
  projectId: string
  projectTitle: string
  fieldId: string
  value: unknown
  actorId: string
  actorName: string
}

// Write one custom field value via a dot-path update (won't clobber the rest of
// the `fields` map). Appends a field_updated timeline event + audit. No accessKeys
// recompute — custom fields never affect visibility.
export async function setProjectField(input: SetProjectFieldInput): Promise<void> {
  const value = input.value ?? null // Firestore rejects undefined
  const event: FieldUpdatedEvent = {
    kind: 'field_updated',
    fieldId: input.fieldId,
    value,
    updatedAt: Timestamp.now(),
    updatedBy: input.actorId,
  }
  const batch = writeBatch(db)
  batch.update(tenantDoc('projects', input.projectId), {
    [`fields.${input.fieldId}`]: value,
    projectHistory: arrayUnion(event),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'project.field_updated',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: input.projectTitle,
    projectId: input.projectId,
    payload: { fieldId: input.fieldId, value },
    batch,
  })
  await batch.commit()
}

// --- Tasks (Sprint 5 — Flow 4, Sprint 6 — Flow 5, Sprint 7 — Flow 6) -----------

export interface AddTeamTaskInput {
  projectId: string
  teamId: string
  title: string
  description: string
  priority: TaskPriority
  dueDate?: Timestamp
  teamName: string
  projectTitle: string
  createdBy: string
  actorName: string
  // Tender additions:
  workType?: WorkType
  assigneeId?: string | null
  assigneeName?: string | null
  // Hierarchy: the tier of this top-level item (epic/story/task). Defaults to
  // 'task' when the feature is off or unset. 'subtask' is never created here.
  kind?: TaskKind
}

export async function addTeamTask(input: AddTeamTaskInput): Promise<string> {
  // Ensure the team is attached to the project: the lead may pick a template
  // whose canonical team isn't yet on the project — auto-attach so the task
  // renders correctly on swimlanes and roll-ups. Also auto-advance the
  // workflow when the lead adds the first task at the `task_setup` stage —
  // routed through workflowEvaluator.performAction so the workflow doc
  // decides what "confirm setup" means.
  const projectRef = tenantDoc('projects', input.projectId)
  const projectSnap = await getDoc(projectRef)
  const projectData = projectSnap.exists()
    ? (projectSnap.data() as {
        teamIds?: string[]
        currentStageId?: string
        workflowId?: string
        pinnedWorkflow?: import('../types/workflow').Workflow
        ownerId?: string
        createdBy?: string
        roleAssignments?: Record<string, string | string[]>
        leadUid?: string | null
        title?: string
        status?: string
        projectHistory?: ProjectHistoryEvent[]
      })
    : null
  const existingTeamIds: string[] = projectData?.teamIds ?? []
  const needsAttach = !existingTeamIds.includes(input.teamId)
  const advanceFromTaskSetup = projectData?.currentStageId === 'task_setup'

  const batch = writeBatch(db)
  const taskRef = doc(tenantCol('tasks'))
  batch.set(taskRef, {
    projectId: input.projectId,
    teamId: input.teamId,
    parentTaskId: null,
    title: input.title,
    description: input.description,
    assigneeId: input.assigneeId ?? null,
    ...(input.assigneeName ? { assigneeName: input.assigneeName } : {}),
    status: 'todo',
    priority: input.priority,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    teamName: input.teamName,
    projectTitle: input.projectTitle,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    attachments: [],
    reviewerId: null,
    ...(input.workType ? { workType: input.workType } : {}),
    // Always written explicitly so new docs never depend on the read-side
    // fallback; a plain top-level task is 'task'.
    kind: input.kind ?? 'task',
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // Access maintenance: the assignee (if any) gains task-based access to the
  // project. On auto-attach, the newly-attached team's lead also gains access
  // (team membership alone no longer grants it). arrayUnion is additive, so
  // these pure additions need no full recompute.
  const accessKeysToAdd: string[] = []
  if (input.assigneeId) accessKeysToAdd.push(input.assigneeId)

  if (needsAttach) {
    const teamSnap = await getDoc(tenantDoc('teams', input.teamId))
    const teamLeadId = teamSnap.exists()
      ? (teamSnap.data() as { leadId?: string }).leadId
      : undefined
    if (teamLeadId) accessKeysToAdd.push(teamLeadId)
    batch.update(projectRef, {
      teamIds: arrayUnion(input.teamId),
      ...(accessKeysToAdd.length ? { accessKeys: arrayUnion(...accessKeysToAdd) } : {}),
      updatedAt: serverTimestamp(),
    })
    batch.update(tenantDoc('teams', input.teamId), {
      projectIds: arrayUnion(input.projectId),
    })
  } else if (accessKeysToAdd.length) {
    batch.update(projectRef, {
      accessKeys: arrayUnion(...accessKeysToAdd),
      updatedAt: serverTimestamp(),
    })
  }
  recordAuditEvent({
    actorId: input.createdBy,
    actorName: input.actorName,
    action: 'task.created',
    targetType: 'task',
    targetId: taskRef.id,
    targetTitle: input.title,
    projectId: input.projectId,
    teamId: input.teamId,
    payload: {
      ...(input.workType ? { workType: input.workType } : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    },
    batch,
  })

  // Assignment notification (features.notifications).
  if (input.assigneeId) {
    queueNotification(batch, {
      recipientId: input.assigneeId,
      type: 'assignment',
      actorId: input.createdBy,
      actorName: input.actorName,
      taskId: taskRef.id,
      projectId: input.projectId,
      taskTitle: input.title,
    })
  }

  // Auto-advance: only when the workflow snapshot is available AND the
  // workflow doc has a `confirm_setup` action at the current stage. Anything
  // else (missing workflow, missing action, permission failure) skips the
  // auto-advance silently — the lead can advance manually via the banner.
  if (advanceFromTaskSetup && projectData?.workflowId) {
    const workflow =
      projectData.pinnedWorkflow ?? getWorkflowSnapshot(projectData.workflowId)
    if (workflow) {
      const project: Project = {
        id: input.projectId,
        title: projectData.title ?? input.projectTitle,
        description: '',
        createdBy: projectData.createdBy ?? projectData.ownerId ?? '',
        ...(projectData.roleAssignments ? { roleAssignments: projectData.roleAssignments } : {}),
        status: (projectData.status as Project['status']) ?? 'in_progress',
        teamIds: existingTeamIds,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        leadUid: projectData.leadUid ?? null,
        currentStageId: projectData.currentStageId ?? 'task_setup',
        workflowId: projectData.workflowId,
        pinnedWorkflow: projectData.pinnedWorkflow,
        projectHistory: projectData.projectHistory ?? [],
      }
      const user: User = {
        uid: input.createdBy,
        email: '',
        displayName: input.actorName,
        globalRole: 'user',
        teamIds: [],
        createdAt: Timestamp.now(),
      }
      try {
        await performAction({
          project,
          workflow,
          user,
          actionId: 'confirm_setup',
          inputs: {},
          batch,
        })
      } catch {
        // Auto-advance is best-effort. Silently skip when the workflow
        // refuses (no confirm_setup action, permission denied, etc.) —
        // the project still has the new task; the lead advances manually.
      }
    }
  }

  await batch.commit()
  return taskRef.id
}

export interface AddSubtaskInput {
  parentTaskId: string
  projectId: string
  // The CHOSEN team for this child — may differ from the parent's team
  // (cross-team subtasks). teamName matches teamId.
  teamId: string
  teamName: string
  // The parent's own team + hierarchy tier + title, for the auto-attach
  // short-circuit, child-kind derivation, and denormalized breadcrumb.
  parentTeamId: string
  parentKind: TaskKind
  parentTitle: string
  title: string
  description?: string
  priority: TaskPriority
  dueDate?: Timestamp
  assigneeId: string
  assigneeName: string
  projectTitle: string
  createdBy: string
  actorName: string
}

export async function addSubtask(input: AddSubtaskInput): Promise<string> {
  // Derive the child's tier from the parent — never chosen by the caller.
  // Null means the parent is a leaf (subtask): the UI never offers an add
  // control there, but guard anyway (defense in depth behind the depth cap).
  const kind = childKind(input.parentKind)
  if (!kind) throw new Error('Subtasks cannot have children.')

  // Cross-team only: check whether the chosen team is attached to the project
  // and needs the same auto-attach dance addTeamTask does. The parent's own
  // team is guaranteed attached (its parent task lives on the project), so the
  // common same-team path skips both reads.
  const crossTeam = input.teamId !== input.parentTeamId
  let needsAttach = false
  let teamLeadId: string | null = null
  if (crossTeam) {
    const projectSnap = await getDoc(tenantDoc('projects', input.projectId))
    const teamIds: string[] = projectSnap.exists()
      ? ((projectSnap.data() as { teamIds?: string[] }).teamIds ?? [])
      : []
    needsAttach = !teamIds.includes(input.teamId)
    if (needsAttach) {
      const teamSnap = await getDoc(tenantDoc('teams', input.teamId))
      teamLeadId = teamSnap.exists()
        ? ((teamSnap.data() as { leadId?: string }).leadId ?? null)
        : null
    }
  }

  const batch = writeBatch(db)
  const subtaskRef = doc(tenantCol('tasks'))

  batch.set(subtaskRef, {
    projectId: input.projectId,
    teamId: input.teamId,
    parentTaskId: input.parentTaskId,
    title: input.title,
    description: input.description ?? '',
    assigneeId: input.assigneeId,
    assigneeName: input.assigneeName,
    status: 'todo',
    priority: input.priority,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    teamName: input.teamName,
    projectTitle: input.projectTitle,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    attachments: [],
    reviewerId: null,
    kind,
    parentTitle: input.parentTitle,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  batch.update(tenantDoc('tasks', input.parentTaskId), {
    subtaskCount: increment(1),
    updatedAt: serverTimestamp(),
  })

  if (needsAttach) {
    // Attach the chosen team to the project (mirrors addTeamTask): grant the
    // assignee + the new team's lead project access, and back-link the team.
    batch.update(tenantDoc('projects', input.projectId), {
      teamIds: arrayUnion(input.teamId),
      accessKeys: arrayUnion(input.assigneeId, ...(teamLeadId ? [teamLeadId] : [])),
      updatedAt: serverTimestamp(),
    })
    batch.update(tenantDoc('teams', input.teamId), {
      projectIds: arrayUnion(input.projectId),
    })
  } else {
    // The subtask assignee gains task-based access to the project (additive).
    batch.update(tenantDoc('projects', input.projectId), {
      accessKeys: arrayUnion(input.assigneeId),
      updatedAt: serverTimestamp(),
    })
  }

  recordAuditEvent({
    actorId: input.createdBy,
    actorName: input.actorName,
    action: 'subtask.created',
    targetType: 'task',
    targetId: subtaskRef.id,
    targetTitle: input.title,
    projectId: input.projectId,
    teamId: input.teamId,
    payload: {
      parentTaskId: input.parentTaskId,
      assigneeId: input.assigneeId,
      ...(crossTeam ? { crossTeam: true, teamAttached: needsAttach } : {}),
    },
    batch,
  })

  // Assignment notification (features.notifications): notify the assignee that
  // a subtask was assigned to them.
  queueNotification(batch, {
    recipientId: input.assigneeId,
    type: 'assignment',
    actorId: input.createdBy,
    actorName: input.actorName,
    taskId: subtaskRef.id,
    projectId: input.projectId,
    taskTitle: input.title,
  })

  await batch.commit()
  return subtaskRef.id
}

// Link enforcement: a task can't be completed while any task that BLOCKS it
// (its `blocked_by` links) is still open. The `blocks` direction and advisory
// relations (relates_to/duplicates) never gate. Client-enforced — same trust
// model as the rest of the task domain (a Firestore rule can't read other docs).
// A blocker that no longer exists is treated as unblocked (stale-link tolerant).
async function assertBlockersComplete(links: TaskLink[] | undefined): Promise<void> {
  const blockerIds = Array.from(
    new Set((links ?? []).filter((l) => l.relation === 'blocked_by').map((l) => l.taskId)),
  )
  if (blockerIds.length === 0) return
  const snaps = await Promise.all(blockerIds.map((id) => getDoc(tenantDoc('tasks', id))))
  const openBlockers = snaps
    .filter((s) => s.exists() && (s.data() as { status?: TaskStatus }).status !== 'done')
    .map((s) => (s.data() as { title?: string }).title ?? 'a task')
  if (openBlockers.length > 0) {
    throw new Error(
      openBlockers.length === 1
        ? `Can't complete this task — it's blocked by "${openBlockers[0]}", which isn't done yet.`
        : `Can't complete this task — it's blocked by ${openBlockers.length} unfinished tasks: ${openBlockers.join(', ')}.`,
    )
  }
}

// Updates a task's status. If the task is a subtask that just crossed the "done" boundary
// in either direction, also updates the parent's `subtaskDoneCount` in the same batch (§8).
export interface SetTaskStatusInput {
  taskId: string
  status: TaskStatus
  actorId: string
  actorName: string
}

export async function setTaskStatus(input: SetTaskStatusInput): Promise<void> {
  const ref = tenantDoc('tasks', input.taskId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Task not found')
  const task = snap.data() as {
    status: TaskStatus
    parentTaskId: string | null
    title?: string
    projectId?: string
    teamId?: string
    createdBy?: string
    assigneeId?: string | null
    links?: TaskLink[]
  }
  if (task.status === input.status) return
  // Gate completion on open blockers (see assertBlockersComplete).
  if (input.status === 'done') await assertBlockersComplete(task.links)

  const batch = writeBatch(db)
  batch.update(ref, {
    status: input.status,
    updatedAt: serverTimestamp(),
    completedAt: input.status === 'done' ? serverTimestamp() : null,
  })

  if (task.parentTaskId) {
    const wasDone = task.status === 'done'
    const isDone = input.status === 'done'
    if (wasDone !== isDone) {
      batch.update(tenantDoc('tasks', task.parentTaskId), {
        subtaskDoneCount: increment(isDone ? 1 : -1),
        updatedAt: serverTimestamp(),
      })
    }
  }

  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'task.status_changed',
    targetType: 'task',
    targetId: input.taskId,
    ...(task.title ? { targetTitle: task.title } : {}),
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.teamId ? { teamId: task.teamId } : {}),
    payload: { from: task.status, to: input.status },
    batch,
  })

  // Status-update notification (features.notifications): the task's creator and
  // assignee — minus whoever made the change.
  if (task.projectId) {
    queueNotificationFanout(batch, [task.createdBy, task.assigneeId], {
      type: 'status_update',
      actorId: input.actorId,
      actorName: input.actorName,
      taskId: input.taskId,
      projectId: task.projectId,
      taskTitle: task.title ?? 'a task',
      snippet: `${task.status} → ${input.status}`,
    })
  }

  await batch.commit()
}

export interface AddProjectAttachmentInput {
  projectId: string
  projectTitle: string
  attachment: Attachment
  actorId: string
  actorName: string
}

export async function addProjectAttachment(input: AddProjectAttachmentInput): Promise<void> {
  const batch = writeBatch(db)
  batch.update(tenantDoc('projects', input.projectId), {
    attachments: arrayUnion(input.attachment),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'project.attachment_added',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: input.projectTitle,
    projectId: input.projectId,
    payload: {
      attachmentId: input.attachment.id,
      name: input.attachment.name,
      mimeType: input.attachment.mimeType,
      sizeBytes: input.attachment.sizeBytes,
    },
    batch,
  })
  await batch.commit()
}

export interface AddTaskAttachmentInput {
  taskId: string
  attachment: Attachment
  actorId: string
  actorName: string
  taskTitle: string
  projectId: string
}

export async function addTaskAttachment(input: AddTaskAttachmentInput): Promise<void> {
  const batch = writeBatch(db)
  batch.update(tenantDoc('tasks', input.taskId), {
    attachments: arrayUnion(input.attachment),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'task.attachment_added',
    targetType: 'task',
    targetId: input.taskId,
    targetTitle: input.taskTitle,
    projectId: input.projectId,
    payload: {
      attachmentId: input.attachment.id,
      name: input.attachment.name,
      mimeType: input.attachment.mimeType,
      sizeBytes: input.attachment.sizeBytes,
    },
    batch,
  })
  await batch.commit()
}

export interface RemoveTaskAttachmentInput {
  taskId: string
  attachment: Attachment
  actorId: string
  actorName: string
  taskTitle: string
  projectId: string
}

export async function removeTaskAttachment(input: RemoveTaskAttachmentInput): Promise<void> {
  const batch = writeBatch(db)
  batch.update(tenantDoc('tasks', input.taskId), {
    attachments: arrayRemove(input.attachment),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'task.attachment_removed',
    targetType: 'task',
    targetId: input.taskId,
    targetTitle: input.taskTitle,
    projectId: input.projectId,
    payload: {
      attachmentId: input.attachment.id,
      name: input.attachment.name,
      mimeType: input.attachment.mimeType,
      sizeBytes: input.attachment.sizeBytes,
    },
    batch,
  })
  await batch.commit()
}

// --- User role management ----------------------------------------------------

export interface SetUserRoleInput {
  uid: string
  fromRole: GlobalRole
  toRole: GlobalRole
  actorId: string
  actorName: string
  targetName: string
}

export async function setUserRole(input: SetUserRoleInput): Promise<void> {
  if (input.fromRole === input.toRole) return
  const batch = writeBatch(db)
  batch.update(tenantDoc('users', input.uid), { globalRole: input.toRole })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'user.role_changed',
    targetType: 'user',
    targetId: input.uid,
    targetTitle: input.targetName,
    payload: { fromRole: input.fromRole, toRole: input.toRole },
    batch,
  })
  await batch.commit()
}

// --- Comments (Sprint 7 — Flow 6) ---------------------------------------------

export interface AddCommentInput {
  taskId: string
  authorId: string
  authorName: string
  content: string
  attachments?: Attachment[]
  // @mention support (features.notifications). projectId + taskTitle enrich the
  // mention notifications; mentionedUids drives the fan-out.
  mentionedUids?: string[]
  projectId?: string
  taskTitle?: string
}

export async function addComment(input: AddCommentInput): Promise<string> {
  const mentioned = Array.from(new Set(input.mentionedUids ?? []))
  // Bare addDoc is fine when there's nothing to fan out; otherwise batch the
  // comment + mention notifications so they commit atomically.
  if (mentioned.length === 0 || !input.projectId) {
    const ref = await addDoc(tenantCol('tasks', input.taskId, 'comments'), {
      taskId: input.taskId,
      authorId: input.authorId,
      authorName: input.authorName,
      content: input.content,
      attachments: input.attachments ?? [],
      ...(mentioned.length ? { mentionedUids: mentioned } : {}),
      createdAt: serverTimestamp(),
    })
    return ref.id
  }

  const batch = writeBatch(db)
  const ref = doc(tenantCol('tasks', input.taskId, 'comments'))
  batch.set(ref, {
    taskId: input.taskId,
    authorId: input.authorId,
    authorName: input.authorName,
    content: input.content,
    attachments: input.attachments ?? [],
    mentionedUids: mentioned,
    createdAt: serverTimestamp(),
  })
  const snippet = input.content.trim().slice(0, 140)
  for (const uid of mentioned) {
    queueNotification(batch, {
      recipientId: uid,
      type: 'mention',
      actorId: input.authorId,
      actorName: input.authorName,
      taskId: input.taskId,
      projectId: input.projectId,
      taskTitle: input.taskTitle ?? 'a task',
      snippet,
    })
  }
  await batch.commit()
  return ref.id
}

export interface AddProjectCommentInput {
  projectId: string
  authorId: string
  authorName: string
  content: string
}

// Project-level comment thread (used by stage 8 VH review per delta §5 Flow 19).
export async function addProjectComment(input: AddProjectCommentInput): Promise<string> {
  const ref = await addDoc(tenantCol('projects', input.projectId, 'comments'), {
    projectId: input.projectId,
    authorId: input.authorId,
    authorName: input.authorName,
    content: input.content,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

// `transitionStage` was removed in Phase 2a / Sprint 4. Every project stage
// transition now goes through `workflowEvaluator.performAction` (called via
// `runWorkflowAction` above). The audit trail records `project.action_performed`
// rather than `project.stage_transitioned`. Sprint 5 sweeps the residual
// legacy fields (numeric `stage`, `vhId`, `vhIterationCount`).

// --- Task review transitions (delta §3.4 + §5 Flow 18) -----------------------

export interface TransitionTaskToReviewInput {
  taskId: string
  reviewerId: string
  reviewerName?: string
  notes?: string
  authorId: string
  authorName: string
  // Audit context (taskTitle and projectId enrich the audit doc; if omitted, the
  // helper reads them from the task doc — but callers should pass them when
  // available to skip the extra read).
  taskTitle?: string
  projectId?: string
}

// Move a task to in_review with a named reviewer. Optional notes are added as a comment in the same batch.
export async function transitionTaskToReview(
  input: TransitionTaskToReviewInput,
): Promise<void> {
  let taskTitle = input.taskTitle
  let projectId = input.projectId
  if (!taskTitle || !projectId) {
    const snap = await getDoc(tenantDoc('tasks', input.taskId))
    if (snap.exists()) {
      const data = snap.data() as { title?: string; projectId?: string }
      taskTitle = taskTitle ?? data.title
      projectId = projectId ?? data.projectId
    }
  }

  const batch = writeBatch(db)
  batch.update(tenantDoc('tasks', input.taskId), {
    status: 'in_review',
    reviewerId: input.reviewerId,
    reviewerName: input.reviewerName ?? null,
    updatedAt: serverTimestamp(),
  })
  const trimmed = input.notes?.trim()
  if (trimmed) {
    const commentRef = doc(tenantCol('tasks', input.taskId, 'comments'))
    batch.set(commentRef, {
      taskId: input.taskId,
      authorId: input.authorId,
      authorName: input.authorName,
      content: trimmed,
      attachments: [],
      createdAt: serverTimestamp(),
    })
  }
  recordAuditEvent({
    actorId: input.authorId,
    actorName: input.authorName,
    action: 'task.submitted_for_review',
    targetType: 'task',
    targetId: input.taskId,
    ...(taskTitle ? { targetTitle: taskTitle } : {}),
    ...(projectId ? { projectId } : {}),
    payload: {
      reviewerId: input.reviewerId,
      ...(input.reviewerName ? { reviewerName: input.reviewerName } : {}),
    },
    batch,
  })
  await batch.commit()
}

export interface TransitionTaskFromReviewInput {
  taskId: string
  decision: 'approve' | 'reject'
  // For approve: optional positive comment.
  // For reject: REQUIRED non-empty feedback comment (helper throws otherwise).
  feedback?: string
  // Reject-only: optionally reassign to someone other than the original assignee.
  newAssigneeId?: string | null
  newAssigneeName?: string | null
  authorId: string
  authorName: string
}

// Approve (→ done) or reject (→ in_progress) a task currently in_review.
// On approve: clears reviewerId, sets completedAt, increments parent subtaskDoneCount if subtask.
// On reject: clears reviewerId, optionally reassigns, REQUIRES non-empty feedback (added as comment).
// Throws if reject with empty/whitespace feedback (delta §3.4 mandatory feedback enforcement).
export async function transitionTaskFromReview(
  input: TransitionTaskFromReviewInput,
): Promise<void> {
  const trimmed = input.feedback?.trim() ?? ''
  if (input.decision === 'reject' && !trimmed) {
    throw new Error('Feedback is required when sending a task back from review.')
  }

  const ref = tenantDoc('tasks', input.taskId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Task not found')
  const task = snap.data() as {
    status: TaskStatus
    parentTaskId: string | null
    assigneeId: string | null
    assigneeName?: string
    title?: string
    projectId?: string
    createdBy?: string
    links?: TaskLink[]
  }

  // Approving moves the task to done — same completion gate as setTaskStatus.
  if (input.decision === 'approve') await assertBlockersComplete(task.links)

  const batch = writeBatch(db)

  if (input.decision === 'approve') {
    batch.update(ref, {
      status: 'done',
      reviewerId: null,
      reviewerName: null,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (task.parentTaskId && task.status !== 'done') {
      batch.update(tenantDoc('tasks', task.parentTaskId), {
        subtaskDoneCount: increment(1),
        updatedAt: serverTimestamp(),
      })
    }
    if (trimmed) {
      const commentRef = doc(tenantCol('tasks', input.taskId, 'comments'))
      batch.set(commentRef, {
        taskId: input.taskId,
        authorId: input.authorId,
        authorName: input.authorName,
        content: trimmed,
        attachments: [],
        createdAt: serverTimestamp(),
      })
    }
    recordAuditEvent({
      actorId: input.authorId,
      actorName: input.authorName,
      action: 'task.review_approved',
      targetType: 'task',
      targetId: input.taskId,
      ...(task.title ? { targetTitle: task.title } : {}),
      ...(task.projectId ? { projectId: task.projectId } : {}),
      payload: trimmed ? { note: trimmed } : {},
      batch,
    })
    // Status-update notification: creator + assignee, minus the reviewer.
    if (task.projectId) {
      queueNotificationFanout(batch, [task.createdBy, task.assigneeId], {
        type: 'status_update',
        actorId: input.authorId,
        actorName: input.authorName,
        taskId: input.taskId,
        projectId: task.projectId,
        taskTitle: task.title ?? 'a task',
        snippet: 'in_review → done',
      })
    }
  } else {
    const nextAssigneeId = input.newAssigneeId ?? task.assigneeId ?? null
    const nextAssigneeName = input.newAssigneeName ?? task.assigneeName ?? null
    batch.update(ref, {
      status: 'in_progress',
      reviewerId: null,
      reviewerName: null,
      assigneeId: nextAssigneeId,
      ...(nextAssigneeName ? { assigneeName: nextAssigneeName } : {}),
      updatedAt: serverTimestamp(),
    })
    // If the task was previously done (rare but possible if approve was reverted),
    // decrement the parent's subtaskDoneCount.
    if (task.parentTaskId && task.status === 'done') {
      batch.update(tenantDoc('tasks', task.parentTaskId), {
        subtaskDoneCount: increment(-1),
        updatedAt: serverTimestamp(),
      })
    }
    const commentRef = doc(tenantCol('tasks', input.taskId, 'comments'))
    batch.set(commentRef, {
      taskId: input.taskId,
      authorId: input.authorId,
      authorName: input.authorName,
      content: trimmed,
      attachments: [],
      createdAt: serverTimestamp(),
    })
    const reassigned = nextAssigneeId !== task.assigneeId
    recordAuditEvent({
      actorId: input.authorId,
      actorName: input.authorName,
      action: 'task.review_rejected',
      targetType: 'task',
      targetId: input.taskId,
      ...(task.title ? { targetTitle: task.title } : {}),
      ...(task.projectId ? { projectId: task.projectId } : {}),
      payload: {
        feedback: trimmed,
        ...(reassigned
          ? { reassignedTo: nextAssigneeId, ...(nextAssigneeName ? { reassignedToName: nextAssigneeName } : {}) }
          : {}),
      },
      batch,
    })
    if (reassigned) {
      recordAuditEvent({
        actorId: input.authorId,
        actorName: input.authorName,
        action: 'task.assignee_changed',
        targetType: 'task',
        targetId: input.taskId,
        ...(task.title ? { targetTitle: task.title } : {}),
        ...(task.projectId ? { projectId: task.projectId } : {}),
        payload: {
          fromAssigneeId: task.assigneeId,
          toAssigneeId: nextAssigneeId,
          ...(nextAssigneeName ? { toAssigneeName: nextAssigneeName } : {}),
        },
        batch,
      })
    }
    // Status-update notification: creator + the (possibly new) assignee, minus
    // the reviewer.
    if (task.projectId) {
      queueNotificationFanout(batch, [task.createdBy, nextAssigneeId], {
        type: 'status_update',
        actorId: input.authorId,
        actorName: input.authorName,
        taskId: input.taskId,
        projectId: task.projectId,
        taskTitle: task.title ?? 'a task',
        snippet: 'in_review → in_progress',
      })
    }
  }

  await batch.commit()

  // A reject can reassign the task to someone new. That changes who has
  // task-based access: recompute AFTER the commit so the tasks read reflects
  // the new assignee, and the previous assignee is dropped if no longer
  // justified. arrayUnion can't revoke, so a full recompute is required.
  if (input.decision === 'reject' && task.projectId) {
    const nextAssigneeId = input.newAssigneeId ?? task.assigneeId ?? null
    if (nextAssigneeId !== task.assigneeId) {
      const accessKeys = await recomputeProjectAccessKeys(task.projectId)
      await updateDoc(tenantDoc('projects', task.projectId), {
        accessKeys,
        updatedAt: serverTimestamp(),
      })
    }
  }
}

// --- Task linking (features.taskLinking) -------------------------------------
// Same-project links only. A link is stored on BOTH docs (target carries the
// inverse relation) so either side renders it. Titles are denormalized and
// immutable, so no join is needed to display a link.

export interface LinkTasksInput {
  sourceTaskId: string
  sourceTitle: string
  targetTaskId: string
  targetTitle: string
  relation: TaskLinkRelation
  projectId: string
  actorId: string
  actorName: string
}

export async function linkTasks(input: LinkTasksInput): Promise<void> {
  if (input.sourceTaskId === input.targetTaskId) {
    throw new Error('A task cannot be linked to itself.')
  }
  // arrayUnion can't dedupe TaskLink objects (createdAt differs per attempt),
  // so guard against a double-link with a read.
  const sourceRef = tenantDoc('tasks', input.sourceTaskId)
  const sourceSnap = await getDoc(sourceRef)
  if (!sourceSnap.exists()) throw new Error('Task not found')
  const existing = (sourceSnap.data() as { links?: TaskLink[] }).links ?? []
  if (existing.some((l) => l.taskId === input.targetTaskId)) {
    throw new Error('These tasks are already linked.')
  }

  const now = Timestamp.now()
  const batch = writeBatch(db)
  const sourceLink: TaskLink = {
    taskId: input.targetTaskId,
    title: input.targetTitle,
    relation: input.relation,
    createdAt: now,
    createdBy: input.actorId,
  }
  const targetLink: TaskLink = {
    taskId: input.sourceTaskId,
    title: input.sourceTitle,
    relation: INVERSE_RELATION[input.relation],
    createdAt: now,
    createdBy: input.actorId,
  }
  batch.update(sourceRef, { links: arrayUnion(sourceLink), updatedAt: serverTimestamp() })
  batch.update(tenantDoc('tasks', input.targetTaskId), {
    links: arrayUnion(targetLink),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'task.linked',
    targetType: 'task',
    targetId: input.sourceTaskId,
    targetTitle: input.sourceTitle,
    projectId: input.projectId,
    payload: { linkedTaskId: input.targetTaskId, relation: input.relation },
    batch,
  })
  await batch.commit()
}

export interface UnlinkTasksInput {
  sourceTaskId: string
  targetTaskId: string
  projectId: string
  actorId: string
  actorName: string
}

export async function unlinkTasks(input: UnlinkTasksInput): Promise<void> {
  // arrayRemove can't match TaskLink objects (createdAt etc.), so we read+filter
  // the arrays. That read-modify-write must be atomic: a plain batch would lose
  // a concurrent linkTasks (arrayUnion) that landed after our read, leaving the
  // two docs asymmetric. A transaction re-reads and retries on contention, so
  // any concurrently-added link survives. Tolerate a missing target (still clean
  // the source side — defensive against stale links).
  const sourceRef = tenantDoc('tasks', input.sourceTaskId)
  const targetRef = tenantDoc('tasks', input.targetTaskId)

  await runTransaction(db, async (tx) => {
    const [sourceSnap, targetSnap] = await Promise.all([tx.get(sourceRef), tx.get(targetRef)])
    if (sourceSnap.exists()) {
      const links = (sourceSnap.data() as { links?: TaskLink[] }).links ?? []
      tx.update(sourceRef, {
        links: links.filter((l) => l.taskId !== input.targetTaskId),
        updatedAt: serverTimestamp(),
      })
    }
    if (targetSnap.exists()) {
      const links = (targetSnap.data() as { links?: TaskLink[] }).links ?? []
      tx.update(targetRef, {
        links: links.filter((l) => l.taskId !== input.sourceTaskId),
        updatedAt: serverTimestamp(),
      })
    }
  })

  // Audit outside the transaction (a new doc, no contention) so a transaction
  // retry can't write duplicate audit rows.
  await recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'task.unlinked',
    targetType: 'task',
    targetId: input.sourceTaskId,
    projectId: input.projectId,
    payload: { unlinkedTaskId: input.targetTaskId },
  })
}

// --- Task duplication (features.taskDuplication) -----------------------------
// Dedicated write (not addTeamTask) so we keep parentTaskId/kind/workType and
// avoid addTeamTask's task_setup auto-advance + attach dance. Everything needed
// is on the source Task the caller already holds — no pre-reads.

export async function duplicateTask(
  source: Task,
  actor: { uid: string; displayName: string },
  overrides?: {
    title?: string
    description?: string
    // Explicit assignee override. Presence of the key wins (incl. `null` to
    // unassign); absent → copy the source's assignee. `assigneeName` should be
    // passed alongside so the copy carries the denormalized display name.
    assigneeId?: string | null
    assigneeName?: string | null
    // Optional team retarget (cross-team duplication). Absent → keep the source's
    // team. Pass `teamName` alongside for the denormalized caption. If the chosen
    // team isn't attached to the project, it's auto-attached (mirrors addSubtask).
    teamId?: string
    teamName?: string
  },
): Promise<string> {
  const title = overrides?.title?.trim() || `Copy of ${source.title}`
  const description = overrides?.description ?? source.description ?? ''
  const assigneeId =
    overrides && 'assigneeId' in overrides ? overrides.assigneeId ?? null : source.assigneeId ?? null
  const assigneeName =
    overrides && 'assigneeName' in overrides
      ? overrides.assigneeName ?? null
      : source.assigneeName ?? null
  const teamId = overrides?.teamId ?? source.teamId
  const teamName = overrides?.teamName ?? source.teamName ?? ''

  // Cross-team retarget: check whether the chosen team is attached to the project
  // and needs the same auto-attach dance addSubtask/addTeamTask do. Same-team
  // duplication (the common path) skips both reads.
  const crossTeam = teamId !== source.teamId
  let needsAttach = false
  let teamLeadId: string | null = null
  if (crossTeam) {
    const projectSnap = await getDoc(tenantDoc('projects', source.projectId))
    const teamIds: string[] = projectSnap.exists()
      ? ((projectSnap.data() as { teamIds?: string[] }).teamIds ?? [])
      : []
    needsAttach = !teamIds.includes(teamId)
    if (needsAttach) {
      const teamSnap = await getDoc(tenantDoc('teams', teamId))
      teamLeadId = teamSnap.exists()
        ? ((teamSnap.data() as { leadId?: string }).leadId ?? null)
        : null
    }
  }

  const batch = writeBatch(db)
  const newRef = doc(tenantCol('tasks'))

  batch.set(newRef, {
    projectId: source.projectId,
    teamId,
    parentTaskId: source.parentTaskId ?? null,
    ...(source.parentTitle ? { parentTitle: source.parentTitle } : {}),
    kind: effectiveKind(source),
    title,
    description,
    assigneeId,
    ...(assigneeName ? { assigneeName } : {}),
    status: 'todo',
    priority: source.priority,
    ...(source.dueDate ? { dueDate: source.dueDate } : {}),
    ...(teamName ? { teamName } : {}),
    ...(source.projectTitle ? { projectTitle: source.projectTitle } : {}),
    ...(source.workType ? { workType: source.workType } : {}),
    subtaskCount: 0,
    subtaskDoneCount: 0,
    attachments: [], // refs share external storage objects — don't copy
    reviewerId: null,
    reviewerName: null,
    // no links (would be asymmetric), no completedAt
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // The copy sits beside the source under the same parent, if any.
  if (source.parentTaskId) {
    batch.update(tenantDoc('tasks', source.parentTaskId), {
      subtaskCount: increment(1),
      updatedAt: serverTimestamp(),
    })
  }

  if (needsAttach) {
    // Attach the chosen team to the project (mirrors addSubtask): grant the
    // assignee (if any) + the new team's lead project access, back-link the team.
    const grants = [
      ...(assigneeId ? [assigneeId] : []),
      ...(teamLeadId ? [teamLeadId] : []),
    ]
    batch.update(tenantDoc('projects', source.projectId), {
      teamIds: arrayUnion(teamId),
      ...(grants.length ? { accessKeys: arrayUnion(...grants) } : {}),
      updatedAt: serverTimestamp(),
    })
    batch.update(tenantDoc('teams', teamId), {
      projectIds: arrayUnion(source.projectId),
    })
  } else if (assigneeId) {
    // Preserve the access invariant for the (possibly reassigned) assignee (idempotent).
    batch.update(tenantDoc('projects', source.projectId), {
      accessKeys: arrayUnion(assigneeId),
      updatedAt: serverTimestamp(),
    })
  }

  recordAuditEvent({
    actorId: actor.uid,
    actorName: actor.displayName,
    action: 'task.duplicated',
    targetType: 'task',
    targetId: newRef.id,
    targetTitle: title,
    projectId: source.projectId,
    teamId,
    payload: {
      sourceTaskId: source.id,
      ...(crossTeam ? { crossTeam: true, teamAttached: needsAttach } : {}),
    },
    batch,
  })

  // Notify the assignee (features.notifications), minus the actor.
  if (assigneeId) {
    queueNotification(batch, {
      recipientId: assigneeId,
      type: 'assignment',
      actorId: actor.uid,
      actorName: actor.displayName,
      taskId: newRef.id,
      projectId: source.projectId,
      taskTitle: title,
    })
  }

  await batch.commit()
  return newRef.id
}

// Edit a task's title/description (task creator + anyone with update rights).
// Titles are denormalized in a few places (children's parentTitle for board
// captions, the inverse TaskLink.title on linked docs) — so a title change
// propagates to keep those captions from going stale. Navigation always uses
// ids, so this is caption-consistency, not correctness-critical.
export interface UpdateTaskDetailsInput {
  taskId: string
  title: string
  description: string
  // Presence-keyed: undefined = leave untouched; null = clear; Timestamp = set.
  dueDate?: Timestamp | null
  actorId: string
  actorName: string
}

export async function updateTaskDetails(input: UpdateTaskDetailsInput): Promise<void> {
  const title = input.title.trim()
  if (!title) throw new Error('Title is required.')

  const ref = tenantDoc('tasks', input.taskId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Task not found')
  const task = snap.data() as {
    title?: string
    description?: string
    projectId?: string
    teamId?: string
    dueDate?: Timestamp
    assigneeId?: string | null
    createdBy?: string
    links?: TaskLink[]
  }
  const titleChanged = (task.title ?? '') !== title
  const descriptionChanged = (task.description ?? '') !== input.description
  const dueDateChanged =
    input.dueDate !== undefined &&
    (task.dueDate?.toMillis() ?? null) !== (input.dueDate?.toMillis() ?? null)
  // No-op save (edit card opened and saved untouched) — skip the write so the
  // Activity timeline isn't polluted with empty "edited the task" rows.
  if (!titleChanged && !descriptionChanged && !dueDateChanged) return

  // Read the propagation targets BEFORE opening the batch (Firestore batches
  // can't read). Children carry a denormalized parentTitle; each linked doc
  // carries an inverse link whose title points back at this task.
  let childDocs: Awaited<ReturnType<typeof getDocs>>['docs'] = []
  const linkedUpdates: { ref: DocumentReference; links: TaskLink[] }[] = []
  if (titleChanged) {
    const childrenSnap = await getDocs(
      query(tenantCol('tasks'), where('parentTaskId', '==', input.taskId)),
    )
    childDocs = childrenSnap.docs
    for (const link of task.links ?? []) {
      const otherSnap = await getDoc(tenantDoc('tasks', link.taskId))
      if (!otherSnap.exists()) continue
      const otherLinks = (otherSnap.data() as { links?: TaskLink[] }).links ?? []
      linkedUpdates.push({
        ref: otherSnap.ref,
        links: otherLinks.map((l) => (l.taskId === input.taskId ? { ...l, title } : l)),
      })
    }
  }

  const batch = writeBatch(db)
  batch.update(ref, {
    title,
    description: input.description,
    ...(dueDateChanged ? { dueDate: input.dueDate ?? deleteField() } : {}),
    updatedAt: serverTimestamp(),
  })
  if (titleChanged) {
    for (const c of childDocs) batch.update(c.ref, { parentTitle: title })
    for (const u of linkedUpdates) batch.update(u.ref, { links: u.links })
  }
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'task.updated',
    targetType: 'task',
    targetId: input.taskId,
    targetTitle: title,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.teamId ? { teamId: task.teamId } : {}),
    // Millis, not Timestamp instances — matches the {from,to} plain-value
    // convention and keeps the Activity renderer trivial.
    payload: {
      titleChanged,
      ...(dueDateChanged
        ? {
            dueDate: {
              from: task.dueDate?.toMillis() ?? null,
              to: input.dueDate?.toMillis() ?? null,
            },
          }
        : {}),
    },
    batch,
  })
  // Notify the creator + assignee (minus the actor) of a due-date change, so a
  // moved deadline surfaces in their bell. Reuses the status_update channel.
  if (dueDateChanged && task.projectId) {
    // Due dates are stored as UTC midnight (date-only) — format in UTC so the
    // snippet matches the picker/display instead of shifting a day west of UTC.
    const fmtDue = (ts: Timestamp | null | undefined) =>
      ts ? ts.toDate().toLocaleDateString(undefined, { timeZone: 'UTC' }) : 'none'
    queueNotificationFanout(batch, [task.createdBy, task.assigneeId], {
      type: 'status_update',
      actorId: input.actorId,
      actorName: input.actorName,
      taskId: input.taskId,
      projectId: task.projectId,
      taskTitle: title,
      snippet: `Due date: ${fmtDue(task.dueDate)} → ${fmtDue(input.dueDate)}`,
    })
  }
  await batch.commit()
}