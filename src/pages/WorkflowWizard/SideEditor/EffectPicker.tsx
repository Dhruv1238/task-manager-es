import type { ProjectStatus } from '../../../types/models'
import type { ActionEffect, Stage } from '../../../types/workflow'
import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'

interface Props {
  value: ActionEffect
  onChange: (next: ActionEffect) => void
  // All stages in the workflow (so the target-stage dropdown can list options).
  stages: Stage[]
  // The id of the stage this action lives on — excluded from the target list
  // to avoid pointless self-transitions in the UI (the schema allows it but
  // it's almost always an authoring mistake).
  currentStageId: string
}

const STATUS_OPTIONS: ProjectStatus[] = [
  'in_progress',
  'submitted',
  'not_submitted',
  'awarded',
  'completed',
  'lost',
  'on_hold',
  'archived',
]

const EFFECT_KIND_LABELS: Array<{ kind: ActionEffect['kind']; label: string; hint: string }> = [
  { kind: 'transition', label: 'Move to another stage', hint: 'Most common — just advances the project.' },
  { kind: 'transition_with_counter', label: 'Move to another stage and bump a counter', hint: 'For escalations or iteration loop-backs.' },
  { kind: 'assign_lead', label: 'Assign the project lead and move to a stage', hint: 'Adds a user picker input automatically.' },
  { kind: 'clear_lead', label: 'Clear the project lead and move to a stage', hint: 'Used by escalation paths.' },
  { kind: 'set_status', label: 'Change the project status', hint: 'Stays on the same stage; only flips status.' },
  { kind: 'mark_complete', label: 'Mark the project complete', hint: 'Closes the project with one of the listed outcomes.' },
]

// Phase 2c: effect picker for the sentence-template action editor. Renders a
// dropdown of effect kinds; each kind reveals a sub-picker (target stage,
// outcomes, statuses, counter type).
export default function EffectPicker({ value, onChange, stages, currentStageId }: Props) {
  const targetableStages = stages.filter((s) => s.id !== currentStageId)
  const effectKindOptions: DropdownOption[] = EFFECT_KIND_LABELS.map((o) => ({
    value: o.kind,
    label: o.label,
  }))
  const targetStageOptions: DropdownOption[] = targetableStages.map((s) => ({
    value: s.id,
    label: `${s.displayName}${s.isTerminal ? ' (terminal)' : ''}`,
  }))
  const counterOptions: DropdownOption[] = [
    { value: 'iteration', label: 'Iteration (count of revisions)' },
    { value: 'escalation', label: 'Escalation (count of escalations)' },
  ]

  function changeKind(nextKind: ActionEffect['kind']) {
    const firstTarget = targetableStages[0]?.id ?? currentStageId
    switch (nextKind) {
      case 'transition':
        onChange({ kind: 'transition', toStage: firstTarget })
        return
      case 'transition_with_counter':
        onChange({ kind: 'transition_with_counter', toStage: firstTarget, counter: 'iteration' })
        return
      case 'assign_lead':
        onChange({ kind: 'assign_lead', toStage: firstTarget })
        return
      case 'clear_lead':
        onChange({ kind: 'clear_lead', toStage: firstTarget })
        return
      case 'set_status':
        onChange({ kind: 'set_status', statuses: ['in_progress'] })
        return
      case 'mark_complete':
        onChange({ kind: 'mark_complete', toStage: firstTarget, outcomes: ['completed'] })
        return
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
        What happens when they click?
      </label>
      <Dropdown
        value={value.kind}
        onChange={(v) => changeKind(v as ActionEffect['kind'])}
        options={effectKindOptions}
      />
      <p className="text-xs text-fg-subtle">
        {EFFECT_KIND_LABELS.find((o) => o.kind === value.kind)?.hint}
      </p>

      {(value.kind === 'transition' ||
        value.kind === 'transition_with_counter' ||
        value.kind === 'assign_lead' ||
        value.kind === 'clear_lead' ||
        value.kind === 'mark_complete') && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Target stage
          </label>
          <Dropdown
            value={value.toStage}
            onChange={(v) => onChange({ ...value, toStage: v } as ActionEffect)}
            options={targetStageOptions}
          />
        </div>
      )}

      {value.kind === 'transition_with_counter' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Counter to bump
          </label>
          <Dropdown
            value={value.counter}
            onChange={(v) =>
              onChange({ ...value, counter: v as 'escalation' | 'iteration' })
            }
            options={counterOptions}
          />
        </div>
      )}

      {value.kind === 'set_status' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Status options
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {STATUS_OPTIONS.map((s) => {
              const checked = value.statuses.includes(s)
              return (
                <label key={s} className="flex items-center gap-2 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...value.statuses, s]
                        : value.statuses.filter((x) => x !== s)
                      onChange({ ...value, statuses: next })
                    }}
                  />
                  {s.replace(/_/g, ' ')}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {value.kind === 'mark_complete' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Allowed outcomes
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {STATUS_OPTIONS.map((s) => {
              const checked = value.outcomes.includes(s)
              return (
                <label key={s} className="flex items-center gap-2 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...value.outcomes, s]
                        : value.outcomes.filter((x) => x !== s)
                      onChange({ ...value, outcomes: next })
                    }}
                  />
                  {s.replace(/_/g, ' ')}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
