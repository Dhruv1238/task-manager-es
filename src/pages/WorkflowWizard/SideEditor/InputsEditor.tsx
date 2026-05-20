import type { ActionEffect, ActionInput } from '../../../types/workflow'
import { useOrgStructure } from '../../../contexts/AppConfigContext'
import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'

interface Props {
  inputs: ActionInput[]
  effect: ActionEffect
  onChange: (next: ActionInput[]) => void
}

// Phase 2c: edit the list of ActionInputs collected when the user runs an
// action. When the effect is `assign_lead`, a required `user_picker` input
// is auto-added and locked — the editor still surfaces it but blocks delete /
// type-change so save-time validation can't fail on the obvious "no picker
// for an assign_lead" mistake.
export default function InputsEditor({ inputs, effect, onChange }: Props) {
  const org = useOrgStructure()

  const isAssignLead = effect.kind === 'assign_lead'
  const inputCls =
    'w-full scheme-dark rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  const typeOptions: DropdownOption[] = [
    { value: 'text', label: 'Short text' },
    { value: 'textarea', label: 'Long text' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Dropdown (custom options)' },
    { value: 'status_select', label: 'Status picker' },
    { value: 'user_picker', label: 'Choose a user' },
  ]

  const pickerScopeOptions: DropdownOption[] = [
    { value: 'global_role:admin', label: 'Any global admin' },
    ...(org.teamRoles.hasCoordinator
      ? [{ value: 'team_role:coordinator/any', label: 'Any Coordinator Team member' }]
      : []),
    ...(org.teamRoles.hasValidator
      ? [{ value: 'team_role:validator/any', label: 'Any Validator Team member' }]
      : []),
    ...(org.teamRoles.hasSpecialist
      ? [{ value: 'team_role:specialist/any', label: 'Any Specialist Team member' }]
      : []),
  ]

  function addInput() {
    const id = `input-${Math.random().toString(36).slice(2, 7)}`
    onChange([
      ...inputs,
      { id, label: 'New input', type: 'text', required: false },
    ])
  }

  function updateInput(idx: number, next: ActionInput) {
    onChange(inputs.map((i, j) => (j === idx ? next : i)))
  }

  function removeInput(idx: number) {
    onChange(inputs.filter((_, j) => j !== idx))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Inputs to collect
        </label>
        <button
          type="button"
          onClick={addInput}
          className="text-xs font-medium text-brand-link hover:underline"
        >
          + Add input
        </button>
      </div>

      {inputs.length === 0 && !isAssignLead && (
        <p className="text-xs text-fg-subtle">
          No inputs — clicking the action just runs it immediately.
        </p>
      )}

      <ul className="space-y-3">
        {inputs.map((input, idx) => {
          const isLocked = isAssignLead && input.type === 'user_picker'
          return (
            <li
              key={input.id}
              className="space-y-2 rounded-lg border border-line bg-fill-1 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={input.label}
                  onChange={(e) => updateInput(idx, { ...input, label: e.target.value })}
                  placeholder="Label"
                  className={`${inputCls} max-w-xs`}
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={input.required}
                      disabled={isLocked}
                      onChange={(e) =>
                        updateInput(idx, { ...input, required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => removeInput(idx)}
                      className="text-xs text-tone-danger-fg hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <Dropdown
                value={input.type}
                disabled={isLocked}
                onChange={(v) =>
                  updateInput(idx, {
                    ...input,
                    type: v as ActionInput['type'],
                    options: undefined,
                    pickerScope: undefined,
                  })
                }
                options={typeOptions}
              />

              {(input.type === 'select' || input.type === 'status_select') && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                    Options (one per line)
                  </label>
                  <textarea
                    value={(input.options ?? []).join('\n')}
                    onChange={(e) =>
                      updateInput(idx, {
                        ...input,
                        options: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    rows={3}
                    placeholder="option a&#10;option b"
                    className={`${inputCls} resize-none`}
                  />
                </div>
              )}

              {input.type === 'user_picker' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                    Who can be picked?
                  </label>
                  <Dropdown
                    value={input.pickerScope ?? 'global_role:admin'}
                    onChange={(v) => updateInput(idx, { ...input, pickerScope: v })}
                    options={pickerScopeOptions}
                  />
                </div>
              )}

              {isLocked && (
                <p className="text-xs text-fg-subtle">
                  Locked — this action assigns a lead, so it needs a user picker.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
