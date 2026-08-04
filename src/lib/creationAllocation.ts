/**
 * Creation-time allocation planning — pure, no I/O.
 *
 * A lead-bearing workflow opens with a gate stage whose only job is to assign
 * somebody: collab's `created` → `allocate`, sales' `new_lead` → `assign_to_rep`,
 * or any canvas-authored task carrying an "assigns a person" action. When the
 * new-project form already collected that person, the gate is satisfied before
 * the project exists — so re-presenting it on the project screen is busywork.
 *
 * This module answers two questions, and is the SINGLE place either is answered:
 *
 *   findAssignGates(stage)          — which actions here assign a person?
 *   planCreationAllocation(wf, ...) — given what the form collected, which
 *                                     actions should addProject chain?
 *
 * Both the new-project form (to decide whether to show a lead picker) and
 * addProject (to run the hops) call in here, so the two can never disagree
 * about which action is the gate — they used to each guess, differently.
 *
 * Everything is expressed over `readOutcomes()`, so a legacy `assign_lead`
 * effect and a v2 authored `outcome.assign` are detected by the same code.
 */

import type { ActionInput, Stage, StageAction, Workflow } from '../types/workflow'
import type { Outcome } from '../types/v2'
import { readOutcomes } from './rules/outcomeAdapter'
import { resolveEntryStage } from './workflowEvaluator'

// A stage action that assigns a person AND moves the project on — i.e. a gate
// that creation can complete.
export interface AssignGate {
  stage: Stage
  action: StageAction
  outcome: Outcome
  // The user_picker whose value becomes the assignee.
  input: ActionInput
  // Where the assignee lands: the pipeline lead (project.leadUid) or a named
  // workflow project role (project.roleAssignments[roleId]).
  target: 'lead' | { roleId: string }
}

// One chained action for addProject to run, in order.
export interface AllocationHop {
  actionId: string
  outcomeId: string
  inputs: Record<string, unknown>
  // The only input whose `required` flag is enforced. Every other input the
  // action declares is deliberately never collected — the stage is being
  // skipped, so a mandatory note on it is skipped with it.
  requireOnly: string[]
  // Carried for the caller's shim bookkeeping between hops.
  target: 'lead' | { roleId: string }
  assigneeUid: string
  toStageId: string
}

// Chained gates beyond this are almost certainly a mis-authored cycle rather
// than intent. Creation stays a single commit, so this also bounds its size.
const MAX_HOPS = 5

/**
 * Every assignment gate on `stage`, in the stage's own action order.
 *
 * A gate qualifies only when all of the following hold — anything looser would
 * either skip nothing or make a choice that is the actor's to make:
 *  - the action has exactly ONE outcome. A multi-outcome action presents a
 *    branch ("Approved" / "Sent back") and creation has no basis for picking
 *    one; that stays with the stage banner's OutcomePicker. Note the canvas
 *    stamps `assign` onto every outcome of an action, so this is the check that
 *    keeps a branching assign action out.
 *  - the outcome MOVES the project (`advance`/`branch` with a toStageId). A
 *    `hold` assign leaves the project where it is, so completing it at creation
 *    would skip no stage at all.
 *  - the named input exists and is a `user_picker`. Mirrors the publish-time
 *    invariants `assign_lead_missing_user_picker` (workflowValidation) and
 *    `assign_no_user_picker` (flowValidation).
 */
export function findAssignGates(stage: Stage): AssignGate[] {
  const gates: AssignGate[] = []
  for (const action of stage.actions) {
    const outcomes = readOutcomes(action)
    if (outcomes.length !== 1) continue
    const outcome = outcomes[0]
    // Assigns a person: v2 authored `assign`, or a legacy assign_lead effect
    // (which the adapter surfaces as legacyEffectKind).
    if (!outcome.assign && outcome.legacyEffectKind !== 'assign_lead') continue
    if (outcome.shape !== 'advance' && outcome.shape !== 'branch') continue
    if (!outcome.toStageId) continue

    // v2 authored assigns name their own input; legacy assign_lead always uses
    // the `leadUid` input that both authoring surfaces inject for it.
    const target = outcome.assign?.target ?? 'lead'
    const inputId = outcome.assign?.fromInputId ?? 'leadUid'
    const input = action.inputs.find((i) => i.id === inputId)
    if (!input || input.type !== 'user_picker') continue

    gates.push({ stage, action, outcome, input, target })
  }
  return gates
}

// The uid the form supplied for a gate's target, or null when it didn't.
function suppliedUidFor(
  target: 'lead' | { roleId: string },
  supplied: { leadUid?: string | null; roleAssignments?: Record<string, string | string[]> },
): string | null {
  if (target === 'lead') return supplied.leadUid || null
  const value = supplied.roleAssignments?.[target.roleId]
  // A `multiple` role holds an array; the gate assigns one person, so take the
  // first. executeOutcome unions it into the existing list either way.
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

/**
 * The ordered hops to chain onto project creation.
 *
 * Walks forward from the workflow's entry stage: take the first gate on the
 * current stage whose assignee the form supplied, emit a hop, move the cursor
 * to that outcome's target stage, repeat. So back-to-back gates (assign the
 * lead, then assign an Admin Head) collapse into the same commit, while a
 * workflow whose second stage needs a real decision stops there.
 *
 * Returns [] when nothing was supplied or the entry stage has no gate — the
 * project then lands on the gate stage and is allocated there, as before.
 */
export function planCreationAllocation(
  workflow: Workflow,
  supplied: { leadUid?: string | null; roleAssignments?: Record<string, string | string[]> },
): AllocationHop[] {
  const hops: AllocationHop[] = []
  const seenStages = new Set<string>()
  let stage = resolveEntryStage(workflow)

  while (stage && hops.length < MAX_HOPS && !seenStages.has(stage.id)) {
    seenStages.add(stage.id)
    if (stage.isTerminal) break

    const gate = findAssignGates(stage).find((g) => suppliedUidFor(g.target, supplied))
    if (!gate) break
    // Non-null: `find` above only matches gates with a supplied uid.
    const assigneeUid = suppliedUidFor(gate.target, supplied)!

    hops.push({
      actionId: gate.action.id,
      outcomeId: gate.outcome.id,
      inputs: { [gate.input.id]: assigneeUid },
      requireOnly: [gate.input.id],
      target: gate.target,
      assigneeUid,
      toStageId: gate.outcome.toStageId!,
    })

    stage = workflow.stages.find((s) => s.id === gate.outcome.toStageId) ?? null
  }

  return hops
}

/**
 * The entry-stage gate that assigns the pipeline lead, if any. This is what the
 * new-project form keys its lead picker off — replacing the old
 * "first stage's actions[0], if its effect is assign_lead" guess, which missed
 * canvas-authored assigns, gates that aren't first in the stage, and workflows
 * whose entryStageId isn't the lowest-order stage.
 */
export function findEntryLeadGate(workflow: Workflow): AssignGate | null {
  const stage = resolveEntryStage(workflow)
  if (!stage) return null
  return findAssignGates(stage).find((g) => g.target === 'lead') ?? null
}
