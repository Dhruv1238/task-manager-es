/**
 * Authoring-time validator for a Workflow draft. Distinct from
 * workflowEvaluator's runtime validation (which checks inputs at action
 * commit) — this runs as the author edits, surfacing structural problems
 * before they reach Firestore.
 *
 * Returns lists of errors (block save) and warnings (allow save with confirm).
 * Each issue carries a stable scope (workflow / stage / action / input) so
 * the side-editor's validation panel can build click-to-jump links.
 */
import type { OrgStructure, TeamRoleId } from '../types/models'
import type {
  ActorRef,
  Stage,
  StageAction,
  Workflow,
} from '../types/workflow'

export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  // Where in the workflow the issue lives — drives click-to-jump behaviour.
  scope:
    | { kind: 'workflow' }
    | { kind: 'stage'; stageId: string }
    | { kind: 'action'; stageId: string; actionId: string }
    | { kind: 'input'; stageId: string; actionId: string; inputId: string }
    // Phase 2d: the People & Roles / Project Fields / Statuses tabs.
    | { kind: 'role'; roleId: string }
    | { kind: 'field'; fieldId: string }
    | { kind: 'status' }
}

export interface ValidationResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export function validateWorkflow(
  workflow: Workflow,
  org: OrgStructure,
): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (!workflow.displayName.trim()) {
    errors.push({
      severity: 'error',
      code: 'missing_display_name',
      message: 'The workflow needs a name.',
      scope: { kind: 'workflow' },
    })
  }
  if (workflow.stages.length === 0) {
    errors.push({
      severity: 'error',
      code: 'no_stages',
      message: 'Add at least one stage.',
      scope: { kind: 'workflow' },
    })
    return { errors, warnings }
  }

  const stageIds = new Set<string>()
  const duplicateStageIds = new Set<string>()
  for (const stage of workflow.stages) {
    if (stageIds.has(stage.id)) duplicateStageIds.add(stage.id)
    stageIds.add(stage.id)
  }
  for (const dup of duplicateStageIds) {
    errors.push({
      severity: 'error',
      code: 'duplicate_stage_id',
      message: `Two stages share the id "${dup}".`,
      scope: { kind: 'stage', stageId: dup },
    })
  }

  // A workflow has "a way to finish" if any of these is true:
  //   - some stage is terminal, OR
  //   - some action is `mark_complete` (forces a status flip + closes the
  //     project regardless of stage), OR
  //   - some action is `set_status` and includes at least one closing status.
  // Tender-style workflows finish via the `set_status` route at a non-terminal
  // delivered stage — the rule has to accept that.
  if (!hasFinishPath(workflow)) {
    errors.push({
      severity: 'error',
      code: 'no_finish_path',
      message:
        "Projects can't finish on this workflow — mark a stage as terminal, OR add a 'Mark complete' action, OR add a status action that can set a closing status (completed / lost / not_submitted / archived).",
      scope: { kind: 'workflow' },
    })
  }

  for (const stage of workflow.stages) {
    validateStage(stage, workflow, org, errors, warnings)
  }
  // Phase 2d: roles / custom fields / statuses (the new authoring tabs).
  validateExtras(workflow, errors, warnings)
  // `warnings` is captured as an alias for the same array so validateStage
  // can push into it via the parameter — kept named explicitly for clarity at
  // call site.

  const reachable = computeReachableStages(workflow)
  for (const stage of workflow.stages) {
    if (!reachable.has(stage.id)) {
      warnings.push({
        severity: 'warning',
        code: 'unreachable_stage',
        message: `"${stage.displayName}" can't be reached from the first stage. Add an action that moves to it, or remove it.`,
        scope: { kind: 'stage', stageId: stage.id },
      })
    }
  }

  return { errors, warnings }
}

function validateStage(
  stage: Stage,
  workflow: Workflow,
  org: OrgStructure,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  if (!stage.displayName.trim()) {
    errors.push({
      severity: 'error',
      code: 'missing_stage_name',
      message: 'Stage needs a name.',
      scope: { kind: 'stage', stageId: stage.id },
    })
  }
  if (!stage.isTerminal && stage.actions.length === 0) {
    errors.push({
      severity: 'error',
      code: 'no_actions_on_non_terminal',
      message: `"${stage.displayName}" has no actions — projects entering this stage can't move forward.`,
      scope: { kind: 'stage', stageId: stage.id },
    })
  }
  if (stage.isTerminal && stage.actions.length > 0) {
    warnings.push({
      severity: 'warning',
      code: 'terminal_with_actions',
      message: `"${stage.displayName}" is terminal but has actions — the actions won't run.`,
      scope: { kind: 'stage', stageId: stage.id },
    })
  }

  const actionIds = new Set<string>()
  for (const action of stage.actions) {
    if (actionIds.has(action.id)) {
      errors.push({
        severity: 'error',
        code: 'duplicate_action_id',
        message: `Two actions in "${stage.displayName}" share id "${action.id}".`,
        scope: { kind: 'action', stageId: stage.id, actionId: action.id },
      })
    }
    actionIds.add(action.id)
    validateAction(action, stage, workflow, org, errors, warnings)
  }
}

