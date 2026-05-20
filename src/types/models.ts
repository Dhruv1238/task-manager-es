import { Timestamp } from 'firebase/firestore'
import type { ProjectHistoryEvent, Workflow } from './workflow'

// Re-exported so legacy consumers of models.ts pick up the new event types
// from a single import site.
export type {
  ProjectHistoryEvent,
  StageEvent,
  WorkflowAssignmentEvent,
  WorkflowChangeEvent,
} from './workflow'

export type GlobalRole = 'super_admin' | 'admin' | 'horizontal_lead' | 'user'

// Tender outcome status. Default 'in_progress' is implicit "no outcome yet".
// The remaining values capture the lifecycle state of the pitch. 'awarded' is
// a positive milestone but not terminal — the project then runs to 'completed'
// once delivery wraps up.
export type ProjectStatus =
  | 'in_progress'
  | 'submitted'
  | 'not_submitted'
  | 'awarded'
  | 'completed'
  | 'lost'
  | 'on_hold'
  // Simple-mode terminal state (Client B): work parked or filed away without a
  // tender-style outcome. Counts as closed.
  | 'archived'

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked'

export type TaskPriority = 'low' | 'medium' | 'high'

/**
 * @deprecated Phase 1 generalizes work types to a tenant-configured string[]
 * on Team.workTypes. The enum is retained for legacy Task.workType reads and
 * the seedTender.ts bootstrap; remove in phase 2.
 */
export type WorkType = 'CS' | 'CT' | '2D' | '3D' | 'VE'

// Org-structure role a team can play. Resolved per-tenant via /config/orgStructure
// and read from team.teamRoleId. Null means uncategorized — the team participates
// in v1 surfaces but not in role-specific workflow gates.
export type TeamRoleId = 'coordinator' | 'validator' | 'specialist'

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
  // Per-project "last opened the chat" high-water marks. Compared against
  // project.chatLastMessageAt to render unread dots on the projects list and to
  // compute the in-project unread count.
  chatLastReadAt?: { [projectId: string]: Timestamp }
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
  /**
   * @deprecated Phase 1 replaces `kind` with `teamRoleId` resolved through
   * /config/orgStructure. Retained on existing docs for the migration window;
   * application code stops reading it after phase 1 ships.
   */
  kind?: 'department' | 'horizontal'
  /**
   * @deprecated Phase 1 generalizes the single workType into workTypes: string[].
   * Backfilled by the migration; new writes should use workTypes.
   */
  workType?: WorkType
  // Phase 1: org-structure role this team plays. Null = uncategorized.
  // Resolved by src/lib/orgResolver.ts together with /config/orgStructure.
  teamRoleId?: TeamRoleId | null
  // Phase 1: work types this team specializes in. Empty unless teamRoleId === 'specialist'.
  // Free-form tenant-defined strings (e.g. '2D', '3D', 'Video', 'Copy').
  workTypes?: string[]
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
  // ─── Workflow-driven fields (Phase 2a+) ──────────────────────────────────
  // The workflow this project is pinned to. Every project carries one — the
  // basic workflow is the implicit default for tenants with no other active
  // workflow. Kept as a denormalized convenience for Firestore queries; the
  // authoritative source for stage/action/role info is `pinnedWorkflow`.
  workflowId: string
  // Phase 2c: snapshot of the workflow doc at project creation time. Once set,
  // never updated — workflow edits never affect in-flight projects. All
  // workflow readers (StageBanner, ActionModal, etc.) prefer this over
  // re-fetching /workflows/{workflowId}. Optional only for legacy projects
  // created before 2c; the dev-only backfill (lib/migratePinnedWorkflow.ts)
  // populates it everywhere before client handoff.
  pinnedWorkflow?: Workflow
  // Stable string id of the project's current stage in the workflow doc.
  currentStageId: string
  // Discriminated-union timeline of every event in the project's lifecycle.
  // First event is always `{ kind: 'workflow_assignment' }` written at
  // creation; subsequent events are `{ kind: 'stage' }` for transitions. See
  // src/types/workflow.ts for the ProjectHistoryEvent shape.
  projectHistory: ProjectHistoryEvent[]
  // ─── Pipeline-role pinned user (collaborative + individual flows) ────────
  // Absent on basic-flow projects (no lead concept). Set by the
  // `assign_lead` effect; cleared by `clear_lead`.
  leadUid?: string | null
  iterationCount?: number
  escalationCount?: number
  // ─── Collaborative-flow denormalisations ─────────────────────────────────
  // Carry collab-only metadata. Present on collab projects only; the new
  // project form gates their visibility on flowType, and ProjectDetail reads
  // them defensively (optional).
  submissionDate?: Timestamp
  presentationDate?: Timestamp
  // Latest status-update note (mirrors the most recent set_status payload on
  // projectHistory). Convenience for rendering pill subtitles without
  // scanning history.
  statusNote?: string
  // Lead's eligibility assessment, captured on accept. Mirrors the latest
  // eligibility payload on projectHistory so the banner / status modal can
  // surface it without timeline traversal.
  eligibilityNote?: string
  // Chat: denormalized "latest activity" timestamp, bumped in the same writeBatch
  // as every chat mutation so the projects-list unread dot needs zero extra reads.
  chatLastMessageAt?: Timestamp
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

