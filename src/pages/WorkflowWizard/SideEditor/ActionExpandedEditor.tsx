import { useEffect } from 'react'
import type { ActorRef, ProjectRoleDef, Stage, StageAction } from '../../../types/workflow'
import ActionActorsPopover from './ActionActorsPopover'
import EffectPicker from './EffectPicker'
import InputsEditor from './InputsEditor'

interface Props {
  action: StageAction
  stage: Stage
  allStages: Stage[]
  leadRoleName: string
  projectRoles: ProjectRoleDef[]
  onChange: (next: StageAction) => void
  onDone: () => void
  disabled?: boolean
}

// Phase 2c: expanded editing form for one StageAction. Wraps the actor / effect
// / inputs / intent pickers and keeps the assign_lead → user_picker invariant
// (auto-injects a locked user_picker input when the effect switches to
// assign_lead).
export default function ActionExpandedEditor({
  action,
  stage,
  allStages,
  leadRoleName,
  projectRoles,
  onChange,
  onDone,
  disabled,
}: Props) {
  // Map the popover's flat allowed-set back to actor (canonical) + alsoAllow.
  function setActors(next: ActorRef[]) {
    const [first, ...rest] = next
    onChange({
      ...action,
      actor: first ?? { kind: 'global_role', role: 'super_admin' },
      alsoAllow: rest.length ? rest : undefined,
    })
  }
  // Auto-inject the user_picker input when the effect becomes assign_lead. We
  // do it as an effect so the InputsEditor renders the locked row on the same
  // tick as the dropdown change.
  useEffect(() => {
    if (action.effect.kind !== 'assign_lead') return
    if (action.inputs.some((i) => i.type === 'user_picker')) return
    onChange({
      ...action,
      inputs: [
        {
          id: 'leadUid',
          label: `Choose ${leadRoleName || 'lead'}`,
          type: 'user_picker',
          required: true,
          pickerScope: 'global_role:admin',
        },
        ...action.inputs,
      ],
    })
  }, [action, leadRoleName, onChange])

  const inputCls =
    'w-full scheme-dark rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  // Mirrors StageBanner's button styling so the picker IS the preview.
  const intentClassMap: Record<NonNullable<StageAction['intent']>, string> = {
    primary:
      'bg-brand-gradient text-white shadow-lg shadow-purple-900/30 hover-brand-gradient',
    success:
      'border border-tone-success-bd bg-tone-success-bg text-tone-success-fg hover:opacity-90',
    danger:
      'border border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg hover:opacity-90',
    neutral:
      'border border-line bg-fill-2 text-fg-muted hover:bg-fill-4',
  }
  const intentLabelMap: Record<NonNullable<StageAction['intent']>, string> = {
    primary: 'Primary',
    success: 'Success',
    danger: 'Destructive',
    neutral: 'Neutral',
  }
  const currentIntent = (action.intent ?? 'primary') as NonNullable<StageAction['intent']>

  return (
    <div
      className="space-y-4 rounded-xl border border-line bg-fill-1 p-4"
      aria-disabled={disabled || undefined}
    >
      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Button label
        </label>
        <input
          type="text"
          value={action.label}
          maxLength={32}
          onChange={(e) => onChange({ ...action, label: e.target.value })}
          placeholder="Submit"
          className={inputCls}
          disabled={disabled}
        />
        <div className="text-xs text-fg-subtle">
          Preview:{' '}
          <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-fg-strong">
            {action.label || 'Button'}
          </span>
        </div>
      </div>

      <fieldset disabled={disabled} className="space-y-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Who can do this?
          </label>
          <ActionActorsPopover
            value={[action.actor, ...(action.alsoAllow ?? [])]}
            onChange={setActors}
            projectRoles={projectRoles}
            leadRoleName={leadRoleName}
            disabled={disabled}
          />
        </div>

        <EffectPicker
          value={action.effect}
          onChange={(effect) => onChange({ ...action, effect })}
          stages={allStages}
          currentStageId={stage.id}
        />

        <InputsEditor
          inputs={action.inputs}
          effect={action.effect}
          onChange={(inputs) => onChange({ ...action, inputs })}
        />

        <details className="rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Advanced
          </summary>
          <div className="mt-3 space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Button style — click a sample to pick it
            </label>
            <div
              role="radiogroup"
              aria-label="Button style"
              className="grid gap-2 sm:grid-cols-2"
            >
              {(['primary', 'success', 'danger', 'neutral'] as const).map((intent) => {
                const isActive = currentIntent === intent
                return (
                  <button
                    key={intent}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => onChange({ ...action, intent })}
                    className={`group flex items-center justify-between gap-3 rounded-lg border p-2 text-left transition ${
                      isActive
                        ? 'border-brand-edge bg-brand-soft ring-2 ring-brand-ring'
                        : 'border-line bg-fill-1 hover:border-line-strong hover:bg-fill-2'
                    }`}
                  >
                    <span className="text-xs font-medium text-fg-muted">
                      {intentLabelMap[intent]}
                    </span>
                    <span
                      aria-hidden
                      className={`pointer-events-none inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${intentClassMap[intent]}`}
                    >
                      {action.label?.trim() || 'Button'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-fg-subtle">
              The preview reflects how this action's button will look in the project banner.
            </p>
          </div>
        </details>
      </fieldset>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white shadow hover-brand-gradient"
        >
          Done
        </button>
      </div>
    </div>
  )
}
