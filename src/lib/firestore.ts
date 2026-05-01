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
  EscalationPayload,
  IterationPayload,
  ProjectStatus,
  Stage,
  StageEvent,
  StatusUpdatePayload,
  TaskPriority,
  TaskStatus,
  WorkType,
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
  Timestamp,
  updateDoc,
  writeBatch,
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

// Set a team's lead. Ensures the new lead is in the team's memberIds and that
// the user doc reflects the team membership (idempotent — safe to call when
// they're already a member).
export async function setTeamLead(teamId: string, newLeadUid: string): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'teams', teamId), {
    leadId: newLeadUid,
    memberIds: arrayUnion(newLeadUid),
  })
  batch.update(doc(db, 'users', newLeadUid), {
    teamIds: arrayUnion(teamId),
  })
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
  // Tender additions:
  submissionDate?: Timestamp
  presentationDate?: Timestamp
}

export async function addProject(input: AddProjectInput): Promise<string> {
  // Firestore rejects serverTimestamp() inside arrays — fall back to Timestamp.now()
  // for events stored in `stageHistory[]`. The top-level `createdAt`/`updatedAt`
  // fields still use the authoritative serverTimestamp().
  const initialStageEvent: StageEvent = {
    stage: 1,
    enteredAt: Timestamp.now(),
    enteredBy: input.createdBy,
    payload: null,
  }

  const ref = await addDoc(collection(db, 'projects'), {
    title: input.title,
    description: input.description,
    ownerId: input.ownerId,
    createdBy: input.createdBy,
    status: 'in_progress',
    teamIds: [],
    attachments: input.attachments ?? [],
    ...(input.deadline ? { deadline: input.deadline } : {}),
    // Tender bootstrap (every new project starts at stage 1):
    vhId: null,
    stage: 1,
    stageHistory: [initialStageEvent],
    escalationCount: 0,
    vhIterationCount: 0,
    ...(input.submissionDate ? { submissionDate: input.submissionDate } : {}),
    ...(input.presentationDate ? { presentationDate: input.presentationDate } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export interface UpdateProjectStatusInput {
  projectId: string
  fromStatus: ProjectStatus
  toStatus: ProjectStatus
  note: string
  enteredBy: string
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
  await updateDoc(doc(db, 'projects', input.projectId), {
    status: input.toStatus,
    statusNote: trimmed,
    stageHistory: arrayUnion(event),
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
  enteredBy: string
  // Live `stage` field after the transition. Sometimes differs from the recorded event
  // stage (e.g., escalation: live=1, event=3; iteration: live=7, event=9 then 7).
  toStage: Stage
  // The one or more StageEvent entries to append to history. The first event's `stage`
  // is what will be visible in the timeline; if you also want the "live" stage recorded,
  // append a second event for it.
  events: Array<{
    stage: Stage
    payload?: EscalationPayload | IterationPayload | StatusUpdatePayload | null
  }>
  // Extra patch fields (e.g., { vhId: null, escalationCount: increment(1) }).
  extras?: Record<string, unknown>
}

export async function transitionStage(input: TransitionStageInput): Promise<void> {
  if (!input.events.length) throw new Error('transitionStage requires at least one event')

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

  await updateDoc(doc(db, 'projects', input.projectId), patch)
}

// --- Task review transitions (delta §3.4 + §5 Flow 18) -----------------------

export interface TransitionTaskToReviewInput {
  taskId: string
  reviewerId: string
  reviewerName?: string
  notes?: string
  authorId: string
  authorName: string
}

// Move a task to in_review with a named reviewer. Optional notes are added as a comment in the same batch.
export async function transitionTaskToReview(
  input: TransitionTaskToReviewInput,
): Promise<void> {
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
  }

  await batch.commit()
}