import { useEffect, useState } from 'react'
import { Timestamp, increment } from 'firebase/firestore'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { transitionStage } from '../../lib/firestore'
import type { Project, StagePriority } from '../../types/models'

interface Props {
  open: boolean
  decision: 'approve' | 'reject'
  onClose: () => void
  project: Project
}

// Flow 19 — VH review at stage 8.
// Approve → 10 (clean transition).
// Reject  → records stage-9 event with iteration payload, lives stage = 7 (loop back).
export default function VhReviewModal({ open, decision, onClose, project }: Props) {
  const { user } = useAuth()
  const [feedback, setFeedback] = useState('')
  const [eta, setEta] = useState('')
  const [priority, setPriority] = useState<StagePriority>('medium')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReject = decision === 'reject'
  const nextIteration = (project.vhIterationCount ?? 0) + 1

  useEffect(() => {
    if (!open) {
      setFeedback('')
      setEta('')
      setPriority('medium')
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
        enteredBy: user.uid,
        toStage: 10,
        events: [{ stage: 10, payload: null }],
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
    const trimmed = feedback.trim()
    if (!trimmed) {
      setError('Feedback is required when sending back.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        enteredBy: user.uid,
        toStage: 7,
        events: [
          {
            stage: 9,
            payload: {
              iteration: nextIteration,
              feedback: trimmed,
              ...(eta ? { eta: Timestamp.fromDate(new Date(eta)) } : {}),
              priority,
            },
          },
          { stage: 7, payload: null },
        ],
        extras: { vhIterationCount: increment(1) },
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReject ? 'Send back for rework' : 'Approve & deliver'}
      description={
        isReject
          ? `Iteration ${nextIteration} — leaves clear feedback for CT and the specialists.`
          : 'Marks the deliverable ready for client. CS will handle final delivery.'
      }
      closeOnBackdrop={!submitting}
    >
      {isReject ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleReject()
          }}
          className="space-y-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="vh-feedback" className="text-sm font-medium text-white/80">
              Feedback
            </label>
            <textarea
              id="vh-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Specifically what needs to change?"
              rows={4}
              className={`${inputCls} resize-none`}
              required
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="vh-eta" className="text-sm font-medium text-white/80">
                ETA <span className="font-normal text-white/40">(optional)</span>
              </label>
              <input
                id="vh-eta"
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className={`${inputCls} scheme-dark`}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="vh-prio" className="text-sm font-medium text-white/80">
                Priority
              </label>
              <select
                id="vh-prio"
                value={priority}
                onChange={(e) => setPriority(e.target.value as StagePriority)}
                className={inputCls}
              >
                <option value="low" className="bg-[#11111a]">Low</option>
                <option value="medium" className="bg-[#11111a]">Medium</option>
                <option value="high" className="bg-[#11111a]">High</option>
              </select>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!feedback.trim() || submitting}
              className="flex-1 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm font-medium text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Sending back…' : 'Send Back'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            Approving sends <span className="font-medium">{project.title}</span> to the client. CS will record the final outcome.
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Approving…' : 'Approve & advance'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
