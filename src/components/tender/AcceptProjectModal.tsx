import { useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { transitionStage } from '../../lib/firestore'
import type { Project } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// VH accepts the project (stage 2 → 4 → 6 in one batch).
// Stage 4 is transient (acceptance) and immediately resolves to 6 (task setup).
export default function AcceptProjectModal({ open, onClose, project }: Props) {
  const { user } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!user) return
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        enteredBy: user.uid,
        toStage: 6,
        events: [
          { stage: 4, payload: null },
          { stage: 6, payload: null },
        ],
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Accept project"
      description="You'll move straight to task setup. Add tasks for each team — execution begins as soon as you do."
      closeOnBackdrop={!submitting}
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-white/3 p-4 text-sm text-white/75">
          <p className="font-medium text-white">{project.title}</p>
          {project.description && (
            <p className="mt-1 text-white/55">{project.description}</p>
          )}
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
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Accepting…' : 'Accept & start task setup'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