function validateAction(
  action: StageAction,
  stage: Stage,
  workflow: Workflow,
  org: OrgStructure,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  if (!action.label.trim()) {
    errors.push({
      severity: 'error',
      code: 'missing_action_label',
      message: `Action in "${stage.displayName}" is missing a label.`,
      scope: { kind: 'action', stageId: stage.id, actionId: action.id },
    })
  }

  validateActor(action.actor, action, stage, workflow, org, errors)
  for (const allow of action.alsoAllow ?? []) {
    validateActor(allow, action, stage, workflow, org, errors)
  }

  // Phase 2d: warn when only super-admins can perform an action (the author
  // likely unticked everyone). Not an error — a super-admin-only action is valid.
  const actorSet = [action.actor, ...(action.alsoAllow ?? [])]
  if (actorSet.every((a) => a.kind === 'global_role' && a.role === 'super_admin')) {
    warnings.push({
      severity: 'warning',
      code: 'only_super_admin_can_act',
      message: `Only super-admins can do "${action.label}". Add at least one role or person so the work isn't stuck.`,
      scope: { kind: 'action', stageId: stage.id, actionId: action.id },
    })
  }

  const stageIds = new Set(workflow.stages.map((s) => s.id))
  switch (action.effect.kind) {
    case 'transition':
    case 'transition_with_counter':
    case 'assign_lead':
    case 'clear_lead':
    case 'mark_complete': {
      if (!stageIds.has(action.effect.toStage)) {
        errors.push({
          severity: 'error',
          code: 'unknown_target_stage',
          message: `"${action.label}" moves to a stage that doesn't exist ("${action.effect.toStage}").`,
          scope: { kind: 'action', stageId: stage.id, actionId: action.id },
        })
      }
      break
    }
    case 'set_status':
      if (action.effect.statuses.length === 0) {
        errors.push({
          severity: 'error',
          code: 'no_statuses',
          message: `"${action.label}" needs at least one status option.`,
          scope: { kind: 'action', stageId: stage.id, actionId: action.id },
        })
      }
      break
  }
  if (action.effect.kind === 'mark_complete' && action.effect.outcomes.length === 0) {
    errors.push({
      severity: 'error',
      code: 'no_outcomes',
      message: `"${action.label}" marks complete but lists no outcomes.`,
      scope: { kind: 'action', stageId: stage.id, actionId: action.id },
    })
  }

  if (action.effect.kind === 'assign_lead') {
    const hasUserPicker = action.inputs.some((i) => i.type === 'user_picker')
    if (!hasUserPicker) {
      errors.push({
        severity: 'error',
        code: 'assign_lead_missing_user_picker',
        message: `"${action.label}" assigns a lead but doesn't ask for one — add a user picker input.`,
        scope: { kind: 'action', stageId: stage.id, actionId: action.id },
      })
    }
  }

  for (const input of action.inputs) {
    if (!input.label.trim()) {
      errors.push({
        severity: 'error',
        code: 'missing_input_label',
        message: `An input on "${action.label}" is missing a label.`,
        scope: { kind: 'input', stageId: stage.id, actionId: action.id, inputId: input.id },
      })
    }
    if (input.type === 'user_picker' && !input.pickerScope) {
      errors.push({
        severity: 'error',
        code: 'user_picker_missing_scope',
        message: `"${input.label}" needs to specify who can be picked.`,
        scope: { kind: 'input', stageId: stage.id, actionId: action.id, inputId: input.id },
      })
    }
    if ((input.type === 'select' || input.type === 'status_select') && (!input.options || input.options.length === 0)) {
      errors.push({
        severity: 'error',
        code: 'select_missing_options',
        message: `"${input.label}" needs at least one option.`,
        scope: { kind: 'input', stageId: stage.id, actionId: action.id, inputId: input.id },
      })
    }
  }
}

function validateActor(
  actor: ActorRef,
  action: StageAction,
  stage: Stage,
  workflow: Workflow,
  org: OrgStructure,
  errors: ValidationIssue[],
): void {
  if (actor.kind === 'team_role') {
    const has = teamRoleAvailable(actor.role, org)
    if (!has) {
      errors.push({
        severity: 'error',
        code: 'team_role_not_configured',
        message: `"${action.label}" references the ${humanizeTeamRole(actor.role)} role, but your org doesn't have that role configured. Update your org structure or pick a different actor.`,
        scope: { kind: 'action', stageId: stage.id, actionId: action.id },
      })
    }
  }
  // Phase 2d: a project_role actor must reference a role that still exists.
  if (actor.kind === 'project_role') {
    const exists = (workflow.projectRoles ?? []).some((r) => r.id === actor.roleId)
    if (!exists) {
      errors.push({
        severity: 'error',
        code: 'unknown_project_role',
        message: `"${action.label}" allows a project role that no longer exists. Re-pick who can do it.`,
        scope: { kind: 'action', stageId: stage.id, actionId: action.id },
      })
    }
  }
}

