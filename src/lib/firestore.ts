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
  EligibilityNotePayload,
  EscalationPayload,
  GlobalRole,
  IterationPayload,
  ProjectStatus,
  Stage,
  StageEvent,
  StatusUpdatePayload,
  TaskPriority,
  TaskStatus,
  WorkType,
} from '../types/models'
import { getAppConfigSnapshot } from '../contexts/AppConfigContext'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from './firebase'

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
  const ref = doc(collection(db, 'auditEvents'))
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
  if (input.batch) {
    input.batch.set(ref, data)
    return
  }
  return setDoc(ref, data)
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
  const teamRef = doc(collection(db, 'teams'))

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
    batch.update(doc(db, 'users', uid), {
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
  batch.update(doc(db, 'teams', input.teamId), { memberIds: arrayUnion(input.uid) })
  batch.update(doc(db, 'users', input.uid), { teamIds: arrayUnion(input.teamId) })
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
  batch.update(doc(db, 'teams', input.teamId), { memberIds: arrayRemove(input.uid) })
  batch.update(doc(db, 'users', input.uid), { teamIds: arrayRemove(input.teamId) })
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
  batch.update(doc(db, 'teams', input.teamId), {
    leadId: input.newLeadUid,
    memberIds: arrayUnion(input.newLeadUid),
  })
  batch.update(doc(db, 'users', input.newLeadUid), {
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
}

// --- Projects (Sprint 3 — Flow 2, Sprint 4 — Flow 3) ---------------------------

export interface AddProjectInput {
  title: string
  description: string
  ownerId: string
  createdBy: string
  actorName: string
  deadline?: Timestamp
  attachments?: Attachment[]
  // Tender additions:
  submissionDate?: Timestamp
  presentationDate?: Timestamp
}

export async function addProject(input: AddProjectInput): Promise<string> {
  // Firestore rejects serverTimestamp() inside arrays — fall back to Timestamp.now()
  // for events stored in `stageHistory[]`. The top-level `createdAt`/`updatedAt`
  // fields still use the authoritative serverTimestamp().
  const pipelineEnabled = getAppConfigSnapshot().pipeline.enabled

  const initialStageEvent: StageEvent = {
    stage: 1,
    enteredAt: Timestamp.now(),
    enteredBy: input.createdBy,
    payload: null,
  }

  const batch = writeBatch(db)
  const projectRef = doc(collection(db, 'projects'))
  batch.set(projectRef, {
    title: input.title,
    titleLower: input.title.trim().toLowerCase(),
    description: input.description,
    ownerId: input.ownerId,
    createdBy: input.createdBy,
    status: 'in_progress',
    teamIds: [],
    accessKeys: [input.ownerId],
    attachments: input.attachments ?? [],
    ...(input.deadline ? { deadline: input.deadline } : {}),
    // Tender bootstrap — only when the pipeline is enabled. Simple mode (Client B)
    // creates a project with owner + status + no stages, no VH.
    ...(pipelineEnabled
      ? {
          vhId: null,
          stage: 1,
          stageHistory: [initialStageEvent],
          escalationCount: 0,
          vhIterationCount: 0,
          ...(input.submissionDate ? { submissionDate: input.submissionDate } : {}),
          ...(input.presentationDate ? { presentationDate: input.presentationDate } : {}),
        }
      : {}),
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
    batch,
  })
  await batch.commit()
  return projectRef.id
}

export interface UpdateProjectStatusInput {
  projectId: string
  projectTitle: string
  fromStatus: ProjectStatus
  toStatus: ProjectStatus
  note: string
  enteredBy: string
  actorName: string
  // The stage at which the update was made — recorded on the history event so
  // the timeline can show "Status changed to Awarded at stage 10".
  stage: Stage
}

// Update project.status and append a status_update event to stageHistory atomically.
// Used at stage 10 (CS records outcome) and any other time VH/CS adjusts the status.
export async function updateProjectStatus(input: UpdateProjectStatusInput): Promise<void> {
  const trimmed = input.note.trim()
  if (!trimmed) {
    throw new Error('A note is required when updating the project status.')
  }
  const payload: StatusUpdatePayload = {
    from: input.fromStatus,
    to: input.toStatus,
    note: trimmed,
  }
  const event: StageEvent = {
    stage: input.stage,
    enteredAt: Timestamp.now(),
    enteredBy: input.enteredBy,
    payload,
  }
  const batch = writeBatch(db)
  batch.update(doc(db, 'projects', input.projectId), {
    status: input.toStatus,
    statusNote: trimmed,
    stageHistory: arrayUnion(event),
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
    payload: { from: input.fromStatus, to: input.toStatus, note: trimmed, stage: input.stage },
    batch,
  })
  await batch.commit()
}

export interface SetProjectTeamsInput {
  projectId: string
  projectTitle: string
  // Needed to keep the denormalized `accessKeys` (= [ownerId, ...teamIds]) in
  // sync, which powers non-admin visibility queries on the Projects list.
  ownerId: string
  previousTeamIds: string[]
  newTeamIds: string[]
  actorId: string
  actorName: string
}

// Atomically updates `projects/{id}.teamIds` and mirrors the change into each
// affected team's `projectIds` (§8 denormalization).
export async function setProjectTeams(input: SetProjectTeamsInput): Promise<void> {
  const previous = new Set(input.previousTeamIds)
  const next = new Set(input.newTeamIds)
  const added = [...next].filter((id) => !previous.has(id))
  const removed = [...previous].filter((id) => !next.has(id))

  const batch = writeBatch(db)
  batch.update(doc(db, 'projects', input.projectId), {
    teamIds: input.newTeamIds,
    accessKeys: [input.ownerId, ...input.newTeamIds],
    updatedAt: serverTimestamp(),
  })
  for (const teamId of added) {
    batch.update(doc(db, 'teams', teamId), {
      projectIds: arrayUnion(input.projectId),
    })
  }
  for (const teamId of removed) {
    batch.update(doc(db, 'teams', teamId), {
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
}

export async function addTeamTask(input: AddTeamTaskInput): Promise<string> {
  // Ensure the team is attached to the project: VH may pick a template whose
  // canonical team isn't yet on the project — auto-attach so the task renders
  // correctly on swimlanes and roll-ups. Also advance stage 6 → 7 the moment
  // the first team task is added (no separate confirmation step).
  const projectRef = doc(db, 'projects', input.projectId)
  const projectSnap = await getDoc(projectRef)
  const projectData = projectSnap.exists()
    ? (projectSnap.data() as { teamIds?: string[]; stage?: number })
    : null
  const existingTeamIds: string[] = projectData?.teamIds ?? []
  const needsAttach = !existingTeamIds.includes(input.teamId)
  const advanceFromStage6 = projectData?.stage === 6

  const batch = writeBatch(db)
  const taskRef = doc(collection(db, 'tasks'))
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
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  const projectPatch: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (needsAttach) {
    projectPatch.teamIds = arrayUnion(input.teamId)
    // Keep the denormalized visibility array in sync so non-admin members of
    // the auto-attached team can see this project on the Projects listing.
    projectPatch.accessKeys = arrayUnion(input.teamId)
  }
  if (advanceFromStage6) {
    projectPatch.stage = 7
    projectPatch.stageHistory = arrayUnion({
      stage: 7,
      enteredAt: Timestamp.now(),
      enteredBy: input.createdBy,
      payload: null,
    })
  }
  if (needsAttach || advanceFromStage6) {
    batch.update(projectRef, projectPatch)
  }
  if (needsAttach) {
    batch.update(doc(db, 'teams', input.teamId), {
      projectIds: arrayUnion(input.projectId),
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
  if (advanceFromStage6) {
    recordAuditEvent({
      actorId: input.createdBy,
      actorName: input.actorName,
      action: 'project.stage_transitioned',
      targetType: 'project',
      targetId: input.projectId,
      targetTitle: input.projectTitle,
      projectId: input.projectId,
      payload: { fromStage: 6, toStage: 7 },
      batch,
    })
  }
  await batch.commit()
  return taskRef.id
}

export interface AddSubtaskInput {
  parentTaskId: string
  projectId: string
  teamId: string
  title: string
  description?: string
  priority: TaskPriority
  dueDate?: Timestamp
  assigneeId: string
  assigneeName: string
  teamName: string
  projectTitle: string
  createdBy: string
  actorName: string
}

export async function addSubtask(input: AddSubtaskInput): Promise<string> {
  const batch = writeBatch(db)
  const subtaskRef = doc(collection(db, 'tasks'))

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
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  batch.update(doc(db, 'tasks', input.parentTaskId), {
    subtaskCount: increment(1),
    updatedAt: serverTimestamp(),
  })

  recordAuditEvent({
    actorId: input.createdBy,
    actorName: input.actorName,
    action: 'subtask.created',
    targetType: 'task',
    targetId: subtaskRef.id,
    targetTitle: input.title,
    projectId: input.projectId,
    teamId: input.teamId,
    payload: { parentTaskId: input.parentTaskId, assigneeId: input.assigneeId },
    batch,
  })

  await batch.commit()
  return subtaskRef.id
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
  const ref = doc(db, 'tasks', input.taskId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Task not found')
  const task = snap.data() as {
    status: TaskStatus
    parentTaskId: string | null
    title?: string
    projectId?: string
    teamId?: string
  }
  if (task.status === input.status) return

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
      batch.update(doc(db, 'tasks', task.parentTaskId), {
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
  batch.update(doc(db, 'projects', input.projectId), {
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
  batch.update(doc(db, 'tasks', input.taskId), {
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
  batch.update(doc(db, 'tasks', input.taskId), {
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
  batch.update(doc(db, 'users', input.uid), { globalRole: input.toRole })
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
}

export async function addComment(input: AddCommentInput): Promise<string> {
  const ref = await addDoc(collection(db, 'tasks', input.taskId, 'comments'), {
    taskId: input.taskId,
    authorId: input.authorId,
    authorName: input.authorName,
    content: input.content,
    attachments: input.attachments ?? [],
    createdAt: serverTimestamp(),
  })
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
  const ref = await addDoc(collection(db, 'projects', input.projectId, 'comments'), {
    projectId: input.projectId,
    authorId: input.authorId,
    authorName: input.authorName,
    content: input.content,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

// --- Tender stage transitions (delta §5) --------------------------------------
// Every project stage transition goes through `transitionStage` so the live `stage`
// field and `stageHistory` audit trail land in the same writeBatch (delta §5 global note).

export interface TransitionStageInput {
  projectId: string
  projectTitle: string
  enteredBy: string
  actorName: string
  // Live `stage` field after the transition. Sometimes differs from the recorded event
  // stage (e.g., escalation: live=1, event=3; iteration: live=7, event=9 then 7).
  toStage: Stage
  // The one or more StageEvent entries to append to history. The first event's `stage`
  // is what will be visible in the timeline; if you also want the "live" stage recorded,
  // append a second event for it.
  events: Array<{
    stage: Stage
    payload?:
      | EscalationPayload
      | IterationPayload
      | StatusUpdatePayload
      | EligibilityNotePayload
      | null
  }>
  // Extra patch fields (e.g., { vhId: null, escalationCount: increment(1) }).
  extras?: Record<string, unknown>
}

export async function transitionStage(input: TransitionStageInput): Promise<void> {
  if (!input.events.length) throw new Error('transitionStage requires at least one event')

  // Read the current stage so the audit event can record fromStage → toStage.
  const projectRef = doc(db, 'projects', input.projectId)
  const projectSnap = await getDoc(projectRef)
  const fromStage = projectSnap.exists()
    ? (projectSnap.data() as { stage?: Stage }).stage
    : undefined

  // serverTimestamp() can't live inside arrays; use Timestamp.now() for stageHistory entries.
  const now = Timestamp.now()
  const stageEvents: StageEvent[] = input.events.map((e) => ({
    stage: e.stage,
    enteredAt: now,
    enteredBy: input.enteredBy,
    payload: e.payload ?? null,
  }))

  const patch: Record<string, unknown> = {
    stage: input.toStage,
    stageHistory: arrayUnion(...stageEvents),
    updatedAt: serverTimestamp(),
    ...(input.extras ?? {}),
  }

  const batch = writeBatch(db)
  batch.update(projectRef, patch)
  recordAuditEvent({
    actorId: input.enteredBy,
    actorName: input.actorName,
    action: 'project.stage_transitioned',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: input.projectTitle,
    projectId: input.projectId,
    payload: {
      ...(fromStage !== undefined ? { fromStage } : {}),
      toStage: input.toStage,
      eventStages: input.events.map((e) => e.stage),
    },
    batch,
  })
  await batch.commit()
}

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
    const snap = await getDoc(doc(db, 'tasks', input.taskId))
    if (snap.exists()) {
      const data = snap.data() as { title?: string; projectId?: string }
      taskTitle = taskTitle ?? data.title
      projectId = projectId ?? data.projectId
    }
  }

  const batch = writeBatch(db)
  batch.update(doc(db, 'tasks', input.taskId), {
    status: 'in_review',
    reviewerId: input.reviewerId,
    reviewerName: input.reviewerName ?? null,
    updatedAt: serverTimestamp(),
  })
  const trimmed = input.notes?.trim()
  if (trimmed) {
    const commentRef = doc(collection(db, 'tasks', input.taskId, 'comments'))
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

  const ref = doc(db, 'tasks', input.taskId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Task not found')
  const task = snap.data() as {
    status: TaskStatus
    parentTaskId: string | null
    assigneeId: string | null
    assigneeName?: string
    title?: string
    projectId?: string
  }

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
      batch.update(doc(db, 'tasks', task.parentTaskId), {
        subtaskDoneCount: increment(1),
        updatedAt: serverTimestamp(),
      })
    }
    if (trimmed) {
      const commentRef = doc(collection(db, 'tasks', input.taskId, 'comments'))
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
      batch.update(doc(db, 'tasks', task.parentTaskId), {
        subtaskDoneCount: increment(-1),
        updatedAt: serverTimestamp(),
      })
    }
    const commentRef = doc(collection(db, 'tasks', input.taskId, 'comments'))
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
  }

  await batch.commit()
}