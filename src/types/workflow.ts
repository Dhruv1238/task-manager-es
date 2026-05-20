import type { Timestamp } from 'firebase/firestore'
import type { ProjectStatus, TeamRoleId } from './models'

// Workflow doc shape. Lives at /workflows/{workflowId}. Each tenant ships
// with a seeded workflow (collab-default or basic); future authoring wizard
// (phase 2c) writes tenant-custom docs alongside the seeds.
//
// Phase 2a treats workflow shape as data: the engine renders any workflow that
// matches this schema, so a new workflow is a new doc — not a code change.

export type FlowType = 'collaborative' | 'individual' | 'basic'

export interface Workflow {
  id: string
  displayName: string
  flowType: FlowType
  leadRoleName: string
  isSystemDefined: boolean
  stages: Stage[]
  version: number
  updatedAt: Timestamp
  updatedBy: string
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
  actor: ActorRef
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
  // The project's owner (project.ownerId).
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
