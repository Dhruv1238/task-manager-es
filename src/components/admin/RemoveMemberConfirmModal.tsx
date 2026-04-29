import { useEffect, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import Modal from '../ui/Modal'
import { db } from '../../lib/firebase'
import { removeMemberFromTeam } from '../../lib/firestore'
import type { User } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  teamId: string
  teamName: string
  member: User
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function RemoveMemberConfirmModal({
  open,
  onClose,
  teamId,
  teamName,
  member,
}: Props) {
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setOpenTaskCount(null)
      setCounting(false)
      setSubmitting(false)
      setError(null)
      return
    }
    let cancelled = false
    setCounting(true)
    const q = query(
      collection(db, 'tasks'),
      where('assigneeId', '==', member.uid),
      where('status', '!=', 'done'),
    )
    getCountFromServer(q)
      .then((snap) => {
        if (cancelled) return
        setOpenTaskCount(snap.data().count)
        setCounting(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(friendlyError(e))
        setCounting(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, member.uid])

  async function handleConfirm() {
    setError(null)
    setSubmitting(true)
    try {
      await removeMemberFromTeam(teamId, member.uid)
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remove member"
      description={`Remove ${member.displayName} from ${teamName}?`}
      size="md"
      closeOnBackdrop={!submitting}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/2 p-4 text-sm">
          <p className="text-white/80">
            They'll lose access to every project this team is on.
          </p>
          {counting ? (
            <p className="mt-2 text-xs text-white/50">Checking open tasks…</p>
          ) : openTaskCount !== null && openTaskCount > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <strong className="font-semibold">{openTaskCount} open task{openTaskCount === 1 ? '' : 's'}</strong>{' '}
              will remain assigned to {member.displayName}. Reassign them manually after the
              removal.
            </div>
          ) : openTaskCount === 0 ? (
            <p className="mt-2 text-xs text-white/50">No open tasks assigned to them.</p>
          ) : null}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
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
            onClick={handleConfirm}
            disabled={submitting || counting}
            className="flex-1 rounded-lg border border-red-500/40 bg-red-500/20 px-4 py-3 text-sm font-medium text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Removing…
              </span>
            ) : (
              'Remove'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}