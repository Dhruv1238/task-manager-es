import { UserPlus } from 'lucide-react'
import type { ActionInput, StageAction, Workflow } from '../../../types/workflow'
import type { Outcome, RoleDef } from '../../../types/v2'
import { readOutcomes } from '../../../lib/rules/outcomeAdapter'
import Dropdown, { type DropdownOption } from '../../ui/Dropdown'

// First-class "assign a person" control. An action can pick a user (candidate
// list scoped to a hierarchy role, or anyone) and assign them as the project
// lead OR to a workflow project role. It's a projection over existing fields:
//   - one owned user_picker input (id `leadUid` for lead, `assignUid:<roleId>`
//     for a project role) carrying the eligible-scope pickerScope, and
//   - an `assign` marker written on every outcome of the action.
// executeOutcome reads outcome.assign and writes project.leadUid /
// roleAssignments; ProjectRolesSection renders the result on the project screen.

export interface AssignPersonEditorProps {
  action: StageAction
  workflow: Workflow
  roles: RoleDef[]
  leadRoleName?: string
  disabled?: boolean
  onChangeAction: (patch: Partial<StageAction>) => void
  // Inline-create a workflow project role; returns its new id (or undefined).
  onCreateProjectRole?: (label: string) => string | undefined
}

function ownedInputFor(
  target: 'lead' | { roleId: string },
  workflow: Workflow,
  leadRoleName: string | undefined,
  scope: string | undefined,
): ActionInput {
  if (target === 'lead') {
    return {
      id: 'leadUid',
      label: `Choose ${leadRoleName || 'lead'}`,
      type: 'user_picker',
      required: true,
      pickerScope: scope || undefined,
    }
  }
  const label = workflow.projectRoles?.find((r) => r.id === target.roleId)?.label ?? 'assignee'
  return {
    id: `assignUid:${target.roleId}`,
    label: `Choose ${label}`,
    type: 'user_picker',
    required: true,
    pickerScope: scope || undefined,
  }
}

export function AssignPersonEditor({
  action,
  workflow,
  roles,
  leadRoleName,
  disabled,
  onChangeAction,
  onCreateProjectRole,
}: AssignPersonEditorProps) {
  const outcomes = readOutcomes(action)
  const current = outcomes.find((o) => o.assign)?.assign
  const enabled = Boolean(current)
  const ownedInputId = current?.fromInputId
  const ownedInput = action.inputs.find((i) => i.id === ownedInputId)
  const scope = ownedInput?.pickerScope
  const targetVal = !current ? 'lead' : current.target === 'lead' ? 'lead' : `project_role:${current.target.roleId}`

  function applyAssign(target: 'lead' | { roleId: string }, scopeVal: string | undefined) {
    const owned = ownedInputFor(target, workflow, leadRoleName, scopeVal)
    const cleared = action.inputs.filter((i) => i.id !== ownedInputId && i.id !== owned.id)
    const nextOutcomes: Outcome[] = readOutcomes(action).map((o) => ({
      ...o,
      assign: { target, fromInputId: owned.id },
    }))
    onChangeAction({ inputs: [...cleared, owned], outcomes: nextOutcomes })
  }

  function disableAssign() {
    const nextInputs = action.inputs.filter((i) => i.id !== ownedInputId)
    const nextOutcomes: Outcome[] = readOutcomes(action).map((o) => {
      const next = { ...o }
      delete next.assign
      return next
    })
    onChangeAction({ inputs: nextInputs, outcomes: nextOutcomes })
  }

  function changeTarget(v: string) {
    if (v === '__create__') {
      const id = onCreateProjectRole?.('New role')
      if (id) applyAssign({ roleId: id }, scope)
      return
    }
    if (v === 'lead') applyAssign('lead', scope)
    else if (v.startsWith('project_role:')) applyAssign({ roleId: v.slice('project_role:'.length) }, scope)
  }

  const targetOptions: DropdownOption[] = [
    { value: 'lead', label: `The project lead (${leadRoleName || 'lead'})` },
    ...[...(workflow.projectRoles ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((pr) => ({ value: `project_role:${pr.id}`, label: pr.label })),
    ...(onCreateProjectRole ? [{ value: '__create__', label: '+ New workflow role…' }] : []),
  ]

  const scopeOptions: DropdownOption[] = [
    { value: '', label: 'Anyone' },
    ...[...roles]
      .sort((a, b) => a.level - b.level || a.order - b.order)
      .map((r) => ({ value: `role:${r.id}`, label: `Holders of ${r.label}` })),
  ]

  return (
    <div className="mt-3 space-y-1.5 border-t border-line-subtle pt-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        <UserPlus size={11} /> Assignment
      </div>
      <label className="flex items-center gap-2 text-[11px] text-fg-muted">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => (e.target.checked ? applyAssign('lead', scope) : disableAssign())}
          className="accent-[var(--color-brand)]"
        />
        This action assigns a person
      </label>
      {enabled && (
        <div className="space-y-1.5 pl-1">
          <div>
            <div className="mb-1 text-[10px] text-fg-faint">Assign as</div>
            <Dropdown
              value={targetVal}
              disabled={disabled}
              onChange={changeTarget}
              options={targetOptions}
              className="text-[11px]"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] text-fg-faint">Who&rsquo;s eligible</div>
            <Dropdown
              value={scope ?? ''}
              disabled={disabled}
              onChange={(v) => current && applyAssign(current.target, v || undefined)}
              options={scopeOptions}
              className="text-[11px]"
            />
          </div>
          <p className="text-[10px] text-fg-faint">
            The chosen person shows on the project&rsquo;s Roles section.
          </p>
        </div>
      )}
    </div>
  )
}
