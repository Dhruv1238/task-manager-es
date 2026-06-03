/**
 * Phase 3 — flow publish gate.
 *
 * Layers the canvas / outcome-graph rules on top of the existing authoring
 * validator (workflowValidation.validateWorkflow). Used by the canvas to drive
 * per-node validity and to gate Publish. Reads actions through the outcome
 * adapter so it works for both v2-authored and legacy single-effect flows.
 *
 * Net-new vs validateWorkflow:
 *   - entry task resolves
 *   - every action has ≥1 mapped actor; `role`-kind actors reference a real role
 *   - every advance/branch outcome routes to a real stage; close → a status
 *   - orphan stages block publish (a warning while editing)
 *   - ≥1 terminal is reachable
 *   - canvas edges reference real stages + outcomes
 */

import type { OrgStructure } from '../types/models'
import type { Stage, Workflow } from '../types/workflow'
import type { RoleDef } from '../types/v2'
import { validateWorkflow, type ValidationIssue, type ValidationResult } from './workflowValidation'
import { readActors, readOutcomes } from './rules/outcomeAdapter'

// Per-stage validity for the canvas node renderer. 'neutral' = no issues but not
// asserted valid (e.g. a terminal node); 'invalid' = blocks publish.
export type NodeValidity = 'valid' | 'invalid' | 'neutral'

export interface FlowValidationResult extends ValidationResult {
  // stageId → validity, for the TaskNode ring.
  nodeValidity: Record<string, NodeValidity>
  // stageId → the first human reason it's invalid (shown on the node).
  nodeReason: Record<string, string>
  publishable: boolean
}

