/**
 * Pure evaluator over a workflow doc + project state + viewer + org context.
 *
 * Phase 2b: dual-write retired. Every transition writes `projectHistory` with
 * the new `kind: 'stage'` event shape; no more numeric `stage` / vhId /
 * vhIterationCount mirrors. The migration script (migrateProjectHistory.ts)
 * back-fills legacy projects before this code path runs at scale.
 *
 * No React, no Firestore globals — this module is the single source of truth
 * for "what stage is this at, what can be done, who is involved, what
 * happens on commit."
 */

import type { ActorRef, Stage, StageAction, StageEvent, Workflow } from '../types/workflow'
import { WorkflowValidationError } from '../types/workflow'
import type { AuditAction, OrgStructure, Project, ProjectStatus, Team, User } from '../types/models'
import type { EffectivePermissions, RoleDef } from '../types/v2'
import { resolveTeamOfRoleOn, resolveValidatorTeam } from './orgResolver'
import {
  arrayUnion,
  increment,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { tenantDoc } from './firestore'
import { recordAuditEvent } from './firestore'
import { recomputeProjectAccessKeys } from './firestore'
import { bumpStatusTally, stageEnteredPatch } from './rules/analyticsCounters'

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

// Phase 3: optional resolution context for the new `role` actor kind. Legacy
// callers omit it; a workflow with zero `role` actors (every seed) resolves
// identically with or without it. `roles` is the tenant's /config/roles list;
// `effective` is the viewer's cached effective permissions (own + inherited +
// bridged role ids, plus topLevel).
export interface RoleResolutionCtx {
  roles: RoleDef[]
  effective?: EffectivePermissions | null
}

function actorMatches(
  actor: ActorRef,
  user: User,
  project: Project,
  teams: Team[],
  org: OrgStructure,
  mode: ActorMatchMode = 'permission',
  roleCtx?: RoleResolutionCtx,
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
            actorMatches(fb, user, project, teams, org, mode, roleCtx),
          )
        }
        return false
      }
      // No team: `alsoAllow` contributes to both perms AND inbox so someone
      // can unblock the project.
      if (actor.alsoAllow?.length) {
        return actor.alsoAllow.some((fb) =>
          actorMatches(fb, user, project, teams, org, mode, roleCtx),
        )
      }
      return false
    }
    case 'project_role': {
      // Phase 2d: resolves against the project's role assignments. Behaves the
      // same in permission + inbox modes (it maps to concrete uids).
      const assigned = project.roleAssignments?.[actor.roleId]
      if (!assigned) return false
      return Array.isArray(assigned) ? assigned.includes(user.uid) : assigned === user.uid
    }
    case 'creator':
      // Phase 2d owner retirement: prefer createdBy, fall back to legacy ownerId.
      return (project.createdBy ?? project.ownerId) === user.uid
    case 'role': {
      // Phase 3 hierarchy actor. Super-admin always passes.
      if (user.globalRole === 'super_admin') return true
      const eff = roleCtx?.effective
      if (!roleCtx || !eff) return false
      // Exact hold.
      if (eff.effectiveRoleIds.includes(actor.roleId)) return true
      // Level inheritance: a viewer at level j passes an action mapped to a role
      // at level k iff j <= k (lower number = higher authority).
      const referenced = roleCtx.roles.find((r) => r.id === actor.roleId)
      if (!referenced) return false
      return eff.topLevel != null && eff.topLevel <= referenced.level
    }
  }
}

// All actions on this stage that this user is allowed to perform. Empty for
// terminal stages and for users who don't match any action's actor or
// override (alsoAllow) actor.
//
// Permission vs inbox semantics for action-level alsoAllow:
//   - 'permission' mode: canonical actor OR any alsoAllow match grants the
//     action — the banner renders ONE button regardless of how many actors
//     overlap (so a super_admin who is also the creator doesn't see duplicate
//     buttons).
//   - 'inbox' mode: only the canonical actor counts. Override actors granted
//     via alsoAllow can still PERFORM the action (banner shows it on their
//     project detail page), but the project doesn't get routed to their /me
//     inbox — that belongs to the canonical actor.
export function getAllowedActions(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  org: OrgStructure,
  mode: ActorMatchMode = 'permission',
  roleCtx?: RoleResolutionCtx,
): StageAction[] {
  const stage = getCurrentStage(project, workflow)
  if (stage.isTerminal) return []
  return stage.actions.filter((a) =>
    actionAllowedForUser(a, user, project, teams, org, mode, roleCtx),
  )
}