// Phase 2d: validate the People & Roles / Project Fields / Statuses tabs.
function validateExtras(
  workflow: Workflow,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  for (const role of workflow.projectRoles ?? []) {
    if (!role.label.trim()) {
      warnings.push({
        severity: 'warning',
        code: 'missing_role_label',
        message: 'A project role has no name yet.',
        scope: { kind: 'role', roleId: role.id },
      })
    }
  }

  for (const field of workflow.projectFields?.customFields ?? []) {
    if (field.deprecated) continue
    if (!field.label.trim()) {
      warnings.push({
        severity: 'warning',
        code: 'missing_field_label',
        message: 'A project field has no name yet.',
        scope: { kind: 'field', fieldId: field.id },
      })
    }
    if (
      (field.type === 'select' || field.type === 'multiSelect') &&
      (field.options?.length ?? 0) === 0
    ) {
      errors.push({
        severity: 'error',
        code: 'select_field_no_options',
        message: `"${field.label || 'A dropdown field'}" needs at least one option.`,
        scope: { kind: 'field', fieldId: field.id },
      })
    }
  }

  const statusIds = new Set<string>()
  for (const status of workflow.statusOptions ?? []) {
    if (statusIds.has(status.id)) {
      errors.push({
        severity: 'error',
        code: 'duplicate_status_id',
        message: `Two statuses share the id "${status.id}".`,
        scope: { kind: 'status' },
      })
    }
    statusIds.add(status.id)
    if (!status.label.trim()) {
      warnings.push({
        severity: 'warning',
        code: 'missing_status_label',
        message: 'A status has no name yet.',
        scope: { kind: 'status' },
      })
    }
  }
}

function teamRoleAvailable(role: TeamRoleId, org: OrgStructure): boolean {
  switch (role) {
    case 'coordinator':
      return org.teamRoles.hasCoordinator
    case 'validator':
      return org.teamRoles.hasValidator
    case 'specialist':
      return org.teamRoles.hasSpecialist
  }
}

function humanizeTeamRole(role: TeamRoleId): string {
  switch (role) {
    case 'coordinator':
      return 'Coordinator'
    case 'validator':
      return 'Validator'
    case 'specialist':
      return 'Specialist'
  }
}

// Statuses considered "closing" — match isProjectClosed's hardcoded set in
// src/lib/projectStatus.ts so the validator's finish-path heuristic stays in
// sync with the runtime's closure semantics.
const CLOSING_STATUSES = new Set(['completed', 'lost', 'not_submitted', 'archived'])

// A workflow "has a way to finish" if any of:
//   1. some stage is marked terminal, OR
//   2. some action's effect is mark_complete (closes the project), OR
//   3. some action's effect is set_status and the allowed statuses include
//      at least one closing status (the project can be flipped to a closed
//      status from inside the workflow).
// The seeded collaborative (Tender) workflow finishes via route 3 — the
// coordinator's record_outcome action sets a closing status at the
// non-terminal delivered stage.
function hasFinishPath(workflow: Workflow): boolean {
  if (workflow.stages.some((s) => s.isTerminal)) return true
  for (const stage of workflow.stages) {
    for (const action of stage.actions) {
      if (action.effect.kind === 'mark_complete') return true
      if (action.effect.kind === 'set_status') {
        if (action.effect.statuses.some((s) => CLOSING_STATUSES.has(s))) {
          return true
        }
      }
    }
  }
  return false
}

// BFS from the first-ordered stage following every action's effect.toStage.
// Stages with no incoming transition aren't reachable.
function computeReachableStages(workflow: Workflow): Set<string> {
  const reachable = new Set<string>()
  if (workflow.stages.length === 0) return reachable
  const first = [...workflow.stages].sort((a, b) => a.order - b.order)[0]
  reachable.add(first.id)
  const queue: string[] = [first.id]
  const stageMap = new Map(workflow.stages.map((s) => [s.id, s]))
  while (queue.length) {
    const id = queue.shift()!
    const stage = stageMap.get(id)
    if (!stage) continue
    for (const action of stage.actions) {
      let target: string | null = null
      switch (action.effect.kind) {
        case 'transition':
        case 'transition_with_counter':
        case 'assign_lead':
        case 'clear_lead':
        case 'mark_complete':
          target = action.effect.toStage
          break
        case 'set_status':
        case 'assign_project_role':
          target = null
          break
      }
      if (target && !reachable.has(target)) {
        reachable.add(target)
        queue.push(target)
      }
    }
  }
  return reachable
}
