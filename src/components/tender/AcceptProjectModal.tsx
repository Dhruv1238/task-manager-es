import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { transitionStage } from '../../lib/firestore'
import type { Project } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// VH accepts the project. Records:
//   - stage 4 (transient acceptance event, no payload)
//   - stage 5 (entry to eligibility review, payload carries the VH's note)
// Live stage = 5. The super admin then approves (→ 6) or rejects (→ closes).
export default function AcceptProjectModal({ open, onClose, project }: Props) {
  const { user, profile } = useAuth()
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setNote('')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!user) return
    const trimmed = note.trim()
    if (!trimmed) {
      setError('Add an eligibility note so the super admin can review.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        projectTitle: project.title,
        enteredBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        toStage: 5,
        events: [
          { stage: 4, payload: null },
          { stage: 5, payload: { note: trimmed } },
        ],
        extras: { eligibilityNote: trimmed },
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Accept & request eligibility review"
      description="Add your eligibility note. The super admin will review before task setup begins."
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="space-y-5"
      >
        <div className="rounded-xl border border-line bg-card p-4 text-sm text-fg-muted">
          <p className="font-medium text-fg">{project.title}</p>
          {project.description && (
            <p className="mt-1 text-fg-subtle">{project.description}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="eligibility-note" className="text-sm font-medium text-fg-muted">
            Eligibility assessment
          </label>
          <textarea
            id="eligibility-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this tender suited to your vertical? What's the strategic angle?"
            rows={4}
            className={`${inputCls} resize-none`}
            required
          />
          <p className="text-xs text-fg-subtle">
            The super admin reads this before the project moves into task setup.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
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
            disabled={submitting || !note.trim()}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Accept & send for review'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
