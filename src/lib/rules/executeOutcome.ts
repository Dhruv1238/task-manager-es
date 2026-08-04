/**
 * Phase 3 — the single client-side outcome transaction.
 *
 * Applies a selected Outcome's shape + enabled effects + outcomeLog + accessKeys
 * recompute + analytics counters in ONE atomic writeBatch, with no server
 * round-trip (Firebase, no Cloud Functions). This is the v2 evolution of
 * performAction's effect dispatch; it is reached from runWorkflowAction ONLY for
 * actions that carry authored v2 `outcomes`. Legacy single-`effect` actions
 * (every seed) keep flowing through performAction unchanged — so this path can
 * never regress them.
 *
 * For an action synthesized from a legacy effect (outcome.legacyEffectKind set),
 * executeOutcome replays the exact lead/counter/status semantics performAction
 * would have, so even a v2-authored flow that reuses a legacy shape behaves
 * identically.
 */

import {
  arrayUnion,
  increment,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  tenantDoc,
  recordAuditEvent,
  recomputeProjectAccessKeys,
  leadRoleLabel,
  projectRoleLabel,
  queueRoleAssignmentNotifications,
} from '../firestore'
import {
  WorkflowValidationError,
  actorOnlyMatch,
  canPerform,
  getCurrentStage,
  validateActionInputs,
  type RoleResolutionCtx,
} from '../workflowEvaluator'
import { findOutcome, readActors } from './outcomeAdapter'
import { bumpStatusTally, stageEnteredPatch } from './analyticsCounters'
import type { AuditAction, OrgStructure, Project, Team, User } from '../../types/models'
import type { Workflow } from '../../types/workflow'
import type { Effect, FieldCondition, OutcomeLogEntry, RoleDef } from '../../types/v2'

export interface ExecuteOutcomeArgs {
  project: Project
  workflow: Workflow
  user: User
  actionId: string
  outcomeId: string
  inputs: Record<string, unknown>
  // Full context for the permission re-check. Optional/empty is tolerated — the
  // UI already gated rendering; this is defence-in-depth.
  teams?: Team[]
  org?: OrgStructure
  roles?: RoleDef[]
  // The tenant user directory, so accessKeys can enumerate `role`-actor holders
  // and an assignment makes its target visible. Optional → enrichment skipped.
  users?: User[]
  effective?: import('../../types/v2').EffectivePermissions | null
  batch?: WriteBatch
  extras?: Record<string, unknown>
  // Creation-time auto-allocation ONLY (addProject). Skips the actor check and
  // the availableWhen gate, and narrows the required-input check to
  // `requireOnly`. See PerformActionArgs.bypassGates for the rationale; the
  // availableWhen skip is additionally necessary because the condition reads
  // project.fields, which are only being written in this same batch.
  bypassGates?: { requireOnly: string[] }
}

function err(code: WorkflowValidationError['code'], message: string): WorkflowValidationError {
  return new WorkflowValidationError(code, message)
}

// Evaluate the minimal single-comparison availableWhen gate against project.fields.
function passesCondition(cond: FieldCondition, project: Project): boolean {
  const actual = project.fields?.[cond.fieldId]
  switch (cond.op) {
    case 'eq':
      return actual === cond.value
    case 'neq':
      return actual !== cond.value
    case 'gt':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual > cond.value
    case 'lt':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual < cond.value
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(actual as never)
  }
}

