/**
 * Phase 3 outcome adapter — pure, no I/O.
 *
 * Presents any StageAction to the runtime + canvas as a normalised list of
 * named Outcomes, whether it was authored in the new model (`action.outcomes`)
 * or carries a single legacy `effect`. This is what lets the three seeded
 * workflows (and every pre-3 doc) run unchanged under the new rules engine:
 * their single `effect` is synthesized into an equivalent Outcome[] on read.
 *
 * Mapping (legacy ActionEffect.kind → OutcomeShape), losslessly — counter / lead
 * semantics are carried on legacyEffectKind / legacyCounter and replayed by
 * executeOutcome:
 *
 *   transition              → advance  (toStageId)
 *   transition_with_counter → advance  (toStageId, legacyCounter)
 *   assign_lead             → advance  (toStageId, legacyEffectKind)
 *   clear_lead              → advance  (toStageId, legacyEffectKind, legacyCounter)
 *   set_status              → hold     (status chosen from a status_select input)
 *   mark_complete           → close    (one Outcome per status; terminalStatusId)
 *   assign_project_role     → hold     (reserved no-op)
 */

import type { ActorRef, StageAction } from '../../types/workflow'
import type { Outcome } from '../../types/v2'

// Deterministic synthetic-outcome ids so the canvas, OutcomePicker, and
// executeOutcome all agree on the same id for a given legacy action.
function legacyOutcomeId(actionId: string, suffix: string): string {
  return `${actionId}:${suffix}`
}

/**
 * The action's outcomes. Prefers authored `action.outcomes`; otherwise
 * synthesizes them from the legacy `effect`. Never returns an empty array for a
 * well-formed action.
 */
export function readOutcomes(action: StageAction): Outcome[] {
  if (action.outcomes && action.outcomes.length) return action.outcomes

  const effect = action.effect
  switch (effect.kind) {
    case 'transition':
      return [
        {
          id: legacyOutcomeId(action.id, 'advance'),
          label: action.label,
          shape: 'advance',
          toStageId: effect.toStage,
          legacyEffectKind: 'transition',
        },
      ]
    case 'transition_with_counter':
      return [
        {
          id: legacyOutcomeId(action.id, 'advance'),
          label: action.label,
          shape: 'advance',
          toStageId: effect.toStage,
          legacyEffectKind: 'transition_with_counter',
          legacyCounter: effect.counter,
        },
      ]
    case 'assign_lead':
      return [
        {
          id: legacyOutcomeId(action.id, 'advance'),
          label: action.label,
          shape: 'advance',
          toStageId: effect.toStage,
          legacyEffectKind: 'assign_lead',
        },
      ]
    case 'clear_lead':
      return [
        {
          id: legacyOutcomeId(action.id, 'advance'),
          label: action.label,
          shape: 'advance',
          toStageId: effect.toStage,
          legacyEffectKind: 'clear_lead',
          ...(effect.counter ? { legacyCounter: effect.counter } : {}),
        },
      ]
    case 'set_status':
      // The concrete status is chosen at runtime from a status_select input, so
      // this is a single hold outcome (no stage move, no picker).
      return [
        {
          id: legacyOutcomeId(action.id, 'status'),
          label: action.label,
          shape: 'hold',
          legacyEffectKind: 'set_status',
        },
      ]
    case 'mark_complete':
      // One close outcome per terminal status. Single → auto-applies; several →
      // the runtime presents an OutcomePicker. The legacy toStage flip is
      // preserved on every synthesized outcome.
      return effect.outcomes.map((status) => ({
        id: legacyOutcomeId(action.id, status),
        label: status,
        shape: 'close' as const,
        toStageId: effect.toStage,
        terminalStatusId: status,
        legacyEffectKind: 'mark_complete',
      }))
    case 'assign_project_role':
      return [
        {
          id: legacyOutcomeId(action.id, 'hold'),
          label: action.label,
          shape: 'hold',
          legacyEffectKind: 'assign_project_role',
        },
      ]
  }
}

/**
 * The action's Layer-2 actor list. Prefers the new `actors[]`; otherwise the
 * legacy canonical actor + alsoAllow. `primary` is the canonical actor (owns
 * /me inbox routing).
 */
export function readActors(action: StageAction): { primary: ActorRef; all: ActorRef[] } {
  if (action.actors && action.actors.length) {
    return { primary: action.actors[0], all: action.actors }
  }
  return { primary: action.actor, all: [action.actor, ...(action.alsoAllow ?? [])] }
}

/**
 * True when performing this action presents a choice (more than one outcome).
 * A set_status / single-transition action returns false (handled by the legacy
 * direct path); a multi-status mark_complete or an authored multi-outcome action
 * returns true (opens the OutcomePicker).
 */
export function hasOutcomeChoice(action: StageAction): boolean {
  return readOutcomes(action).length > 1
}

/** Find a specific outcome on an action by id (across authored + synthesized). */
export function findOutcome(action: StageAction, outcomeId: string): Outcome | undefined {
  return readOutcomes(action).find((o) => o.id === outcomeId)
}
