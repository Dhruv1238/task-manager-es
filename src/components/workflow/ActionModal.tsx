import { useEffect, useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useActiveWorkflow, useOrgStructure } from '../../contexts/AppConfigContext'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAllTeams } from '../../hooks/useAllTeams'
import { runWorkflowAction } from '../../lib/firestore'
import { resolveTeamOfRoleOn } from '../../lib/orgResolver'
import type { Project, ProjectStatus, User } from '../../types/models'
import type { StageAction, ActionInput, ActorRef } from '../../types/workflow'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  action: StageAction | null
}

const STATUS_OPTIONS: ProjectStatus[] = [
  'in_progress',
  'submitted',
  'not_submitted',
  'awarded',
  'completed',
  'lost',
  'on_hold',
]

// Generic action modal: renders one form field per ActionInput, submits to
// runWorkflowAction. Replaces the per-stage modals introduced in Phase 1
// (AcceptProjectModal, AllocateVhModal, …) — those got deleted alongside this.
//
// Field-rendering rules:
//   text       → <input type=text>
//   textarea   → <textarea>
//   date       → <input type=date> stored as Timestamp on submit
//   select     → <select> from action.inputs.options
//   status_select → <select> from action.inputs.options ∩ ProjectStatus
//   user_picker → reuses ../ui/UserPicker, scoped by action.inputs.pickerScope
export default function ActionModal({ open, onClose, project, action }: Props) {
  const { user, profile } = useAuth()
  const org = useOrgStructure()
  const { workflow } = useActiveWorkflow()
  const { teams } = useAllTeams()
  const { users } = useAllUsers()
  const [values, setValues] = useState<Record<string, unknown>>({})

  const leadRoleName = workflow?.leadRoleName || org.leadRoleName
  const interpolatedLabel = action?.label.replace(/\{leadRoleName\}/g, leadRoleName) ?? ''
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues({})
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  const candidateUidsByInput = useMemo<Record<string, string[]>>(() => {
    if (!action) return {}
    const out: Record<string, string[]> = {}
    for (const input of action.inputs) {
      if (input.type !== 'user_picker' || !input.pickerScope) continue
      out[input.id] = resolvePickerScope(input.pickerScope, project, teams, org, users)
    }
    return out
  }, [action, project, teams, org, users])

  if (!action) return null

  async function handleSubmit() {
    if (!user || !action) return
    // Lightweight client-side validation; the evaluator re-runs all checks.
    for (const input of action.inputs) {
      const raw = values[input.id]
      const present = raw !== undefined && raw !== null && raw !== ''
      if (input.required && !present) {
        const label = input.label.replace(/\{leadRoleName\}/g, leadRoleName)
        setError(`${label} is required`)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      const inputs = coerceInputs(action.inputs, values)
      const extras: Record<string, unknown> = {}
      // Denormalise the eligibility note onto project.eligibilityNote during
      // the dual-write window so the side panel + project-detail blockquote
      // continue rendering. Sprint 5 drops this once readers move off it.
      if (typeof inputs.eligibilityNote === 'string') {
        extras.eligibilityNote = inputs.eligibilityNote
      }
      await runWorkflowAction({
        project,
        user: profile ?? ({ uid: user.uid, displayName: user.email ?? 'User' } as User),
        actionId: action.id,
        inputs,
        extras: Object.keys(extras).length ? extras : undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${interpolatedLabel}`)
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <Modal open={open} onClose={onClose} title={interpolatedLabel} closeOnBackdrop={!submitting}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="space-y-5"
      >
        {action.inputs.length === 0 && (
          <p className="text-sm text-fg-muted">
            Confirm to proceed. No additional details required.
          </p>
        )}

        {action.inputs.map((input) => (
          <div key={input.id} className="space-y-2">
            <label
              htmlFor={`action-${input.id}`}
              className="block text-sm font-medium text-fg-muted"
            >
              {input.label.replace(/\{leadRoleName\}/g, leadRoleName)}
              {input.required ? '' : <span className="ml-1 text-fg-subtle">(optional)</span>}
            </label>
            {renderField(
              input,
              values[input.id],
              (v) => setValues((s) => ({ ...s, [input.id]: v })),
              candidateUidsByInput[input.id] ?? [],
              inputCls,
            )}
          </div>
        ))}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
          >
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-3 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60 ${
              action.intent === 'danger'
                ? 'border border-tone-danger-bd bg-tone-danger-bg !text-tone-danger-fg shadow-none hover:opacity-90'
                : action.intent === 'success'
                  ? 'border border-tone-success-bd bg-tone-success-bg !text-tone-success-fg shadow-none hover:opacity-90'
                  : 'bg-brand-gradient shadow-purple-900/40 hover-brand-gradient'
            }`}
          >
            {submitting ? 'Submitting…' : interpolatedLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function renderField(
  input: ActionInput,
  value: unknown,
  onChange: (v: unknown) => void,
  candidateUids: string[],
  inputCls: string,
) {
  switch (input.type) {
    case 'text':
      return (
        <input
          id={`action-${input.id}`}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          required={input.required}
        />
      )
    case 'textarea':
      return (
        <textarea
          id={`action-${input.id}`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} resize-none`}
          rows={4}
          required={input.required}
        />
      )
    case 'date':
      return (
        <input
          id={`action-${input.id}`}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} scheme-dark`}
          required={input.required}
        />
      )
    case 'select':
      return (
        <select
          id={`action-${input.id}`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          required={input.required}
        >
          <option value="" className="bg-overlay">
            Choose…
          </option>
          {(input.options ?? []).map((opt) => (
            <option key={opt} value={opt} className="bg-overlay">
              {opt}
            </option>
          ))}
        </select>
      )
    case 'status_select': {
      const choices = (input.options ?? STATUS_OPTIONS) as string[]
      return (
        <select
          id={`action-${input.id}`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          required={input.required}
        >
          <option value="" className="bg-overlay">
            Choose…
          </option>
          {choices.map((opt) => (
            <option key={opt} value={opt} className="bg-overlay">
              {opt.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      )
    }
    case 'user_picker':
      return (
        <UserPicker
          id={`action-${input.id}`}
          mode="single"
          value={(value as string) ?? null}
          onChange={(uid) => onChange(uid)}
          includeUids={candidateUids}
          placeholder="Choose a user…"
        />
      )
  }
}

// Convert raw form values into the shape performAction expects. Most types
// pass through unchanged; dates become Timestamps.
function coerceInputs(
  inputs: ActionInput[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const input of inputs) {
    const raw = values[input.id]
    if (raw === undefined || raw === null || raw === '') continue
    if (input.type === 'date' && typeof raw === 'string') {
      out[input.id] = Timestamp.fromDate(new Date(raw))
    } else {
      out[input.id] = raw
    }
  }
  return out
}

// Picker scope is "<scope>:<value>". Phase 2a supports:
//   global_role:<role>             — all users with that role
//   team_role:<role>/any           — any member of any project-attached team of that role
//   team_role:<role>/lead          — the team lead only
function resolvePickerScope(
  scope: string,
  project: Project,
  teams: import('../../types/models').Team[],
  org: import('../../types/models').OrgStructure,
  users: User[],
): string[] {
  const [kind, rest] = scope.split(':')
  if (kind === 'global_role') {
    return users
      .filter((u) => u.globalRole === (rest as User['globalRole']))
      .map((u) => u.uid)
  }
  if (kind === 'team_role') {
    const [roleId, member] = (rest ?? '').split('/')
    const teamRoleId = roleId as ActorRef extends { kind: 'team_role'; role: infer R } ? R : never
    const team = resolveTeamOfRoleOn(teamRoleId, project, teams, org)
    if (!team) return []
    if (member === 'lead') return team.leadId ? [team.leadId] : []
    return team.memberIds
  }
  return []
}