function actionAllowedForUser(
  action: StageAction,
  user: User,
  project: Project,
  teams: Team[],
  org: OrgStructure,
  mode: ActorMatchMode,
  roleCtx?: RoleResolutionCtx,
): boolean {
  // Phase 3: when the action carries an explicit Layer-2 `actors[]` mapping it
  // supersedes the legacy canonical actor / alsoAllow. The first entry is the
  // canonical actor (owns inbox routing); the rest contribute in permission
  // mode only.
  if (action.actors?.length) {
    const [canonical, ...rest] = action.actors
    if (actorMatches(canonical, user, project, teams, org, mode, roleCtx)) return true
    if (mode === 'permission') {
      return rest.some((a) => actorMatches(a, user, project, teams, org, mode, roleCtx))
    }
    return false
  }
  if (actorMatches(action.actor, user, project, teams, org, mode, roleCtx)) return true
  // alsoAllow only contributes in permission mode — inbox routing belongs to
  // the canonical actor.
  if (mode === 'permission' && action.alsoAllow?.length) {
    return action.alsoAllow.some((a) =>
      actorMatches(a, user, project, teams, org, mode, roleCtx),
    )
  }
  return false
}

export function canPerform(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  org: OrgStructure,
  actionId: string,
  roleCtx?: RoleResolutionCtx,
): boolean {
  return getAllowedActions(project, workflow, user, teams, org, 'permission', roleCtx).some(
    (a) => a.id === actionId,
  )
}

// Phase 2d: can this user change project.status via the direct status-pill path?
// Baselines (super-admin/admin, and the creator) always pass. Otherwise prefer
// the workflow's author-configured `canUpdateStatusActors`; when absent, fall
// back to the legacy flow-type rule that usePermissions encoded before 2d.
// Shared by usePermissions so the pill and any banner agree.
export function canUpdateProjectStatus(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  org: OrgStructure,
): boolean {
  if (user.globalRole === 'super_admin' || user.globalRole === 'admin') return true
  if ((project.createdBy ?? project.ownerId) === user.uid) return true
  const actors = workflow.canUpdateStatusActors
  if (actors?.length) {
    return actors.some((a) => actorMatches(a, user, project, teams, org, 'permission'))
  }
  // Legacy fallback — mirrors the pre-2d flow-type rule. (super_admin/admin and
  // creator are already handled above, so only the role-based disjuncts remain.)
  switch (workflow.flowType) {
    case 'collaborative':
      return (
        actorMatches({ kind: 'pipeline_role', role: 'lead' }, user, project, teams, org) ||
        actorMatches(
          { kind: 'team_role', role: 'coordinator', member: 'lead' },
          user,
          project,
          teams,
          org,
        )
      )
    case 'individual':
      return actorMatches({ kind: 'pipeline_role', role: 'lead' }, user, project, teams, org)
    case 'basic':
    default:
      return false
  }
}

// ─── Inbox helper ────────────────────────────────────────────────────────────

// Resolve every actor on this stage's actions into a set of concrete uids.
// Used by `/me` to compute "is this project awaiting *me*?".
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
      case 'project_role': {
        const assigned = project.roleAssignments?.[actor.roleId]
        if (Array.isArray(assigned)) {
          for (const uid of assigned) if (uid) out.add(uid)
        } else if (assigned) {
          out.add(assigned)
        }
        break
      }
      case 'creator': {
        const creator = project.createdBy ?? project.ownerId
        if (creator) out.add(creator)
        break
      }
      case 'role':
        // Phase 3 hierarchy actor: doesn't resolve to concrete uids without a
        // user directory. The /me inbox filter checks the viewer's effective
        // roles separately (same posture as global_role). Skip here.
        break
    }
  }
  for (const action of stage.actions) {
    // Phase 3: prefer the explicit Layer-2 mapping when present.
    if (action.actors?.length) for (const a of action.actors) collect(a)
    else collect(action.actor)
  }
  return [...out].sort()
}