export async function executeOutcome(args: ExecuteOutcomeArgs): Promise<void> {
  const { project, workflow, user, actionId, outcomeId, inputs } = args
  const teams = args.teams ?? []
  const org = args.org ?? ({} as OrgStructure)
  const roleCtx: RoleResolutionCtx = { roles: args.roles ?? [], effective: args.effective ?? null }

  // 1. Resolve action + outcome on the current stage.
  const stage = getCurrentStage(project, workflow)
  if (stage.isTerminal) {
    throw err('terminal_stage', `Stage "${stage.displayName}" is terminal — no actions allowed.`)
  }
  const action = stage.actions.find((a) => a.id === actionId)
  if (!action) {
    throw err('unknown_action', `Action "${actionId}" not available at "${stage.displayName}".`)
  }
  const outcome = findOutcome(action, outcomeId)
  if (!outcome) {
    throw err('invalid_option', `Outcome "${outcomeId}" is not defined on "${action.label}".`)
  }

  // 2. Permission re-check (defence-in-depth, lenient like performAction).
  // Skipped for creation-time auto-allocation; see bypassGates.
  if (!args.bypassGates) {
    const permitted =
      canPerform(project, workflow, user, teams, org, actionId, roleCtx) ||
      readActors(action).all.some((a) => actorOnlyMatch(a, user, project))
    if (!permitted) {
      throw err('permission_denied', `You are not allowed to perform "${action.label}".`)
    }

    // 3. availableWhen gate.
    if (action.availableWhen && !passesCondition(action.availableWhen, project)) {
      throw err('invalid_input_value', `"${action.label}" is not available right now.`)
    }
  }

  // 4. Input validation (shared with performAction).
  validateActionInputs(action, inputs, args.bypassGates)

  // 5. Compose the patch.
  const now = Timestamp.now()
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
  const fromStageId = project.currentStageId ?? stage.id
  let toStageId = fromStageId
  let movedStage = false
  // History events to append (stage move and/or role assignment) — collected so
  // a single arrayUnion call carries both when an action moves AND assigns.
  const history: Record<string, unknown>[] = []
  // Role assignments after this outcome (mutated by a project-role assign) so the
  // accessKeys recompute below reflects the new assignee immediately.
  let effectiveRoleAssignments = project.roleAssignments

  switch (outcome.shape) {
    case 'advance':
    case 'branch': {
      if (!outcome.toStageId) {
        throw err('unknown_stage', `Outcome "${outcome.label}" has no target stage.`)
      }
      toStageId = outcome.toStageId
      movedStage = true
      patch.currentStageId = toStageId
      break
    }
    case 'close': {
      // Preserve the legacy mark_complete semantics: flip stage + set terminal
      // status. toStageId is the legacy effect.toStage (carried by the adapter).
      if (outcome.toStageId) {
        toStageId = outcome.toStageId
        movedStage = true
        patch.currentStageId = toStageId
      }
      if (outcome.terminalStatusId) patch.status = outcome.terminalStatusId
      break
    }
    case 'hold':
      // Stays on the current stage. set_status-style holds read the chosen status
      // from a status_select input (legacy parity); reserved holds are no-ops.
      if (outcome.legacyEffectKind === 'set_status') {
        const status = inputs.status ?? inputs.outcome
        if (typeof status === 'string') {
          patch.status = status
          if (typeof inputs.note === 'string' && inputs.note.trim()) {
            patch.statusNote = inputs.note.trim()
          }
        }
      }
      break
  }

  // Who to tell they've been given a slot on this project. Collected here,
  // fanned out once the batch exists. Only genuine changes of hands land here.
  const roleNotices: { recipientIds: string[]; roleLabel: string }[] = []

  // 5b. Legacy effect replay (lead set/clear, counters) carried on the outcome.
  switch (outcome.legacyEffectKind) {
    case 'assign_lead': {
      const leadUid = String(inputs.leadUid ?? '')
      if (!leadUid) throw err('missing_required_input', 'A lead must be selected.')
      patch.leadUid = leadUid
      if (leadUid !== project.leadUid) {
        roleNotices.push({ recipientIds: [leadUid], roleLabel: leadRoleLabel(workflow) })
      }
      break
    }
    case 'clear_lead':
      patch.leadUid = null
      break
  }
  // Counter bump: a v2-authored `counter` or a legacy-synthesized `legacyCounter`.
  const counter = outcome.counter ?? outcome.legacyCounter
  if (counter) {
    patch[counter === 'iteration' ? 'iterationCount' : 'escalationCount'] = increment(1)
  }

  // 5c. First-class assign (Phase 3.6): the picked user becomes the project lead
  // or is assigned to a workflow project role (→ ProjectRolesSection).
  if (outcome.assign) {
    const uid = String(inputs[outcome.assign.fromInputId] ?? '')
    if (!uid) throw err('missing_required_input', 'A person must be selected to assign.')
    if (outcome.assign.target === 'lead') {
      patch.leadUid = uid
      if (uid !== project.leadUid) {
        roleNotices.push({ recipientIds: [uid], roleLabel: leadRoleLabel(workflow) })
      }
    } else {
      const roleId = outcome.assign.target.roleId
      const def = (workflow.projectRoles ?? []).find((r) => r.id === roleId)
      const prev = project.roleAssignments?.[roleId]
      const held = Array.isArray(prev) ? prev : prev ? [prev] : []
      if (!held.includes(uid)) {
        roleNotices.push({ recipientIds: [uid], roleLabel: projectRoleLabel(workflow, roleId) })
      }
      const nextVal: string | string[] = def?.multiple
        ? Array.from(new Set([...held, uid]))
        : uid
      patch[`roleAssignments.${roleId}`] = nextVal
      effectiveRoleAssignments = { ...(project.roleAssignments ?? {}), [roleId]: nextVal }
      history.push({
        kind: 'role_assigned',
        roleId,
        value: nextVal,
        assignedAt: now,
        assignedBy: user.uid,
      })
    }
  }

  // 6. Enabled set_field effects (only kind that runs in v2).
  for (const effect of outcome.effects ?? []) {
    if (!effect.enabled || effect.kind !== 'set_field') continue
    applySetField(effect, patch, inputs)
  }

  // 7. Stage-entry timestamp + history event for any move.
  if (movedStage) {
    Object.assign(patch, stageEnteredPatch(toStageId))
    history.push({
      kind: 'stage',
      stageId: toStageId,
      enteredAt: now,
      enteredBy: user.uid,
      actionId,
      payload: inputsPayloadOrNull(inputs),
    })
  }
  if (history.length) patch.projectHistory = arrayUnion(...history)

  // 8. outcomeLog append.
  const logEntry: OutcomeLogEntry = {
    actionId,
    outcomeId,
    shape: outcome.shape,
    by: user.uid,
    at: now,
    inputs: inputsPayloadOrNull(inputs),
  }
  patch.outcomeLog = arrayUnion(logEntry)

  // 9. accessKeys recompute (lead/role changes affect visibility). Full rebuild
  // from the post-action roleAssignments + leadUid, plus the project's attached-
  // team leads + task assignees + hierarchy-role-actor holders. A rebuild (not a
  // union) is required so a role/lead the outcome CLEARED is correctly revoked.
  patch.accessKeys = await recomputeProjectAccessKeys(project.id, {
    roleAssignments: effectiveRoleAssignments,
    createdBy: project.createdBy,
    leadUid: 'leadUid' in patch ? (patch.leadUid as string | null) : project.leadUid,
    workflow,
    users: args.users,
    roles: args.roles,
  })

  // Merge caller extras (trusted).
  if (args.extras) {
    for (const [k, v] of Object.entries(args.extras)) if (v !== undefined) patch[k] = v
  }

  // 10. Write — one atomic batch.
  const ownsBatch = !args.batch
  const batch = args.batch ?? writeBatch(db)
  batch.update(tenantDoc('projects', project.id), patch)
  for (const notice of roleNotices) {
    queueRoleAssignmentNotifications(batch, {
      ...notice,
      projectId: project.id,
      projectTitle: project.title,
      actorId: user.uid,
      actorName: user.displayName,
    })
  }
  bumpStatusTally(batch, project.status, typeof patch.status === 'string' ? patch.status : null)
  recordAuditEvent({
    actorId: user.uid,
    actorName: user.displayName,
    action: 'project.action_performed' as AuditAction,
    targetType: 'project',
    targetId: project.id,
    targetTitle: project.title,
    projectId: project.id,
    payload: { workflowId: workflow.id, actionId, outcomeId, fromStageId, toStageId, inputs },
    batch,
  })
  if (ownsBatch) await batch.commit()
}

function applySetField(
  effect: Effect,
  patch: Record<string, unknown>,
  inputs: Record<string, unknown>,
): void {
  const fieldId = effect.params.fieldId
  if (typeof fieldId !== 'string' || !fieldId) return
  const value =
    'fromInputId' in effect.params && typeof effect.params.fromInputId === 'string'
      ? inputs[effect.params.fromInputId]
      : effect.params.value
  if (value === undefined) return
  // Dot-path so we never clobber the whole `fields` map (mirrors setProjectField).
  patch[`fields.${fieldId}`] = value
}

function inputsPayloadOrNull(
  inputs: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = Object.keys(inputs).filter((k) => inputs[k] !== undefined && inputs[k] !== null)
  if (!keys.length) return null
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = inputs[k]
  return out
}
