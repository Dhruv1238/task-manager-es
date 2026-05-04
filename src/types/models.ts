import type { Timestamp } from 'firebase/firestore'

export type GlobalRole = 'admin' | 'user'

export type ProjectStatus = 'active' | 'completed' | 'archived'

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked'

export type TaskPriority = 'low' | 'medium' | 'high'

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

// --- Audit trail (forensic-only; not surfaced in UI) -------------------------

export type AuditAction =
  // Project lifecycle
  | 'project.created'
  | 'project.status_updated'
  | 'project.teams_updated'
  // Task lifecycle
  | 'task.created'
  | 'subtask.created'
  | 'task.status_changed'
  | 'task.attachment_added'
  | 'task.attachment_removed'
  // Admin-sensitive
  | 'user.created'
  | 'user.role_changed'
  | 'team.created'
  | 'team.member_added'
  | 'team.member_removed'

export type AuditTargetType = 'project' | 'task' | 'team' | 'user'

export interface AuditEvent {
  id: string
  actorId: string
  actorName: string
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  targetTitle?: string
  projectId?: string
  teamId?: string
  payload?: Record<string, unknown>
  createdAt: Timestamp
}