/**
 * Central module for multi-document Firestore writes.
 *
 * Every function here owns the denormalization rules in TASK_MANAGEMENT_MVP.md §8 — use `writeBatch` so
 * primary writes and counter updates land atomically. Components MUST go through this module for any
 * write that touches more than one document.
 *
 * Signatures live here from Sprint 0; bodies are filled in by the sprint that needs them (see plan).
 */

import type { Attachment, ProjectStatus, TaskPriority, TaskStatus } from '../types/models'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// --- Teams (Sprint 2 — Flow 1) -------------------------------------------------

export interface AddTeamInput {
  name: string
  description?: string
  leadId: string
  memberIds: string[]
  createdBy: string
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

  await batch.commit()
  return teamRef.id
}

export async function addMemberToTeam(teamId: string, uid: string): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'teams', teamId), { memberIds: arrayUnion(uid) })
  batch.update(doc(db, 'users', uid), { teamIds: arrayUnion(teamId) })
  await batch.commit()
}

export async function removeMemberFromTeam(teamId: string, uid: string): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'teams', teamId), { memberIds: arrayRemove(uid) })
  batch.update(doc(db, 'users', uid), { teamIds: arrayRemove(teamId) })
  await batch.commit()
}

// --- Projects (Sprint 3 — Flow 2, Sprint 4 — Flow 3) ---------------------------

export interface AddProjectInput {
  title: string
  description: string
  ownerId: string
  createdBy: string
  deadline?: Timestamp
  attachments?: Attachment[]
}

export async function addProject(input: AddProjectInput): Promise<string> {
  const ref = await addDoc(collection(db, 'projects'), {
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
  return ref.id
}

export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    status,
    updatedAt: serverTimestamp(),
  })
}

export interface SetProjectTeamsInput {
  projectId: string
  previousTeamIds: string[]
  newTeamIds: string[]
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
}

export async function addTeamTask(input: AddTeamTaskInput): Promise<string> {
  const ref = await addDoc(collection(db, 'tasks'), {
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
  return ref.id
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

  await batch.commit()
  return subtaskRef.id
}

// Updates a task's status. If the task is a subtask that just crossed the "done" boundary
// in either direction, also updates the parent's `subtaskDoneCount` in the same batch (§8).
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const ref = doc(db, 'tasks', taskId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Task not found')
  const task = snap.data() as { status: TaskStatus; parentTaskId: string | null }
  if (task.status === status) return

  const batch = writeBatch(db)
  batch.update(ref, {
    status,
    updatedAt: serverTimestamp(),
    completedAt: status === 'done' ? serverTimestamp() : null,
  })

  if (task.parentTaskId) {
    const wasDone = task.status === 'done'
    const isDone = status === 'done'
    if (wasDone !== isDone) {
      batch.update(doc(db, 'tasks', task.parentTaskId), {
        subtaskDoneCount: increment(isDone ? 1 : -1),
        updatedAt: serverTimestamp(),
      })
    }
  }

  await batch.commit()
}

export async function addTaskAttachment(
  taskId: string,
  attachment: Attachment,
): Promise<void> {
  await updateDoc(doc(db, 'tasks', taskId), {
    attachments: arrayUnion(attachment),
    updatedAt: serverTimestamp(),
  })
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