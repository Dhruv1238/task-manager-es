import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { transitionStage, updateProjectStatus } from '../../lib/firestore'
import type { Project } from '../../types/models'

interface Props {
  open: boolean
  decision: 'approve' | 'reject'
  onClose: () => void
  project: Project
}

// Super admin's eligibility decision after the VH accepts.
//   - approve → stage 5 → 6 (task setup begins)
//   - reject  → project.status = 'not_submitted' (tender closes)
// VH's note is shown in both bodies so the super admin's decision context is in the modal.
export default function EligibilityReviewModal({ open, decision, onClose, project }: Props) {
  const { user, profile } = useAuth()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReject = decision === 'reject'

  useEffect(() => {
    if (!open) {
      setReason('')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function handleApprove() {
    if (!user) return
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        projectTitle: project.title,
        enteredBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        toStage: 6,
        events: [{ stage: 6, payload: null }],
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!user) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Add a reason — it lands in the project history and is the only record.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await updateProjectStatus({
        projectId: project.id,
        projectTitle: project.title,
        fromStatus: project.status,
        toStatus: 'not_submitted',
        note: trimmed,
        enteredBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        stage: 5,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
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
      title={isReject ? 'Reject — close tender' : 'Approve & continue to task setup'}
      description={
        isReject
          ? 'Closing the tender as Not submitted. Add a reason for the audit trail.'
          : "Confirms the VH's vertical is the right fit. Task setup begins next."
      }
      closeOnBackdrop={!submitting}
    >
      <div className="space-y-5">
        {/* VH's eligibility note — shown in both modes so the super admin's
            decision context is right where they're deciding. */}
        {project.eligibilityNote && (
          <blockquote className="rounded-lg border-l-2 border-tone-cool-bd bg-tone-cool-bg px-3 py-2.5 text-sm text-fg-muted">
            <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
              VH's assessment
            </span>
            <span className="mt-1 block">{project.eligibilityNote}</span>
          </blockquote>
        )}

        {isReject && (
          <div className="space-y-1.5">
            <label htmlFor="rej-reason" className="text-sm font-medium text-fg-muted">
              Reason
            </label>
            <textarea
              id="rej-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why isn't this tender a fit?"
              rows={3}
              className={`${inputCls} resize-none`}
              required
            />
          </div>
        )}

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
          {isReject ? (
            <button
              type="button"
              onClick={handleReject}
              disabled={submitting || !reason.trim()}
              className="flex-1 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Closing tender…' : 'Reject — close tender'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Approving…' : 'Approve & continue to task setup'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