export function getInvolvedGlobalRoles(stage: Stage): Array<'super_admin' | 'admin'> {
  if (stage.isTerminal) return []
  const out = new Set<'super_admin' | 'admin'>()
  for (const action of stage.actions) {
    if (action.actor.kind === 'global_role') out.add(action.actor.role)
  }
  return [...out]
}

// Input validation against an action's declared inputs. Exported so the
// modal-side validation and the engine-side check share one implementation.
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
// the caller's batch.
//
// Phase 2b: writes the new generic `projectHistory: ProjectHistoryEvent[]`
// (kind: 'stage') and drops every legacy mirror (stage, vhId, vhIterationCount,
// stageHistory). The migration script back-fills legacy projects before this
// path runs in production.

export interface PerformActionArgs {
  project: Project
  workflow: Workflow
  user: User
  actionId: string
  inputs: Record<string, unknown>
  // Optional: join the caller's existing batch. The caller is responsible
  // for committing it. When omitted, performAction commits its own batch.
  batch?: WriteBatch
  // Optional: extra fields to merge into the project patch (e.g.
  // denormalised eligibilityNote). Caller-trusted, not validated here.
  extras?: Record<string, unknown>
  // Optional tenant user directory. Used by clear_lead's accessKeys recompute so
  // hierarchy-role-actor holders are preserved across the rebuild.
  users?: User[]
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

  // 2. Permission check (defence-in-depth — modals already gate rendering).
  if (!canPerform(project, workflow, user, [], {} as OrgStructure, actionId)) {
    if (!actorOnlyMatch(action.actor, user, project)) {
      throw makeError(
        'permission_denied',
        `You are not allowed to perform "${action.label}".`,
      )
    }
  }

  // 3. Input validation.
  validateActionInputs(action, inputs)

  // 4. Compose the project patch + the projectHistory events to append.
  const now = Timestamp.now()
  const projectRef = tenantDoc('projects', project.id)
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
  const events: StageEvent[] = []

  function buildEvent(
    stageId: string,
    payload: Record<string, unknown> | null,
  ): StageEvent {
    return {
      kind: 'stage',
      stageId,
      enteredAt: now,
      enteredBy: user.uid,
      actionId,
      payload,
    }
  }

  function effectTargetStage(): string {
    switch (action!.effect.kind) {
      case 'transition':
      case 'transition_with_counter':
      case 'assign_lead':
      case 'clear_lead':
      case 'mark_complete':
        return action!.effect.toStage
      case 'set_status':
      case 'assign_project_role':
        return project.currentStageId ?? stage.id
    }
  }

  const toStage = effectTargetStage()
  const stayingAtStage =
    action.effect.kind === 'set_status' || action.effect.kind === 'assign_project_role'

  // Standard transition (unless we're only changing status).
  if (!stayingAtStage) {
    patch.currentStageId = toStage
    events.push(buildEvent(toStage, inputsPayloadOrNull(inputs)))
    // Phase 3 analytics: stamp the stage-entry time for time-in-stage reporting.
    Object.assign(patch, stageEnteredPatch(toStage))
  }

