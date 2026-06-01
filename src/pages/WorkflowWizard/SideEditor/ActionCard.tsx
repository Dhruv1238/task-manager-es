import { useState } from 'react'
import type {
  ActionEffect,
  ActorRef,
  ProjectRoleDef,
  Stage,
  StageAction,
} from '../../../types/workflow'
import ActionExpandedEditor from './ActionExpandedEditor'
import ActionActorsPopover from './ActionActorsPopover'

interface Props {
  action: StageAction
  stage: Stage
  allStages: Stage[]
  leadRoleName: string
  projectRoles: ProjectRoleDef[]
  onChange: (next: StageAction) => void
  onDelete: () => void
  disabled?: boolean
}

// Phase 2c→2d: sentence-template action card. The collapsed state reads as plain
// English with the "who" rendered as clickable permission pills (never a
// matrix). Click Edit to tune the label / effect / inputs.
export default function ActionCard({
  action,
  stage,
  allStages,
  leadRoleName,
  projectRoles,
  onChange,
  onDelete,
  disabled,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  // Map the popover's flat allowed-set back to actor (canonical) + alsoAllow.
  function setActors(next: ActorRef[]) {
    const [first, ...rest] = next
    onChange({
      ...action,
      actor: first ?? { kind: 'global_role', role: 'super_admin' },
      alsoAllow: rest.length ? rest : undefined,
    })
  }

  return (
    <div className="rounded-xl border border-line bg-fill-1 p-3">
      {!expanded ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-fg">
            <span className="text-fg-subtle">At {stage.displayName},</span>
            <ActionActorsPopover
              value={[action.actor, ...(action.alsoAllow ?? [])]}
              onChange={setActors}
              projectRoles={projectRoles}
              leadRoleName={leadRoleName}
              disabled={disabled}
            />
            <span className="text-fg-subtle">can</span>
            <span className="rounded-md bg-fill-3 px-2 py-0.5 text-xs font-medium text-fg-strong">
              {action.label || '(untitled action)'}
            </span>
            <span className="text-fg-subtle">— {describeEffect(action.effect, allStages)}</span>
          </div>
          {action.inputs.length > 0 && (
            <p className="mt-1.5 text-xs text-fg-subtle">
              Collects: {action.inputs.map((i) => i.label).join(', ')}.
            </p>
          )}
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
          projectRoles={projectRoles}
          onChange={onChange}
          onDone={() => setExpanded(false)}
          disabled={disabled}
        />
      )}
    </div>
  )
}

function describeEffect(effect: ActionEffect, stages: Stage[]): string {
  const labelFor = (id: string): string => stages.find((s) => s.id === id)?.displayName ?? id
  switch (effect.kind) {
    case 'transition':
      return `moves the project to "${labelFor(effect.toStage)}"`
    case 'transition_with_counter':
      return `moves the project to "${labelFor(effect.toStage)}" and bumps the ${effect.counter} count`
    case 'assign_lead':
      return `assigns the picked lead and moves to "${labelFor(effect.toStage)}"`
    case 'clear_lead':
      return `clears the lead and moves to "${labelFor(effect.toStage)}"`
    case 'set_status':
      return `sets the status to one of: ${effect.statuses.join(', ')}`
    case 'mark_complete':
      return `marks the project complete with outcome ${effect.outcomes.join(' or ')}`
    case 'assign_project_role':
      return `assigns the picked user to a project role`
  }
}
