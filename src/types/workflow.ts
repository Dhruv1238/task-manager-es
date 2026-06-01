import type { Timestamp } from 'firebase/firestore'
import type { ProjectStatus, TeamRoleId } from './models'

// Sentinel doc id for the workflow-registry singleton, sibling of the
// per-workflow docs under /workflows/. Chosen with a leading underscore so it
// can never collide with a tenant-authored workflow id (validated at write time
// in 2c's authoring wizard).
export const WORKFLOW_REGISTRY_ID = '_registry'

// Workflow doc shape. Lives at /workflows/{workflowId}. Each tenant ships
// with a seeded workflow (collab-default or basic); future authoring wizard
// (phase 2c) writes tenant-custom docs alongside the seeds.
//
// Phase 2a treats workflow shape as data: the engine renders any workflow that
// matches this schema, so a new workflow is a new doc — not a code change.

export type FlowType = 'collaborative' | 'individual' | 'basic'

// ─── Phase 2d authoring types ────────────────────────────────────────────────
// Shared colour palette token. Maps 1:1 to the `pill-*` utilities and the
// `--color-*-dot` vars in src/index.css. Stored as the tone NAME (never a hex)
// so role/field/status chips stay theme-aware in light + dark. Resolve to class
// strings via the STATIC maps in src/lib/fieldTokens.ts (Tailwind v4 JIT would
// purge template-interpolated class names).
export type PillColor =
  | 'info' | 'success' | 'warn' | 'danger' | 'brandtone'
  | 'accent' | 'cool' | 'mint' | 'neutral' | 'orange' | 'yellow' | 'pink'

// Author-defined named role slot on a project. id is a stable slug frozen on the
// first label and NEVER reused — relabelling never moves it.
export interface ProjectRoleDef {
  id: string
  label: string
  // One holder (false) or a list of holders (true).
  multiple: boolean
  // Must be filled at project creation.
  required: boolean
  // Pre-fill this slot with the creator on new projects.
  assignedToCreatorOnNew?: boolean
  // Optional helper text shown under the picker.
  description?: string
  order: number
}

export type CustomFieldType =
  | 'text' | 'longText' | 'number' | 'currency'
  | 'date' | 'select' | 'multiSelect' | 'user' | 'email' | 'phone' | 'url'

// Where a custom field is surfaced. Each field can appear on any subset.
export type FieldSurface = 'createForm' | 'sidebar' | 'listColumn' | 'filter'

export interface CustomFieldOption {
  // Stable slug; what project.fields stores (renames never orphan values).
  id: string
  label: string
  color?: PillColor
}

export interface CustomFieldDef {
  // Stable slug, frozen on first label, never reused.
  id: string
  label: string
  type: CustomFieldType
  // Enforced only when 'createForm' is in surfaces.
  required: boolean
  surfaces: FieldSurface[]
  // select / multiSelect only.
  options?: CustomFieldOption[]
  placeholder?: string
  helpText?: string
  // Shared create-form + sidebar order.
  order: number
  // Soft delete: hidden on new projects, retained (greyed) on existing.
  deprecated?: boolean
}

export interface ProjectFieldsConfig {
  customFields?: CustomFieldDef[]
}

// Author-defined status option. id is the stored value (project.status);
// label/color drive display. closing marks a terminal/closed status.
export interface WorkflowStatusOption {
  id: string
  label: string
  color: PillColor
  order: number
  closing?: boolean
}

export interface Workflow {
  id: string
  displayName: string
  flowType: FlowType
  // Optional per-workflow override of `orgStructure.leadRoleName`. Empty string
  // (or missing) means readers resolve the org-wide value. Phase 2c sets this
  // by default only when the wizard's "Lead role override" field is filled in
  // the Settings drawer — the conversational wizard never asks for it.
  leadRoleName: string
  isSystemDefined: boolean
  stages: Stage[]
  // Phase 2b: uids the new-project lead picker surfaces under a "Recommended"
  // group for this workflow. Soft hint — any pickerScope-valid user remains
  // selectable. Empty (or missing) means the picker just lists everyone
  // alphabetically. Managed from /admin/config → Workflows → kebab → Manage
  // recommended leads.
  recommendedLeads?: string[]
  // ─── Phase 2d additions (all optional → pre-2d docs keep working) ─────────
  // Author-defined named role slots a project of this workflow fills with
  // specific users (e.g. "Vertical Head", "Admin Head"). Holders feed accessKeys
  // and are matchable via ActorRef { kind: 'project_role' }.
  projectRoles?: ProjectRoleDef[]
  // Author-defined extra fields captured on a project, each placed on one or
  // more surfaces (create form / sidebar / list column / filter).
  projectFields?: ProjectFieldsConfig
  // Author-defined status options (id/label/color). When present, the status
  // pill + UpdateProjectStatus modal render these instead of the hardcoded
  // flow-type defaults. Status ids are stored on project.status.
  statusOptions?: WorkflowStatusOption[]
  // Who may change project.status via the direct status-pill path. Resolved
  // through actorMatches (same engine as actions). Absent → legacy flow-type
  // rule + createdBy baseline (see canUpdateProjectStatus).
  canUpdateStatusActors?: ActorRef[]
  // Phase 2c: optional long-form copy shown in the wizard's first step and the
  // template picker description. Falls back to a derived flow-type sentence.
  description?: string
  // Phase 2c: optional subtitle under the template card title (4-card picker).
  // Falls back to "<flowType> flow · N stages".
  creationModalCardSubtitle?: string
  // Phase 2c: optional copy under NewProjectModal's title. Falls back to the
  // existing flow-type-derived sentence.
  creationModalDescription?: string
  version: number
  // Phase 2c: last-edited timestamp + actor surfaced in /admin/config
  // workflows table. Distinct from updatedAt which mirrors createdAt for new
  // docs; lastEditedAt only bumps on user-driven saves through the editor.
  lastEditedAt?: Timestamp
  lastEditedBy?: string
  updatedAt: Timestamp
  updatedBy: string
}

