import { useState } from 'react'
import type { Stage, StageAction } from '../../../types/workflow'
import ActionExpandedEditor from './ActionExpandedEditor'

interface Props {
  action: StageAction
  stage: Stage
  allStages: Stage[]
  leadRoleName: string
  onChange: (next: StageAction) => void
  onDelete: () => void
  disabled?: boolean
}

// Phase 2c: sentence-template action card. Default state is a read-only sentence
// summarizing the action ("When the X clicks 'Y', the project moves to 'Z'.").
// Click Edit to expand into the form.
export default function ActionCard({
  action,
  stage,
  allStages,
  leadRoleName,
  onChange,
  onDelete,
  disabled,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-line bg-fill-1 p-3">
      {!expanded ? (
        <>
          <p className="text-sm text-fg">{renderSentence(action, allStages, leadRoleName)}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              disabled={disabled}
              className="rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:opacity-60"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-tone-danger-fg transition hover:bg-tone-danger-bg disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <ActionExpandedEditor
          action={action}
          stage={stage}
          allStages={allStages}
          leadRoleName={leadRoleName}
          onChange={onChange}
          onDone={() => setExpanded(false)}
          disabled={disabled}
        />
      )}
    </div>
  )
}

function renderSentence(
  action: StageAction,
  allStages: Stage[],
  leadRoleName: string,
): string {
  const who = describeActor(action.actor, leadRoleName)
  const label = action.label || '(untitled action)'
  const what = describeEffect(action.effect, allStages)
  const inputsClause = action.inputs.length
    ? ` Collect: ${action.inputs.map((i) => i.label).join(', ')}.`
    : ' Collect: nothing.'
  return `When ${who} clicks "${label}", ${what}.${inputsClause}`
}

function describeActor(actor: import('../../../types/workflow').ActorRef, leadRoleName: string): string {
  switch (actor.kind) {
    case 'creator':
      return 'the project creator'
    case 'global_role':
      return actor.role === 'super_admin' ? 'a super-admin' : 'any global admin'
    case 'pipeline_role':
      return `the ${leadRoleName || 'project lead'}`
    case 'team_role': {
      const role =
        actor.role === 'validator'
          ? 'Validator Team'
          : actor.role === 'coordinator'
            ? 'Coordinator Team'
            : 'Specialist Team'
      return actor.member === 'lead' ? `the ${role} Lead` : `any ${role} member`
    }
  }
}

function describeEffect(
  effect: import('../../../types/workflow').ActionEffect,
  stages: Stage[],
): string {
  const labelFor = (id: string): string => stages.find((s) => s.id === id)?.displayName ?? id
  switch (effect.kind) {
    case 'transition':
      return `the project moves to "${labelFor(effect.toStage)}"`
    case 'transition_with_counter':
      return `the project moves to "${labelFor(effect.toStage)}" and the ${effect.counter} count increases`
    case 'assign_lead':
      return `the picked lead is assigned and the project moves to "${labelFor(effect.toStage)}"`
    case 'clear_lead':
      return `the lead is cleared and the project moves to "${labelFor(effect.toStage)}"`
    case 'set_status':
      return `the project status changes to one of: ${effect.statuses.join(', ')}`
    case 'mark_complete':
      return `the project is marked complete with outcome ${effect.outcomes.join(' or ')}`
  }
}