  // Effect-specific extras.
  switch (action.effect.kind) {
    case 'transition':
      break
    case 'transition_with_counter': {
      const counter = action.effect.counter
      patch[counter === 'iteration' ? 'iterationCount' : 'escalationCount'] = increment(1)
      break
    }
    case 'assign_lead': {
      const leadUid = String(inputs.leadUid ?? '')
      if (!leadUid) {
        throw makeError('missing_required_input', 'A lead must be selected.')
      }
      patch.leadUid = leadUid
      // The newly-assigned lead (vertical head) gains access. Additive union —
      // preserves every existing key and is safe inside a caller's shared batch.
      patch.accessKeys = arrayUnion(leadUid)
      break
    }
    case 'clear_lead': {
      patch.leadUid = null
      const counter = action.effect.counter
      if (counter) {
        patch[counter === 'iteration' ? 'iterationCount' : 'escalationCount'] = increment(1)
      }
      // Clearing the lead must REVOKE the old lead's access unless still
      // justified (role / task / team-lead / creator). arrayRemove can't decide
      // that, so rebuild from scratch with leadUid forced to null.
      patch.accessKeys = await recomputeProjectAccessKeys(project.id, {
        leadUid: null,
        workflow,
        users: args.users,
      })
      break
    }
    case 'mark_complete': {
      // Auto-apply the outcome when the action declares exactly one valid
      // outcome and didn't ask the user for it (basic.mark_complete,
      // sales.mark_won, sales.mark_unqualified, etc.). Workflow authors only
      // need an `outcome`/`status` input when there's a real choice to make.
      const supplied = inputs.outcome ?? inputs.status
      const outcome =
        typeof supplied === 'string'
          ? supplied
          : action.effect.outcomes.length === 1
            ? action.effect.outcomes[0]
            : undefined
      if (
        typeof outcome !== 'string' ||
        !action.effect.outcomes.includes(outcome as ProjectStatus)
      ) {
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
      if (typeof inputs.note === 'string' && inputs.note.trim()) {
        patch.statusNote = inputs.note.trim()
      }
      // Status-only updates still record a history event so the timeline
      // shows the change, but stay anchored at the current stage.
      events.push(
        buildEvent(project.currentStageId ?? stage.id, {
          from: project.status,
          to: status,
          note: typeof inputs.note === 'string' ? inputs.note : '',
        }),
      )
      break
    }
    case 'assign_project_role':
      // RESERVED — no stage-action wiring in 2d. Role assignment happens via the
      // sidebar (setProjectRole). Declared so the switch stays total; stays on
      // the current stage and writes nothing extra here.
      break
  }

  if (events.length) {
    patch.projectHistory = arrayUnion(...events)
  }

  // Merge caller-supplied extras (e.g. denormalised eligibilityNote). Trusted.
  if (args.extras) {
    for (const [k, v] of Object.entries(args.extras)) {
      if (v !== undefined) patch[k] = v
    }
  }

  // 5. Write.
  const ownsBatch = !args.batch
  const batch = args.batch ?? writeBatch(db)
  batch.update(projectRef, patch)
  // Phase 3 analytics: keep the tenant status tally in lockstep with the write.
  bumpStatusTally(batch, project.status, typeof patch.status === 'string' ? patch.status : null)
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
// doc. Generic shape — renderers resolve meaning from actionId + workflow doc.
function inputsPayloadOrNull(
  inputs: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = Object.keys(inputs).filter((k) => inputs[k] !== undefined && inputs[k] !== null)
  if (!keys.length) return null
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = inputs[k]
  return out
}

// Lightweight actor match without org/teams context — defensive fallback in
// performAction (and executeOutcome) when the full canPerform check can't
// resolve team roles. Modal-side gates already cover the full picture; this
// catches obvious gaps.
export function actorOnlyMatch(actor: ActorRef, user: User, project: Project): boolean {
  switch (actor.kind) {
    case 'global_role':
      return user.globalRole === actor.role
    case 'pipeline_role':
      return Boolean(project.leadUid && project.leadUid === user.uid)
    case 'team_role':
      // Cannot verify without teams — trust the modal-side gate.
      return true
    case 'project_role': {
      const assigned = project.roleAssignments?.[actor.roleId]
      if (!assigned) return false
      return Array.isArray(assigned) ? assigned.includes(user.uid) : assigned === user.uid
    }
    case 'creator':
      return (project.createdBy ?? project.ownerId) === user.uid
    case 'role':
      // Cannot verify the hierarchy without a RoleResolutionCtx here — trust the
      // modal-side / executeOutcome gate (same posture as team_role above).
      return true
  }
}
