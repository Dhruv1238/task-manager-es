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
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '../types/models'
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
  writeBatch,
  type Timestamp,
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

// --- Projects (Sprint 3 — Flow 2, Sprint 4 — Flow 3) ---------------------------

export interface AddProjectInput {
  title: string
  description: string
  ownerId: string
  createdBy: string
  actorName: string
  deadline?: Timestamp
  attachments?: Attachment[]
}

export async function addProject(input: AddProjectInput): Promise<string> {
  const batch = writeBatch(db)
  const projectRef = doc(collection(db, 'projects'))
  batch.set(projectRef, {
    title: input.title,
    description: input.description,
    ownerId: input.ownerId,
    createdBy: input.createdBy,
    status: 'active',
    teamIds: [],
    attachments: input.attachments ?? [],
    ...(input.deadline ? { deadline: input.deadline } : {}),
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

export interface SetProjectStatusInput {
  projectId: string
  projectTitle: string
  fromStatus: ProjectStatus
  toStatus: ProjectStatus
  actorId: string
  actorName: string
}

export async function setProjectStatus(input: SetProjectStatusInput): Promise<void> {
  if (input.fromStatus === input.toStatus) return
  const batch = writeBatch(db)
  batch.update(doc(db, 'projects', input.projectId), {
    status: input.toStatus,
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'project.status_updated',
    targetType: 'project',
    targetId: input.projectId,
    targetTitle: input.projectTitle,
    projectId: input.projectId,
    payload: { from: input.fromStatus, to: input.toStatus },
    batch,
  })
  await batch.commit()
}

export interface SetProjectTeamsInput {
  projectId: string
  projectTitle: string
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
}

export async function addTeamTask(input: AddTeamTaskInput): Promise<string> {
  const batch = writeBatch(db)
  const taskRef = doc(collection(db, 'tasks'))
  batch.set(taskRef, {
    projectId: input.projectId,
    teamId: input.teamId,
    parentTaskId: null,
    title: input.title,
    description: input.description,
    assigneeId: null,
    status: 'todo',
    priority: input.priority,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    teamName: input.teamName,
    projectTitle: input.projectTitle,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    attachments: [],
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  recordAuditEvent({
    actorId: input.createdBy,
    actorName: input.actorName,
    action: 'task.created',
    targetType: 'task',
    targetId: taskRef.id,
    targetTitle: input.title,
    projectId: input.projectId,
    teamId: input.teamId,
    batch,
  })
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