// Phase 2b: registry singleton at /workflows/_registry. Tracks which seeded
// workflows are *active* (selectable by project creators) and which is the
// default in the new-project modal. Independent of the per-workflow docs so
// activation toggles don't churn the workflow doc itself.
export interface WorkflowRegistry {
  version: number
  updatedAt: Timestamp
  updatedBy: string
  // Workflow ids in display order. The new-project modal's picker and the
  // dashboard tabs render in this order; the first active is the implicit
  // default when `defaultWorkflowId` is null.
  activeWorkflowIds: string[]
  // Pre-selected in the new-project modal. Cleared automatically when the
  // referenced workflow is deactivated.
  defaultWorkflowId: string | null
}

export interface Stage {
  id: string
  displayName: string
  // Optional shorter label for tight spaces — pipeline funnel x-axis ticks,
  // chart legends, etc. Falls back to displayName.
  shortDisplayName?: string
  // Optional rich banner copy with {leadRoleName} and {validatorTeamName}
  // placeholders interpolated at render time. Falls back to displayName.
  headline?: string
  // Optional secondary line under the headline (e.g. "Lead is reviewing").
  hint?: string
  order: number
  isTerminal: boolean
  actions: StageAction[]
}

export interface StageAction {
  id: string
  label: string
  // Canonical actor for this action — owns the button in /me inbox routing.
  // The evaluator checks this first; if it matches, the action surfaces both
  // in the banner and on the canonical actor's inbox.
  actor: ActorRef
  // Override actors that ALSO grant permission to perform this action. Used
  // when several actor classes are equivalent for a given action (e.g. the
  // creator marks complete, but admins / super_admin can also do it). One
  // button per action — the banner doesn't render duplicates. For /me inbox
  // routing, alsoAllow does NOT surface — only the canonical actor does, so
  // override actors aren't pestered with someone else's work.
  //
  // Distinct from team_role's nested alsoAllow which has the additional
  // "team absent" semantics; that's preserved for back-compat with the
  // collab workflow.
  alsoAllow?: ActorRef[]
  effect: ActionEffect
  inputs: ActionInput[]
  // Banner button styling hint. The engine never reads it; only the renderer.
  intent?: 'primary' | 'success' | 'danger' | 'neutral'
}

// Discriminated union — the evaluator dispatches on `kind`. Add a new kind
// here and one matching case in workflowEvaluator.ts to extend the model.
export type ActorRef =
  | { kind: 'global_role'; role: 'super_admin' | 'admin' }
  // The project-pinned lead (project.leadUid).
  | { kind: 'pipeline_role'; role: 'lead' }
  // A team playing a configured org role, scoped to the project's teams.
  // `member: 'lead'` = team.leadId; `member: 'any'` = team.memberIds.
  //
  // `alsoAllow` lists extra actors who can ALSO perform this action — used
  // both as defence-in-depth (e.g. project lead steps in when validator is
  // unavailable) and to keep the project unblocked when the expected team
  // isn't attached. The semantic is split:
  //   - For permission checks: alsoAllow is always honoured (those actors
  //     can perform the action whether or not the team is present).
  //   - For /me inbox routing: alsoAllow actors only surface the project
  //     when the team is missing. When the team IS present, the action
  //     belongs to the team's lead — don't pester everyone else.
  | {
      kind: 'team_role'
      role: TeamRoleId
      member: 'lead' | 'any'
      alsoAllow?: ActorRef[]
    }
  // Phase 2d: a user holding a named project role (project.roleAssignments[roleId]).
  // Matches if the viewer's uid is the assigned value (single) or appears in the
  // assigned array (multiple). roleId references workflow.projectRoles[].id.
  | { kind: 'project_role'; roleId: string }
  // The project's creator. Resolves to project.createdBy, falling back to the
  // legacy project.ownerId for pre-2d projects.
  | { kind: 'creator' }

