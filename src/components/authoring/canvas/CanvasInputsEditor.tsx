import { Plus, Trash2, Lock } from 'lucide-react'
import type { ActionInput } from '../../../types/workflow'
import type { ProjectRoleDef } from '../../../types/workflow'
import type { OrgStructure } from '../../../types/models'
import type { RoleDef } from '../../../types/v2'
import Dropdown, { type DropdownOption } from '../../ui/Dropdown'
import { buildPickerScopeOptions } from './pickerScopeOptions'

// Canvas-native editor for an action's Attributes — the data collected when
// someone performs the action (short text, note, date, dropdown, status, or a
// user picker). Distinct from project-creation custom fields (those live on the
// workflow's projectFields and are edited in the Workflow-settings drawer).
//
// Rows whose id is in `lockedInputIds` are owned by the Assign control: their
// type can't change and they can't be removed (deleting them would break the
// assignment), but their label / pickerScope stay editable.

const TYPE_OPTIONS: DropdownOption[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Note (long text)' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown (custom options)' },
  { value: 'status_select', label: 'Status picker' },
  { value: 'user_picker', label: 'Choose a user' },
]

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-2.5 py-1.5 text-xs text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

export interface CanvasInputsEditorProps {
  inputs: ActionInput[]
  roles: RoleDef[]
  projectRoles: ProjectRoleDef[]
  org: OrgStructure
  lockedInputIds?: string[]
  disabled?: boolean
  onChange: (next: ActionInput[]) => void
}

export function CanvasInputsEditor({
  inputs,
  roles,
  projectRoles,
  org,
  lockedInputIds,
  disabled,
  onChange,
}: CanvasInputsEditorProps) {
  const locked = new Set(lockedInputIds ?? [])
  const scopeGroups = buildPickerScopeOptions(org, roles, projectRoles)

  function addInput() {
    const id = `input-${Math.random().toString(36).slice(2, 7)}`
    onChange([...inputs, { id, label: 'New input', type: 'text', required: false }])
  }
  function updateInput(idx: number, next: ActionInput) {
    onChange(inputs.map((i, j) => (j === idx ? next : i)))
  }
  function removeInput(idx: number) {
    onChange(inputs.filter((_, j) => j !== idx))
  }

  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          Attributes
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={addInput}
            className="inline-flex items-center gap-1 text-[11px] text-brand transition hover:opacity-80"
          >
            <Plus size={11} /> Add input
          </button>
        )}
      </div>

      {inputs.length === 0 && (
        <p className="text-[11px] text-fg-faint">
          No details collected — performing this action just runs it.
        </p>
      )}

      <ul className="space-y-2">
        {inputs.map((input, idx) => {
          const isLocked = locked.has(input.id)
          return (
            <li key={input.id} className="space-y-1.5 rounded-lg border border-line bg-fill-2 p-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input.label}
                  disabled={disabled}
                  onChange={(e) => updateInput(idx, { ...input, label: e.target.value })}
                  placeholder="Label"
                  className="min-w-0 flex-1 bg-transparent text-xs font-medium text-fg outline-none"
                />
                <label className="flex items-center gap-1 text-[10px] text-fg-muted">
                  <input
                    type="checkbox"
                    checked={input.required}
                    disabled={disabled || isLocked}
                    onChange={(e) => updateInput(idx, { ...input, required: e.target.checked })}
                  />
                  Required
                </label>
                {!disabled && !isLocked && (
                  <button
                    type="button"
                    title="Remove input"
                    onClick={() => removeInput(idx)}
                    className="rounded p-0.5 text-fg-subtle transition hover:text-tone-danger-fg"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              <Dropdown
                value={input.type}
                disabled={disabled || isLocked}
                onChange={(v) =>
                  updateInput(idx, {
                    ...input,
                    type: v as ActionInput['type'],
                    options: undefined,
                    pickerScope: undefined,
                  })
                }
                options={TYPE_OPTIONS}
                className="text-[11px]"
              />

              {(input.type === 'select' || input.type === 'status_select') && (
                <textarea
                  value={(input.options ?? []).join('\n')}
                  disabled={disabled}
                  onChange={(e) =>
                    updateInput(idx, {
                      ...input,
                      options: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={2}
                  placeholder="option a&#10;option b"
                  className={`${inputCls} resize-none`}
                />
              )}

              {input.type === 'user_picker' && (
                <Dropdown
                  value={input.pickerScope ?? ''}
                  disabled={disabled}
                  onChange={(v) => updateInput(idx, { ...input, pickerScope: v || undefined })}
                  groups={scopeGroups}
                  placeholder="Who can be picked?"
                  className="text-[11px]"
                />
              )}

              {isLocked && (
                <p className="flex items-center gap-1 text-[10px] text-fg-faint">
                  <Lock size={9} /> Used by this action&rsquo;s assignment.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
