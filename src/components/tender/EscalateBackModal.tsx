import { useEffect, useState } from 'react'
import { Timestamp, increment } from 'firebase/firestore'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { transitionStage } from '../../lib/firestore'
import type { Project, StagePriority } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// Flow 15 — VH escalates back (stage 2 → 1, with stage 3 recorded as the event).
// Live `stage` immediately returns to 1; the history entry is stage 3 with the escalation payload.
// `vhId` is zeroed out per delta §10.14 — escalation is "I can't take this", not "later".
export default function EscalateBackModal({ open, onClose, project }: Props) {
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const [eta, setEta] = useState('')
  const [priority, setPriority] = useState<StagePriority>('medium')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setReason('')
      setEta('')
      setPriority('medium')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!user) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Reason is required when escalating.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        enteredBy: user.uid,
        toStage: 1,
        events: [
          {
            stage: 3,
            payload: {
              reason: trimmed,
              ...(eta ? { eta: Timestamp.fromDate(new Date(eta)) } : {}),
              priority,
            },
          },
        ],
        extras: {
          vhId: null,
          escalationCount: increment(1),
        },
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to escalate')
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
      title="Escalate back"
      description="Send this tender back to the allocation queue. The super admin will reassign."
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="space-y-5"
      >
        <div className="space-y-1.5">
          <label htmlFor="esc-reason" className="text-sm font-medium text-white/80">
            Reason
          </label>
          <textarea
            id="esc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you sending this back?"
            rows={3}
            className={`${inputCls} resize-none`}
            required
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="esc-eta" className="text-sm font-medium text-white/80">
              ETA <span className="font-normal text-white/40">(optional)</span>
            </label>
            <input
              id="esc-eta"
              type="date"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              className={`${inputCls} scheme-dark`}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="esc-priority" className="text-sm font-medium text-white/80">
              Priority
            </label>
            <select
              id="esc-priority"
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
            disabled={!reason.trim() || submitting}
            className="flex-1 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm font-medium text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit Escalation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
