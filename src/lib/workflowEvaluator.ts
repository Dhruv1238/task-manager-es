/**
 * Pure evaluator over a workflow doc + project state + viewer + org context.
 *
 * Phase 2a, Sprint 1: read-only API only — `performAction` lands in Sprint 2
 * once the write paths in firestore.ts are refactored. The functions here are
 * the single source of truth for "what stage is this at, what can be done, who
 * is involved." No React, no Firestore, no globals.
 */

import type { ActorRef, Stage, StageAction, Workflow } from '../types/workflow'
import { WorkflowValidationError } from '../types/workflow'
import type { AuditAction, OrgStructure, Project, ProjectStatus, StageEvent, Team, User } from '../types/models'
import { resolveTeamOfRoleOn, resolveValidatorTeam } from './orgResolver'
import {
  arrayUnion,
  doc,
  increment,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { recordAuditEvent } from './firestore'
import {
  COLLAB_DEFAULT_WORKFLOW_ID,
  ID_TO_LEGACY_STAGE,
} from './seedCollabWorkflow'

// Re-export so callers can import the error class directly from this module.
export { WorkflowValidationError }

// ─── Stage lookup ────────────────────────────────────────────────────────────

// Find the stage object for a project's current position. Falls back to the
// first stage when `currentStageId` is empty (fresh project pre-Sprint-2 write).
export function getCurrentStage(project: Project, workflow: Workflow): Stage {
  const id = project.currentStageId
  if (id) {
    const match = workflow.stages.find((s) => s.id === id)
    if (match) return match
  }
  // Defensive fallback: ordered, earliest-order wins.
  const ordered = [...workflow.stages].sort((a, b) => a.order - b.order)
  return ordered[0]
}

export function getStageById(workflow: Workflow, stageId: string): Stage | null {
  return workflow.stages.find((s) => s.id === stageId) ?? null
}

// ─── Headline rendering ──────────────────────────────────────────────────────

// Render the banner's headline + hint, interpolating tenant labels. Falls back
// to displayName when the stage has no headline template. Placeholders:
//   {leadRoleName}        — workflow.leadRoleName (or org.leadRoleName fallback)
//   {validatorTeamName}   — resolved validator team's name, if any
export function renderStageHeadline(
  stage: Stage,
  project: Project,
  workflow: Workflow,
  org: OrgStructure,
  teams: Team[],
): { headline: string; hint?: string } {
  const projectTeams = teams.filter((t) => t.projectIds?.includes(project.id))
  const validatorTeamName = resolveValidatorTeam(projectTeams, org)?.name ?? ''
  const leadRoleName = workflow.leadRoleName || org.leadRoleName || 'Project Lead'

  function interp(template: string | undefined): string | undefined {
    if (!template) return undefined
    return template
      .replace(/\{leadRoleName\}/g, leadRoleName)
      .replace(/\{validatorTeamName\}/g, validatorTeamName)
  }

  return {
    headline: interp(stage.headline) ?? stage.displayName,
    hint: interp(stage.hint),
  }
}

// ─── Actor resolution ────────────────────────────────────────────────────────

// Two views of "does this actor match this user":
//   - 'permission' — does the user have authority to perform the action? This
//     is the gate for canPerform / getAllowedActions used by the banner.
//   - 'inbox' — should we surface this project to the user in /me? This is
//     stricter for team_role with `alsoAllow`: those fallback actors only
//     count when the primary team is missing (otherwise the action belongs
//     to the team lead and we shouldn't nag everyone else).
export type ActorMatchMode = 'permission' | 'inbox'

function actorMatches(
  actor: ActorRef,
  user: User,
  project: Project,
  teams: Team[],
  org: OrgStructure,
  mode: ActorMatchMode = 'permission',
): boolean {
  switch (actor.kind) {
    case 'global_role':
      return user.globalRole === actor.role
    case 'pipeline_role':
      // Only 'lead' supported in 2a.
      return Boolean(user.uid && project.leadUid && user.uid === project.leadUid)
    case 'team_role': {
      const team = resolveTeamOfRoleOn(actor.role, project, teams, org)
      if (team) {
        const teamMatched =
          actor.member === 'lead'
            ? team.leadId === user.uid
            : team.memberIds.includes(user.uid)
        if (teamMatched) return true
        // Team exists: `alsoAllow` contributes to perms (override path) but
        // NOT to inbox routing (the action belongs to the team lead).
        if (mode === 'permission' && actor.alsoAllow?.length) {
          return actor.alsoAllow.some((fb) =>
            actorMatches(fb, user, project, teams, org, mode),
          )
        }
        return false
      }
      // No team: `alsoAllow` contributes to both perms AND inbox so someone
      // can unblock the project.
      if (actor.alsoAllow?.length) {
        return actor.alsoAllow.some((fb) =>
          actorMatches(fb, user, project, teams, org, mode),
        )
      }
      return false
    }
    case 'creator':
      return project.ownerId === user.uid
  }
}

// All actions on this stage that this user is allowed to perform. Empty for
// terminal stages and for users who don't match any action's actor.
export function getAllowedActions(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  org: OrgStructure,
  mode: ActorMatchMode = 'permission',
): StageAction[] {
  const stage = getCurrentStage(project, workflow)
  if (stage.isTerminal) return []
  return stage.actions.filter((a) => actorMatches(a.actor, user, project, teams, org, mode))
}

export function canPerform(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  org: OrgStructure,
  actionId: string,
): boolean {
  return getAllowedActions(project, workflow, user, teams, org).some((a) => a.id === actionId)
}

// ─── Inbox helper ────────────────────────────────────────────────────────────

// Resolve every actor on this stage's actions into a set of concrete uids.
// Used by `/me` to compute "is this project awaiting *me*?" — if profile.uid is
// in the set, the project shows up in the inbox with the first allowed action
// as the CTA. Returns a deduped string[] sorted for stable diffing.
export function getInvolvedUids(
  stage: Stage,
  project: Project,
  org: OrgStructure,
  teams: Team[],
): string[] {
  if (stage.isTerminal) return []
  const out = new Set<string>()
  function collect(actor: ActorRef) {
    switch (actor.kind) {
      case 'global_role':
        // Global-role actors don't resolve to specific uids — the inbox filter
        // checks the viewer's role separately. Skip here.
        break
      case 'pipeline_role':
        if (project.leadUid) out.add(project.leadUid)
        break
      case 'team_role': {
        const team = resolveTeamOfRoleOn(actor.role, project, teams, org)
        if (!team) {
          // No team — surface to the `alsoAllow` actors so someone can
          // unblock the project. (When the team IS present, alsoAllow
          // intentionally doesn't contribute to the inbox — the action
          // belongs to the team lead, not the override path.)
          if (actor.alsoAllow?.length) {
            for (const fb of actor.alsoAllow) collect(fb)
          }
          break
        }
        if (actor.member === 'lead') {
          if (team.leadId) out.add(team.leadId)
        } else {
          for (const uid of team.memberIds) out.add(uid)
        }
        break
      }
      case 'creator':
        if (project.ownerId) out.add(project.ownerId)
        break
    }
  }
  for (const action of stage.actions) collect(action.actor)
  return [...out].sort()
}

// Does this stage have any global-role actor? Inbox uses this to know it should
// also surface the project to viewers matching the role even though they don't
// appear in `getInvolvedUids` (which is uid-based).
export function getInvolvedGlobalRoles(stage: Stage): Array<'super_admin' | 'admin'> {
  if (stage.isTerminal) return []
  const out = new Set<'super_admin' | 'admin'>()
  for (const action of stage.actions) {
    if (action.actor.kind === 'global_role') out.add(action.actor.role)
  }
  return [...out]
}

// Internal — exported only for the Sprint 2 `performAction` to reuse the same
// validation helper. Kept here so the read-only API stays self-contained.
export function validateActionInputs(
  action: StageAction,
  inputs: Record<string, unknown>,
): void {
  for (const input of action.inputs) {
    const raw = inputs[input.id]
    const present = raw !== undefined && raw !== null && raw !== ''
    if (input.required && !present) {
      throw makeError('missing_required_input', `${input.label} is required`)
    }
    if (!present) continue
    if ((input.type === 'select' || input.type === 'status_select') && input.options) {
      if (!input.options.includes(String(raw))) {
        throw makeError('invalid_option', `${input.label}: "${String(raw)}" is not a valid option`)
      }
    }
    if (input.type === 'user_picker' && typeof raw !== 'string') {
      throw makeError('invalid_user_picker', `${input.label} must be a user id`)
    }
  }
}

function makeError(
  code: WorkflowValidationError['code'],
  message: string,
): WorkflowValidationError {
  return new WorkflowValidationError(code, message)
}

// ─── performAction — the authoritative write path ────────────────────────────
// Validates inputs, composes the patch based on effect.kind, writes both the
// project update and an audit event in a single writeBatch. Optionally joins
// the caller's batch (used by addTeamTask's auto-advance, which already owns
// a batch).
//
// During Sprint 2-3 the function dual-writes legacy fields so the old banner
// can still read project.stage / vhId / vhIterationCount until the new banner
// ships in Sprint 4. Dual-write is gated by workflow.id === 'collab-default'
// and looks up legacy numerics via ID_TO_LEGACY_STAGE / COUNTER_LEGACY_EVENT_STAGE.

export interface PerformActionArgs {
  project: Project
  workflow: Workflow
  user: User
  actionId: string
  inputs: Record<string, unknown>
  // Optional: join the caller's existing batch. The caller is responsible
  // for committing it. When omitted, performAction commits its own batch.
  batch?: WriteBatch
  // Optional: extra fields to merge into the project patch. Transitional
  // Sprint 2-3 use only — lets modals denormalise inputs onto top-level
  // project fields (e.g. eligibilityNote) so the old banner still renders.
  // Sprint 4's generic banner reads from inputs/history and removes the need.
  extras?: Record<string, unknown>
}

export async function performAction(args: PerformActionArgs): Promise<void> {
  const { project, workflow, user, actionId, inputs } = args

  // 1. Look up the action on the current stage.
  const stage = getCurrentStage(project, workflow)
  if (stage.isTerminal) {
    throw makeError('terminal_stage', `Stage "${stage.displayName}" is terminal — no actions allowed.`)
  }
  const action = stage.actions.find((a) => a.id === actionId)
  if (!action) {
    throw makeError(
      'unknown_action',
      `Action "${actionId}" not available at stage "${stage.displayName}".`,
    )
  }

  // 2. Permission check. Throws when the viewer can't perform.
  if (!canPerform(project, workflow, user, [], {} as OrgStructure, actionId)) {
    // Permission may require teams/org — re-check with the args caller passed
    // through. For simplicity here we accept that callers (modals, hooks) have
    // already gated rendering, and this is a defence-in-depth check that runs
    // with the lighter actor-only model. Team-role actors won't pass without
    // teams/org being threaded in; the modal-side check covers that.
    if (!actorOnlyMatch(action.actor, user, project)) {
      throw makeError(
        'permission_denied',
        `You are not allowed to perform "${action.label}".`,
      )
    }
  }

  // 3. Input validation. Throws WorkflowValidationError on failure.
  validateActionInputs(action, inputs)

  // 4. Compose the project patch + the stage-history events to append.
  const now = Timestamp.now()
  const projectRef = doc(db, 'projects', project.id)
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
  const events: StageEvent[] = []
  const isCollab = workflow.id === COLLAB_DEFAULT_WORKFLOW_ID

  // Helper: build a single stage event, dual-writing legacy `stage` for collab.
  function buildEvent(stageId: string, payload: Record<string, unknown> | null): StageEvent {
    const e: StageEvent = {
      stageId,
      enteredAt: now,
      enteredBy: user.uid,
      payload: (payload ?? null) as StageEvent['payload'],
      // Dual-write the legacy numeric stage so the old side panel renders.
      // Required field on the old StageEvent type — provide a numeric mirror
      // when we know it. For workflows without a legacy mapping (basic), we
      // skip this field by casting; the old side panel isn't rendered for
      // basic projects anyway.
      stage: (isCollab ? (ID_TO_LEGACY_STAGE[stageId] ?? 0) : 0) as StageEvent['stage'],
    }
    return e
  }

  // Helper: compute the new currentStageId from the effect.
  function effectTargetStage(): string {
    switch (action!.effect.kind) {
      case 'transition':
      case 'transition_with_counter':
      case 'assign_lead':
      case 'clear_lead':
      case 'mark_complete':
        return action!.effect.toStage
      case 'set_status':
        return project.currentStageId ?? stage.id
    }
  }

  const toStage = effectTargetStage()
  const stayingAtStage = action.effect.kind === 'set_status'

  // Standard transition fields (unless we're only changing status).
  if (!stayingAtStage) {
    patch.currentStageId = toStage
    if (isCollab) {
      const legacy = ID_TO_LEGACY_STAGE[toStage]
      if (typeof legacy === 'number') {
        patch.stage = legacy
      }
    }
    // Push the primary live-stage event.
    events.push(buildEvent(toStage, inputsPayloadOrNull(inputs)))
  }

  // Effect-specific extras.
  switch (action.effect.kind) {
    case 'transition':
      break
    case 'transition_with_counter': {
      const counter = action.effect.counter
      // New generic field.
      patch[counter === 'iteration' ? 'iterationCount' : 'escalationCount'] = increment(1)
      // Legacy back-compat: vhIterationCount mirrors iterationCount until
      // Sprint 5 cleanup. escalationCount has always been the legacy name too.
      if (isCollab && counter === 'iteration') {
        patch.vhIterationCount = increment(1)
      }
      // No separate marker event: the live-stage event pushed at the top of
      // performAction carries the payload, and the side panel detects the
      // loop-back nature from the payload shape (reason/iteration keys).
      break
    }
    case 'assign_lead': {
      const leadUid = String(inputs.leadUid ?? '')
      if (!leadUid) {
        throw makeError('missing_required_input', 'A lead must be selected.')
      }
      patch.leadUid = leadUid
      if (isCollab) patch.vhId = leadUid
      break
    }
    case 'clear_lead': {
      patch.leadUid = null
      if (isCollab) patch.vhId = null
      const counter = action.effect.counter
      if (counter) {
        patch[counter === 'iteration' ? 'iterationCount' : 'escalationCount'] = increment(1)
        if (isCollab && counter === 'iteration') {
          patch.vhIterationCount = increment(1)
        }
        // No separate marker event — see transition_with_counter for the
        // same reasoning. The single live-stage event with the payload
        // carries enough context for the side panel to render correctly.
      }
      break
    }
    case 'mark_complete': {
      const outcome = inputs.outcome ?? inputs.status
      if (typeof outcome !== 'string' || !action.effect.outcomes.includes(outcome as ProjectStatus)) {
        throw makeError(
          'invalid_option',
          `Outcome must be one of: ${action.effect.outcomes.join(', ')}`,
        )
      }
      patch.status = outcome
      break
    }
    case 'set_status': {
      const status = inputs.status ?? inputs.outcome
      if (typeof status !== 'string' || !action.effect.statuses.includes(status as ProjectStatus)) {
        throw makeError(
          'invalid_option',
          `Status must be one of: ${action.effect.statuses.join(', ')}`,
        )
      }
      patch.status = status
      // Dual-write the denormalised statusNote for collab so the existing
      // pill subtitle keeps rendering. The new banner reads it the same way.
      if (typeof inputs.note === 'string' && inputs.note.trim()) {
        patch.statusNote = inputs.note.trim()
      }
      // For set_status we still want a history event so the timeline shows
      // the change. Build one staying at the current stage.
      events.push(
        buildEvent(project.currentStageId ?? stage.id, {
          kind: 'status_update',
          from: project.status,
          to: status,
          note: typeof inputs.note === 'string' ? inputs.note : '',
        }),
      )
      break
    }
  }

  if (events.length) {
    patch.stageHistory = arrayUnion(...events)
  }

  // Merge transitional extras (e.g. eligibilityNote denormalisation) — these
  // are caller-supplied and trusted; performAction does not validate them.
  if (args.extras) {
    for (const [k, v] of Object.entries(args.extras)) {
      if (v !== undefined) patch[k] = v
    }
  }

  // 5. Write. Join the caller's batch when provided; otherwise create one.
  const ownsBatch = !args.batch
  const batch = args.batch ?? writeBatch(db)
  batch.update(projectRef, patch)
  recordAuditEvent({
    actorId: user.uid,
    actorName: user.displayName,
    action: 'project.action_performed' as AuditAction,
    targetType: 'project',
    targetId: project.id,
    targetTitle: project.title,
    projectId: project.id,
    payload: {
      workflowId: workflow.id,
      actionId,
      fromStageId: project.currentStageId ?? stage.id,
      toStageId: stayingAtStage ? (project.currentStageId ?? stage.id) : toStage,
      inputs,
    },
    batch,
  })
  if (ownsBatch) await batch.commit()
}

// Build the payload object stored on a history event from the action inputs.
// Returns null when the inputs object is empty so payload doesn't bloat the
// doc. Generic shape — future readers should derive meaning from actionId.
function inputsPayloadOrNull(
  inputs: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = Object.keys(inputs).filter((k) => inputs[k] !== undefined && inputs[k] !== null)
  if (!keys.length) return null
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = inputs[k]
  return out
}

// Lightweight actor match without org/teams context — used as a fallback in
// performAction when the full canPerform check can't resolve team roles. Hooks
// and modals call the full canPerform with teams/org before opening the modal,
// so this defensive check just needs to catch obvious gaps (e.g. wrong global
// role, wrong creator).
function actorOnlyMatch(actor: ActorRef, user: User, project: Project): boolean {
  switch (actor.kind) {
    case 'global_role':
      return user.globalRole === actor.role
    case 'pipeline_role':
      return Boolean(project.leadUid && project.leadUid === user.uid)
    case 'team_role':
      // Cannot verify without teams — trust the modal-side gate.
      return true
    case 'creator':
      return project.ownerId === user.uid
  }
}