export function validateFlowForPublish(
  workflow: Workflow,
  org: OrgStructure,
  roles: RoleDef[],
): FlowValidationResult {
  const base = validateWorkflow(workflow, org)
  const errors: ValidationIssue[] = [...base.errors]
  const warnings: ValidationIssue[] = [...base.warnings]

  const stageMap = new Map(workflow.stages.map((s) => [s.id, s]))
  const roleIds = new Set(roles.map((r) => r.id))
  const projectRoleIds = new Set((workflow.projectRoles ?? []).map((r) => r.id))
  const statusIds = new Set((workflow.statusOptions ?? []).map((s) => s.id))

  // Entry task resolves (when set explicitly).
  if (workflow.entryStageId && !stageMap.has(workflow.entryStageId)) {
    errors.push({
      severity: 'error',
      code: 'missing_entry_task',
      message: 'The entry task no longer exists. Pick where new projects should start.',
      scope: { kind: 'workflow' },
    })
  }

  for (const stage of workflow.stages) {
    if (stage.isTerminal) continue
    for (const action of stage.actions) {
      // Every action must map to ≥1 actor; `role` actors must exist.
      const actors = readActors(action).all
      if (!actors.length) {
        errors.push({
          severity: 'error',
          code: 'action_no_mapped_role',
          message: `"${action.label}" has no one who can perform it. Map at least one role.`,
          scope: { kind: 'action', stageId: stage.id, actionId: action.id },
        })
      }
      for (const a of actors) {
        if (a.kind === 'role' && !roleIds.has(a.roleId)) {
          errors.push({
            severity: 'error',
            code: 'unknown_role',
            message: `"${action.label}" allows a hierarchy role that no longer exists.`,
            scope: { kind: 'action', stageId: stage.id, actionId: action.id },
          })
        }
        if (a.kind === 'project_role' && !projectRoleIds.has(a.roleId)) {
          errors.push({
            severity: 'error',
            code: 'unknown_project_role',
            message: `"${action.label}" allows a workflow role that no longer exists.`,
            scope: { kind: 'action', stageId: stage.id, actionId: action.id },
          })
        }
      }

      // user_picker inputs must reference a real role / project role when scoped.
      for (const input of action.inputs) {
        if (input.type !== 'user_picker' || !input.pickerScope) continue
        if (input.pickerScope.startsWith('role:') && !roleIds.has(input.pickerScope.slice(5))) {
          errors.push({
            severity: 'error',
            code: 'input_unknown_picker_scope',
            message: `"${input.label}" can be filled by a hierarchy role that no longer exists.`,
            scope: { kind: 'action', stageId: stage.id, actionId: action.id },
          })
        }
        if (
          input.pickerScope.startsWith('project_role:') &&
          !projectRoleIds.has(input.pickerScope.slice('project_role:'.length))
        ) {
          errors.push({
            severity: 'error',
            code: 'input_unknown_picker_scope',
            message: `"${input.label}" can be filled by a workflow role that no longer exists.`,
            scope: { kind: 'action', stageId: stage.id, actionId: action.id },
          })
        }
      }

      // First-class assign: needs a matching user_picker + a real target role.
      const assignCfg = readOutcomes(action).find((o) => o.assign)?.assign
      if (assignCfg) {
        const picker = action.inputs.find(
          (i) => i.id === assignCfg.fromInputId && i.type === 'user_picker',
        )
        if (!picker) {
          errors.push({
            severity: 'error',
            code: 'assign_no_user_picker',
            message: `"${action.label}" assigns a person but has no user picker to choose them.`,
            scope: { kind: 'action', stageId: stage.id, actionId: action.id },
          })
        }
        if (assignCfg.target !== 'lead' && !projectRoleIds.has(assignCfg.target.roleId)) {
          errors.push({
            severity: 'error',
            code: 'assign_unknown_project_role',
            message: `"${action.label}" assigns to a workflow role that no longer exists.`,
            scope: { kind: 'action', stageId: stage.id, actionId: action.id },
          })
        }
      }
      // Every outcome must route somewhere appropriate.
      for (const outcome of readOutcomes(action)) {
        if (outcome.shape === 'advance' || outcome.shape === 'branch') {
          if (!outcome.toStageId || !stageMap.has(outcome.toStageId)) {
            errors.push({
              severity: 'error',
              code: 'outcome_no_target',
              message: `"${action.label}" → "${outcome.label}" doesn't lead anywhere yet. Wire it to a task.`,
              scope: { kind: 'action', stageId: stage.id, actionId: action.id },
            })
          }
        } else if (outcome.shape === 'close') {
          if (
            outcome.terminalStatusId &&
            statusIds.size > 0 &&
            !statusIds.has(outcome.terminalStatusId)
          ) {
            errors.push({
              severity: 'error',
              code: 'outcome_unknown_status',
              message: `"${action.label}" → "${outcome.label}" closes to an unknown status.`,
              scope: { kind: 'action', stageId: stage.id, actionId: action.id },
            })
          }
        }
        // hold needs no target.
      }
    }
  }

  // Reachability following outcome targets (generalises computeReachableStages).
  const reachable = computeReachableViaOutcomes(workflow)
  for (const stage of workflow.stages) {
    if (!reachable.has(stage.id)) {
      errors.push({
        severity: 'error',
        code: 'orphan_task',
        message: `"${stage.displayName}" can't be reached from the entry task.`,
        scope: { kind: 'stage', stageId: stage.id },
      })
    }
  }

  // ≥1 terminal reachable.
  if (!hasReachableTerminal(workflow, reachable)) {
    errors.push({
      severity: 'error',
      code: 'no_reachable_terminal',
      message: 'No path reaches an ending. Add a closing outcome or a terminal task.',
      scope: { kind: 'workflow' },
    })
  }

  // Canvas integrity: every drawn edge references real stages + outcomes.
  if (workflow.canvasLayout) {
    for (const edge of workflow.canvasLayout.edges) {
      const from = stageMap.get(edge.fromTaskId)
      const toOk = stageMap.has(edge.toTaskId)
      const outcomeOk =
        from && from.actions.some((a) => readOutcomes(a).some((o) => o.id === edge.outcomeId))
      if (!from || !toOk || !outcomeOk) {
        errors.push({
          severity: 'error',
          code: 'canvas_dangling_edge',
          message: 'A connection on the canvas points at something that no longer exists.',
          scope: { kind: 'workflow' },
        })
      }
    }
  }

  // Per-node validity for the renderer.
  const nodeValidity: Record<string, NodeValidity> = {}
  const nodeReason: Record<string, string> = {}
  for (const stage of workflow.stages) {
    const stageErrors = errors.filter(
      (e) =>
        (e.scope.kind === 'stage' && e.scope.stageId === stage.id) ||
        (e.scope.kind === 'action' && e.scope.stageId === stage.id),
    )
    if (stageErrors.length) {
      nodeValidity[stage.id] = 'invalid'
      nodeReason[stage.id] = stageErrors[0].message
    } else {
      nodeValidity[stage.id] = stage.isTerminal ? 'neutral' : 'valid'
    }
  }

  return {
    errors,
    warnings,
    nodeValidity,
    nodeReason,
    publishable: errors.length === 0,
  }
}

function computeReachableViaOutcomes(workflow: Workflow): Set<string> {
  const reachable = new Set<string>()
  if (!workflow.stages.length) return reachable
  const entry =
    (workflow.entryStageId && workflow.stages.find((s) => s.id === workflow.entryStageId)) ||
    [...workflow.stages].sort((a, b) => a.order - b.order)[0]
  reachable.add(entry.id)
  const queue: string[] = [entry.id]
  const stageMap = new Map(workflow.stages.map((s) => [s.id, s]))
  while (queue.length) {
    const stage = stageMap.get(queue.shift()!)
    if (!stage) continue
    for (const action of stage.actions) {
      for (const outcome of readOutcomes(action)) {
        const target = outcome.toStageId
        if (target && !reachable.has(target)) {
          reachable.add(target)
          queue.push(target)
        }
      }
    }
  }
  return reachable
}

function hasReachableTerminal(workflow: Workflow, reachable: Set<string>): boolean {
  for (const stage of workflow.stages) {
    if (!reachable.has(stage.id)) continue
    if (stage.isTerminal) return true
    for (const action of stage.actions) {
      for (const outcome of readOutcomes(action)) {
        if (outcome.shape === 'close') return true
      }
    }
  }
  return false
}

// Re-export so the canvas imports validity types from one place.
export type { Stage }