// App-wide configuration doc shape (Firestore at /config/appConfig).
// Written by super_admins via /admin/config; read by every authenticated client
// once at boot (with a 24h localStorage TTL).
//
// Phase 2b retired `pipeline.enabled` — workflow selection lives in
// /workflows/_registry. The migration script writes deleteField() to strip
// the legacy key from existing docs.
export interface AppConfig {
  // Monotonic counter bumped on every save. Drives cache invalidation when the
  // admin screen pushes an update — clients compare to localStorage and refresh.
  version: number
  updatedAt: Timestamp
  updatedBy: string
  features: {
    chat: boolean
  }
}

// Org-structure singleton doc shape (Firestore at /config/orgStructure).
// Decouples tenant org shape from code. Written by the setup wizard and the
// /admin/config Organization-structure section. Read at boot via the same
// 24h localStorage TTL pattern as AppConfig — see AppConfigContext.tsx.
export interface OrgStructure {
  version: number
  updatedAt: Timestamp
  updatedBy: string

  // Display string for the person who runs projects (e.g. 'Vertical Head',
  // 'Account Manager'). Used in UI labels only, never in conditional logic.
  leadRoleName: string

  // Which team roles exist in this org. All three optional.
  teamRoles: {
    hasCoordinator: boolean
    hasValidator: boolean
    hasSpecialist: boolean
  }

  // Tenant-defined work types specialist teams handle.
  // Empty when teamRoles.hasSpecialist is false.
  workTypes: string[]

  // Phase 1 only supports 'manual'. Pool/Auto land in phase 3.
  allotment: {
    mode: 'manual'
  }

  // First-time setup completion. Drives the /admin/setup auto-launch.
  setupCompleted: boolean
}

// Default used when /config/orgStructure is missing AND no localStorage
// snapshot exists. Intentionally minimal (not tender-shaped) so a fresh tenant
// gets owner-only behavior until they walk through the wizard.
export const DEFAULT_ORG_STRUCTURE: OrgStructure = {
  version: 0,
  updatedAt: Timestamp.fromMillis(0),
  updatedBy: '',
  leadRoleName: 'Project Lead',
  teamRoles: { hasCoordinator: false, hasValidator: false, hasSpecialist: false },
  workTypes: [],
  allotment: { mode: 'manual' },
  setupCompleted: false,
}

// Suggestion chips for the wizard work-types step and the /admin/config
// Work-types editor. Tenants can add custom values; these are just primers.
export const WORK_TYPE_SUGGESTIONS: readonly string[] = [
  '2D Design',
  '3D Design',
  'Video Editing',
  'Motion Graphics',
  'Copywriting',
  'Set Design',
  'AV',
  'Photography',
]

// --- Audit trail (forensic-only; not surfaced in UI) -------------------------

export type AuditAction =
  // Project lifecycle (mirrored from stageHistory for cross-entity queryability)
  | 'project.created'
  | 'project.stage_transitioned'
  // Phase 2a: generic workflow action performed via workflowEvaluator.performAction.
  // Coexists with project.stage_transitioned until Sprint 5 retires it.
  | 'project.action_performed'
  | 'project.status_updated'
  | 'project.teams_updated'
  | 'project.attachment_added'
  // Task lifecycle
  | 'task.created'
  | 'subtask.created'
  | 'task.status_changed'
  | 'task.assignee_changed'
  | 'task.submitted_for_review'
  | 'task.review_approved'
  | 'task.review_rejected'
  | 'task.attachment_added'
  | 'task.attachment_removed'
  // Admin-sensitive
  | 'user.created'
  | 'user.role_changed'
  | 'team.created'
  | 'team.member_added'
  | 'team.member_removed'
  | 'team.lead_changed'
  // Org-structure (phase 1)
  | 'org_structure.setup_completed'
  | 'org_structure.updated'

export interface ChatAttachment {
  url: string
  name: string
  contentType: string
  sizeBytes: number
  key?: string
}

// Per-project chat message. Lives at `projects/{projectId}/chat/{messageId}`.
// `serverUpdatedAt` is bumped on every write (create, edit) and drives the delta
// listener — one query covers all change types.
export interface ChatMessage {
  id: string
  authorId: string
  text: string
  createdAt: Timestamp
  serverUpdatedAt: Timestamp
  editedAt?: Timestamp
  attachments?: ChatAttachment[]
}

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
