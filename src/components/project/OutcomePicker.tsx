import { useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import Dropdown from '../ui/Dropdown'
import { useAuth } from '../../contexts/AuthContext'
import { useOrgStructure } from '../../contexts/AppConfigContext'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAllTeams } from '../../hooks/useAllTeams'
import { runWorkflowAction } from '../../lib/firestore'
import { readOutcomes } from '../../lib/rules/outcomeAdapter'
import { SHAPE_PILL } from '../authoring/canvas/edgeTokens'
import type { Project, User } from '../../types/models'
import type { ActionInput, StageAction } from '../../types/workflow'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  action: StageAction | null
}

const inputCls =
  'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

// Phase 3 runtime: performing a v2 action with multiple named outcomes opens
// this picker — collect any inputs, then choose the branch. Single-outcome v2
// actions auto-resolve through runWorkflowAction; legacy actions never reach
// here (StageBanner only routes actions that carry authored `outcomes`).
export default function OutcomePicker({ open, onClose, project, action }: Props) {
  const { user, profile } = useAuth()
  const org = useOrgStructure()
  const { users } = useAllUsers()
  const { teams } = useAllTeams()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues({})
      setError(null)
      setSubmitting(null)
    }
  }, [open])

  if (!action) return null
  const outcomes = readOutcomes(action)

  async function choose(outcomeId: string) {
    if (!user || !action) return
    for (const input of action.inputs) {
      const raw = values[input.id]
      if (input.required && (raw === undefined || raw === null || raw === '')) {
        setError(`${input.label} is required`)
        return
      }
    }
    setSubmitting(outcomeId)
    setError(null)
    try {
      const inputs: Record<string, unknown> = {}
      for (const input of action.inputs) {
        const raw = values[input.id]
        if (raw === undefined || raw === null || raw === '') continue
        inputs[input.id] =
          input.type === 'date' && typeof raw === 'string'
            ? Timestamp.fromDate(new Date(raw))
            : raw
      }
      await runWorkflowAction({
        project,
        user: profile ?? ({ uid: user.uid, displayName: user.email ?? 'User' } as User),
        actionId: action.id,
        inputs,
        outcomeId,
        teams,
        org,
        users,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the outcome.')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={action.label} closeOnBackdrop={!submitting}>
      <div className="space-y-5">
        {action.inputs.map((input) => (
          <div key={input.id} className="space-y-2">
            <label className="block text-sm font-medium text-fg-muted">
              {input.label}
              {!input.required && <span className="ml-1 text-fg-subtle">(optional)</span>}
            </label>
            {renderField(input, values[input.id], (v) => setValues((s) => ({ ...s, [input.id]: v })))}
          </div>
        ))}

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Choose an outcome
          </div>
          <div className="flex flex-wrap gap-2">
            {outcomes.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={Boolean(submitting)}
                onClick={() => choose(o.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${SHAPE_PILL[o.shape]} border-transparent hover:opacity-90`}
              >
                {submitting === o.id ? 'Working…' : o.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

function renderField(input: ActionInput, value: unknown, onChange: (v: unknown) => void) {
  switch (input.type) {
    case 'textarea':
      return (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={`${inputCls} resize-none`}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} scheme-dark`}
        />
      )
    case 'select':
    case 'status_select':
      return (
        <Dropdown
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
          placeholder="Choose…"
          options={(input.options ?? []).map((opt) => ({
            value: opt,
            label: opt.replace(/_/g, ' '),
          }))}
          className="w-full"
        />
      )
    case 'user_picker':
      return (
        <UserPicker
          mode="single"
          value={(value as string) ?? null}
          onChange={(uid) => onChange(uid)}
          placeholder="Choose a user…"
        />
      )
    case 'text':
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )
  }
}
