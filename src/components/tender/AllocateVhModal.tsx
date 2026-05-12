import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
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
  const { user, profile } = useAuth()
  const { users } = useAllUsers()
  const [vhId, setVhId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The VH pool is users with the 'admin' global role (per delta §2.1).
  const candidateUids = useMemo(
    () => users.filter((u) => u.globalRole === 'admin').map((u) => u.uid),
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
        projectTitle: project.title,
        enteredBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
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
          <label htmlFor="vh-pick" className="text-sm font-medium text-fg-muted">
            Vertical Head
          </label>
          <UserPicker
            id="vh-pick"
            mode="single"
            value={vhId}
            onChange={setVhId}
            placeholder="Search admins…"
            includeUids={candidateUids}
          />
          {candidateUids.length === 0 && (
            <p className="text-xs text-tone-warn-fg/80">
              No users with the Admin role yet. Create one from Members first.
            </p>
          )}
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
            disabled={!vhId || submitting}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Allocating…' : 'Allocate'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