// Discriminated union of side effects an action can produce on a project.
// Every effect carries its target stage id; transition_with_counter additionally
// bumps the named counter on the project.
export type ActionEffect =
  | { kind: 'transition'; toStage: string }
  | { kind: 'transition_with_counter'; toStage: string; counter: 'escalation' | 'iteration' }
  // Reads the chosen lead uid from inputs (a 'user_picker' input).
  | { kind: 'assign_lead'; toStage: string }
  // Clears project.leadUid in the same batch as the transition (used by
  // escalation back to 'created'). Optionally bumps the named counter so
  // escalation also records as one "escalation" event on the project.
  | { kind: 'clear_lead'; toStage: string; counter?: 'escalation' | 'iteration' }
  // Sets project.status to one of the listed values. Does NOT transition the
  // stage — used at `delivered` for record-outcome (awarded/lost/not_submitted)
  // where the coordinator records the pitch result but the project stays open
  // pending follow-up work. Status closure is determined by `isProjectClosed`.
  | { kind: 'set_status'; statuses: ProjectStatus[] }
  // Closes the project: sets currentStageId to `toStage`, sets status to the
  // chosen outcome. Used by basic flow's mark_complete and by reject-paths in
  // the collab flow where the tender is dropped (e.g. eligibility_review reject).
  | { kind: 'mark_complete'; toStage: string; outcomes: ProjectStatus[] }
  // Phase 2d (RESERVED — not surfaced in EffectPicker): assigns the user(s)
  // chosen in a user_picker input to the named project role and recomputes
  // accessKeys. Declared now so a future "VH assigns AH as a gated stage action"
  // needs no migration. The evaluator treats it as stay-on-current-stage.
  | { kind: 'assign_project_role'; roleId: string }

export interface ActionInput {
  id: string
  label: string
  type: 'text' | 'textarea' | 'date' | 'select' | 'user_picker' | 'status_select'
  required: boolean
  // For 'select' / 'status_select'.
  options?: string[]
  // For 'user_picker'. The form is "<scope>:<value>" so the modal can dispatch
  // on the first segment to choose UserPicker filtering. Examples:
  //   'global_role:admin' — users with globalRole === 'admin'
  //   'team_role:specialist/any' — any member of any specialist team on the project
  pickerScope?: string
}

// ─── Project history events ─────────────────────────────────────────────────
// Discriminated union over every event recorded on a project's timeline. Lives
// on `project.projectHistory: ProjectHistoryEvent[]`. Replaces the pre-2b
// `stageHistory` array which was implicitly stage-only.
//
// Three kinds:
//   - 'stage'               — entered a new stage (every transition).
//   - 'workflow_assignment' — workflow pinned at creation (always first event).
//   - 'workflow_change'     — workflow swapped on an in-flight project (no 2b
//                             UI; reserved data slot for 2c).
//
// Renderers walk the union via the `kind` discriminator and dispatch per
// variant. Forward compatibility: adding a new kind requires one variant here
// + one case in the side-panel renderer; existing data continues to render.

export interface StageEvent {
  kind: 'stage'
  // Stable id referencing a stage in the workflow doc this event belongs to.
  // Resolves to a displayName via workflow.stages.find(s => s.id === stageId).
  stageId: string
  enteredAt: Timestamp
  enteredBy: string
  // Optional: the workflow action that drove the transition. Empty for the
  // synthetic initial-stage event written by addProject.
  actionId?: string
  // Generic payload mirrors the action's inputs (action.inputs[].id → value).
  // Renderers resolve labels back to ActionInput declarations via the
  // workflow doc. Set to null when the action had no inputs.
  payload?: Record<string, unknown> | null
}

export interface WorkflowAssignmentEvent {
  kind: 'workflow_assignment'
  workflowId: string
  assignedAt: Timestamp
  assignedBy: string
}

export interface WorkflowChangeEvent {
  kind: 'workflow_change'
  fromWorkflowId: string
  toWorkflowId: string
  changedAt: Timestamp
  changedBy: string
  reason: string
}

// Phase 2d: a project role slot was assigned/reassigned/cleared via setProjectRole.
export interface RoleAssignedEvent {
  kind: 'role_assigned'
  // References workflow.projectRoles[].id.
  roleId: string
  // Value after the change: a uid (single), uid[] (multiple), or null (cleared).
  value: string | string[] | null
  assignedAt: Timestamp
  assignedBy: string
}

// Phase 2d: a custom project field was edited via setProjectField.
export interface FieldUpdatedEvent {
  kind: 'field_updated'
  // References workflow.projectFields.customFields[].id.
  fieldId: string
  // Raw value written. Renderers resolve the label via the field def.
  value: unknown
  updatedAt: Timestamp
  updatedBy: string
}

export type ProjectHistoryEvent =
  | StageEvent
  | WorkflowAssignmentEvent
  | WorkflowChangeEvent
  | RoleAssignedEvent
  | FieldUpdatedEvent

// Thrown by workflowEvaluator.performAction when inputs fail validation or the
// caller lacks permission. UI surfaces .message; engine code reads .code.
export class WorkflowValidationError extends Error {
  code:
    | 'missing_required_input'
    | 'invalid_input_value'
    | 'invalid_option'
    | 'invalid_user_picker'
    | 'permission_denied'
    | 'unknown_action'
    | 'terminal_stage'
    | 'unknown_stage'

  constructor(
    code: WorkflowValidationError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowValidationError'
    this.code = code
  }
}
