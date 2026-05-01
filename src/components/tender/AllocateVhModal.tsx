import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useAllUsers } from '../../hooks/useAllUsers'
import { transitionStage } from '../../lib/firestore'
import type { Project } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// Flow 14 — Super admin allocates project to a VH (stage 1 → 2).
export default function AllocateVhModal({ open, onClose, project }: Props) {
  const { user } = useAuth()
  const { users } = useAllUsers()
  const [vhId, setVhId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(
    () => users.filter((u) => u.globalRole === 'admin'),
    [users],
  )

  useEffect(() => {
    if (!open) {
      setVhId(null)
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!user || !vhId) return
    setSubmitting(true)
    setError(null)
    try {
      await transitionStage({
        projectId: project.id,
        enteredBy: user.uid,
        toStage: 2,
        events: [{ stage: 2, payload: null }],
        extras: { vhId },
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to allocate VH')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Allocate to Vertical Head"
      description="Pick the Admin who will run this tender's workflow."
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
          <label htmlFor="vh-pick" className="text-sm font-medium text-white/80">
            Vertical Head
          </label>
          <select
            id="vh-pick"
            value={vhId ?? ''}
            onChange={(e) => setVhId(e.target.value || null)}
            className="w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
            required
          >
            <option value="" className="bg-[#11111a]">
              Pick a VH…
            </option>
            {candidates.map((u) => (
              <option key={u.uid} value={u.uid} className="bg-[#11111a]">
                {u.displayName} — {u.email}
              </option>
            ))}
          </select>
          {candidates.length === 0 && (
            <p className="text-xs text-amber-300/80">
              No users with the Admin role yet. Create one from /admin/members first.
            </p>
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
            type="submit"
            disabled={!vhId || submitting}
            className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Allocating…' : 'Allocate'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
