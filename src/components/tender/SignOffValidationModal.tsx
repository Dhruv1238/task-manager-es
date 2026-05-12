import { useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectTasks } from '../../hooks/useProjectTasks'
import { transitionStage } from '../../lib/firestore'
import type { Project, TaskStatus } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

const STATUS_TONE: Record<TaskStatus, string> = {
  todo: 'border-line bg-fill-2 text-fg-muted',
  in_progress: 'border-tone-info-bd bg-tone-info-bg text-tone-info-fg',
  in_review: 'border-brand-edge bg-brand-soft text-brand',
  done: 'border-tone-success-bd bg-tone-success-bg text-tone-success-fg',
  blocked: 'border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg',
}

// CS lead signs off project-level: stage 7 → 8.
// Soft-gate: not hard-blocked on all tasks done — judgment call.
export default function SignOffValidationModal({ open, onClose, project }: Props) {
  const { user, profile } = useAuth()
  const { tasks } = useProjectTasks(project.id)
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!user || !confirmed) return
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        projectTitle: project.title,
        enteredBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        toStage: 8,
        events: [{ stage: 8, payload: null }],
      })
      setConfirmed(false)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign off')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sign off — ready for VH review"
      description="Confirms CS has validated everything. Advances the project to VH review."
      size="lg"
      closeOnBackdrop={!submitting}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-fg-subtle">Team tasks</p>
          {tasks.length === 0 ? (
            <p className="text-sm text-fg-subtle">No team tasks recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate text-fg-strong">{t.title}</div>
                    <div className="text-xs text-fg-subtle">{t.teamName ?? '—'}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_TONE[t.status]}`}
                  >
                    {t.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-line bg-card p-3 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line-strong bg-fill-4 accent-purple-500"
          />
          <span>
            I confirm CS has validated all deliverables and the project is ready for VH review.
          </span>
        </label>

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
            type="button"
            onClick={handleSubmit}
            disabled={!confirmed || submitting}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Signing off…' : 'Sign off'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
