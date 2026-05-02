import type { Timestamp } from 'firebase/firestore'

export type GlobalRole = 'super_admin' | 'admin' | 'horizontal_lead' | 'user'

// Tender outcome status. Default 'in_progress' is implicit "no outcome yet".
// The remaining values capture the lifecycle state of the pitch.
export type ProjectStatus =
  | 'in_progress'
  | 'submitted'
  | 'not_submitted'
  | 'awarded'
  | 'lost'
  | 'on_hold'

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked'

export type TaskPriority = 'low' | 'medium' | 'high'

export type WorkType = 'CS' | 'CT' | '2D' | '3D' | 'VE'

// Tender workflow stage.
// Stage 5 = eligibility review (super admin gates the VH's acceptance).
export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type StagePriority = 'low' | 'medium' | 'high'

export interface User {
  uid: string
  email: string
  displayName: string
  photoURL?: string
  globalRole: GlobalRole
  teamIds: string[]
  tempPassword?: string
  createdBy?: string
  createdAt: Timestamp
}

export interface Team {
  id: string
  name: string
  description?: string
  leadId: string
  memberIds: string[]
  projectIds: string[]
  createdAt: Timestamp
  createdBy: string
  // Tender additions:
  kind?: 'department' | 'horizontal'
  workType?: WorkType
}

export interface EscalationPayload {
  reason: string
  eta?: Timestamp
  priority: StagePriority
}

export interface IterationPayload {
  iteration: number
  feedback: string
  eta?: Timestamp
  priority: StagePriority
}

// Replaces DeliveryPayload — used both at stage 10 (CS records outcome) and any
// other time VH or CS updates the status mid-flow. Always recorded in stageHistory.
export interface StatusUpdatePayload {
  from: ProjectStatus
  to: ProjectStatus
  note: string
}

// VH's eligibility assessment when accepting a tender. Recorded on stage-5
// entry; super admin reads this to decide whether to advance to task setup.
export interface EligibilityNotePayload {
  note: string
}

export type StageEventPayload =
  | EscalationPayload
  | IterationPayload
  | StatusUpdatePayload
  | EligibilityNotePayload
  | null

export interface StageEvent {
  stage: Stage
  enteredAt: Timestamp
  enteredBy: string
  payload?: StageEventPayload
}

export interface Project {
  id: string
  title: string
  description: string
  ownerId: string
  status: ProjectStatus
  deadline?: Timestamp
  teamIds: string[]
  attachments?: Attachment[]
  createdAt: Timestamp
  updatedAt: Timestamp
  // Tender additions:
  vhId?: string | null
  stage?: Stage
  stageHistory?: StageEvent[]
  escalationCount?: number
  vhIterationCount?: number
  submissionDate?: Timestamp
  presentationDate?: Timestamp
  // Last status-update note (mirrors the most recent StatusUpdatePayload in
  // stageHistory). Convenience for rendering the pill subtitle without scanning history.
  statusNote?: string
  // VH's eligibility assessment, captured on Accept. Mirrors the latest
  // EligibilityNotePayload so the StageBanner can render it without history scans.
  eligibilityNote?: string
}

export interface Attachment {
  id: string
  name: string
  url: string
  key: string
  mimeType: string
  sizeBytes: number
  uploadedBy: string
  uploadedAt: Timestamp
}

export interface Task {
  id: string
  projectId: string
  teamId: string
  parentTaskId: string | null

  title: string
  description: string

  assigneeId: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate?: Timestamp

  assigneeName?: string
  teamName?: string
  projectTitle?: string

  subtaskCount?: number
  subtaskDoneCount?: number

  attachments: Attachment[]

  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt?: Timestamp
  // Tender additions:
  workType?: WorkType
  reviewerId?: string | null
  reviewerName?: string | null
}

export interface Comment {
  id: string
  taskId: string
  authorId: string
  authorName: string
  content: string
  attachments: Attachment[]
  createdAt: Timestamp
  editedAt?: Timestamp
}

// Stage reference card (delta §4) — user-facing labels (no internal jargon).
export const STAGE_NAMES: Record<Stage, string> = {
  1: 'Project creation',
  2: 'Awaiting VH',
  3: 'Escalation',
  4: 'Accepted',
  5: 'Eligibility review',
  6: 'Task setup',
  7: 'In execution',
  8: 'VH review',
  9: 'Rework',
  10: 'Sent to client',
}

// Compact one-word labels for tight spaces (chart axes, etc.)
export const STAGE_SHORT_NAMES: Record<Stage, string> = {
  1: 'Created',
  2: 'Awaiting VH',
  3: 'Escalation',
  4: 'Accepted',
  5: 'Eligibility',
  6: 'Setup',
  7: 'Execution',
  8: 'Review',
  9: 'Rework',
  10: 'Sent',
}

// Friendly status helper for the stage banner.
export const STAGE_HEADLINE: Record<Stage, string> = {
  1: 'Awaiting allocation to a Vertical Head',
  2: 'Awaiting VH decision',
  3: 'Escalated — back to allocation queue',
  4: 'Accepted',
  5: 'Awaiting super admin eligibility review',
  6: 'Add tasks for each team to start execution',
  7: 'Teams executing',
  8: 'VH reviewing with CS',
  9: 'Reworking after VH feedback',
  10: 'Pitch sent to client',
}

// Task template config doc shape (Firestore at /config/taskTemplates).
export interface TaskTemplate {
  code: WorkType
  label: string
  teamId: string
  defaultTitle: string
}

export interface TaskTemplateConfig {
  templates: TaskTemplate[]
}
