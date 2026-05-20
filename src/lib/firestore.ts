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
  Project,
  ProjectStatus,
  Stage,
  StageEvent,
  StatusUpdatePayload,
  TaskPriority,
  TaskStatus,
  User,
  WorkType,
} from '../types/models'
import {
  getActiveWorkflowId,
  getActiveWorkflowSnapshot,
  getAppConfigSnapshot,
  getWorkflowSnapshot,
} from '../contexts/AppConfigContext'
import { performAction } from './workflowEvaluator'
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

// --- Workflow action helper --------------------------------------------------
// Thin shim used by every stage modal. Reads the project's pinned workflow
// (legacy projects without a workflowId fall back to the active workflow), then
// delegates to workflowEvaluator.performAction. Throws if the snapshot isn't
// available — the caller surfaces that as a "try refreshing" error.

export interface RunWorkflowActionInput {
  project: Project
  user: User
  actionId: string
  inputs: Record<string, unknown>
  // Transitional Sprint 2-3 escape hatch. Modal-side denormalisations (e.g.
  // mirroring an input onto a top-level project field for the old banner)
  // pass extras here. Removed when the new banner ships in Sprint 4.
  extras?: Record<string, unknown>
}

export async function runWorkflowAction(input: RunWorkflowActionInput): Promise<void> {
  const workflow = input.project.workflowId
    ? getWorkflowSnapshot(input.project.workflowId)
    : getActiveWorkflowSnapshot()
  if (!workflow) {
    throw new Error(
      'Workflow definition not loaded — refresh the page or ask an admin to seed it under /admin/config.',
    )
  }
  await performAction({
    project: input.project,
    workflow,
    user: input.user,
    actionId: input.actionId,
    inputs: input.inputs,
    extras: input.extras,
  })
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

  // Phase 2a: pin a workflow at creation. The active workflow id is derived
  // from pipelineEnabled; the doc is read from the cached snapshot. When the
  // snapshot isn't populated yet (pre-seed) we fall back to legacy behaviour
  // — Sprint 1's seed buttons populate the cache before any project is
  // created in a fresh environment.
  const activeWorkflow = getActiveWorkflowSnapshot()
  const activeWorkflowId = getActiveWorkflowId()
  const firstStage = activeWorkflow
    ? [...activeWorkflow.stages].sort((a, b) => a.order - b.order)[0]
    : null

  // Compose the initial history event. Dual-writes stage (legacy) and stageId
  // (new) so the old side panel and the new evaluator both render it. The
  // numeric stage is 1 (legacy "Project creation") for collab; 0 for basic
  // (which never used numeric stages).
  const initialStageEvent: StageEvent = {
    stage: pipelineEnabled ? 1 : (0 as StageEvent['stage']),
    enteredAt: Timestamp.now(),
    enteredBy: input.createdBy,
    payload: null,
    ...(firstStage ? { stageId: firstStage.id } : {}),
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
    // Workflow pinning (Phase 2a). Always written when a workflow is
    // available — both pipeline-on and pipeline-off projects participate.
    ...(activeWorkflow
      ? {
          workflowId: activeWorkflowId,
          currentStageId: firstStage?.id ?? null,
          leadUid: null,
          iterationCount: 0,
        }
      : {}),
    // Legacy tender fields. Written only when pipeline is enabled, matching
    // the pre-2a behaviour so the old StageBanner / usePermissions keep
    // working through Sprints 2-3. Sprint 5 drops this block.
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
      : activeWorkflow
        ? {
            // Pipeline disabled but a workflow is pinned (basic) — still write
            // an initial history entry so the timeline isn't empty.
            stageHistory: [initialStageEvent],
            escalationCount: 0,
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
    payload: activeWorkflow ? { workflowId: activeWorkflowId } : undefined,
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
  // correctly on swimlanes and roll-ups. Also auto-advance the workflow when
  // the lead adds the first team task at the task_setup stage — Phase 2a
  // routes that transition through workflowEvaluator.performAction.
  const projectRef = doc(db, 'projects', input.projectId)
  const projectSnap = await getDoc(projectRef)
  const projectData = projectSnap.exists()
    ? (projectSnap.data() as {
        id?: string
        teamIds?: string[]
        stage?: number
        currentStageId?: string
        workflowId?: string
        ownerId?: string
        leadUid?: string | null
        title?: string
        status?: string
        accessKeys?: string[]
      })
    : null
  const existingTeamIds: string[] = projectData?.teamIds ?? []
  const needsAttach = !existingTeamIds.includes(input.teamId)
  // Auto-advance trigger: either the new currentStageId === 'task_setup' or
  // the legacy stage === 6. Both are accepted during the dual-write window.
  const advanceFromTaskSetup =
    projectData?.currentStageId === 'task_setup' || projectData?.stage === 6

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
  if (needsAttach) {
    batch.update(projectRef, projectPatch)
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

  // Auto-advance: route through performAction so the workflow doc decides what
  // happens. The actor is the project lead (who must also be the task creator
  // at this stage — old code had no separate check, neither does this). When
  // the workflow snapshot isn't available (pre-seed), we silently skip the
  // auto-advance and the lead can advance manually via the banner.
  if (advanceFromTaskSetup) {
    const workflow = getActiveWorkflowSnapshot()
    if (workflow) {
      // Reconstruct a Project shape from the doc snapshot for performAction.
      const project: Project = {
        id: input.projectId,
        title: projectData?.title ?? input.projectTitle,
        description: '',
        ownerId: projectData?.ownerId ?? '',
        status: (projectData?.status as Project['status']) ?? 'in_progress',
        teamIds: existingTeamIds,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        leadUid: projectData?.leadUid ?? null,
        currentStageId: projectData?.currentStageId ?? 'task_setup',
        workflowId: projectData?.workflowId,
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
        // If the workflow refuses (permission, terminal stage, etc.), fall
        // back to legacy direct write so existing UX continues. Sprint 4
        // rewrites this once the banner is generic.
        projectPatch.stage = 7
        projectPatch.currentStageId = 'in_execution'
        projectPatch.stageHistory = arrayUnion({
          stage: 7 as const,
          stageId: 'in_execution',
          enteredAt: Timestamp.now(),
          enteredBy: input.createdBy,
          payload: null,
        })
        batch.update(projectRef, projectPatch)
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
    } else {
      // No workflow available — fall back to legacy direct write.
      projectPatch.stage = 7
      projectPatch.stageHistory = arrayUnion({
        stage: 7 as const,
        enteredAt: Timestamp.now(),
        enteredBy: input.createdBy,
        payload: null,
      })
      batch.update(projectRef, projectPatch)
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