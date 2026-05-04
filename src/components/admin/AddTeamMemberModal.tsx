import { useEffect, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import { addMemberToTeam } from '../../lib/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { useAllUsers } from '../../hooks/useAllUsers'

interface Props {
  open: boolean
  onClose: () => void
  teamId: string
  teamName: string
  currentMemberIds: string[]
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function AddTeamMemberModal({
  open,
  onClose,
  teamId,
  teamName,
  currentMemberIds,
}: Props) {
  const { user, profile } = useAuth()
  const { users } = useAllUsers()
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSelectedUid(null)
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function handleSubmit() {
    if (!selectedUid) {
      setError('Pick a user to add.')
      return
    }
    if (!user) return
    setError(null)
    setSubmitting(true)
    try {
      const memberName = users.find((u) => u.uid === selectedUid)?.displayName
      await addMemberToTeam({
        teamId,
        uid: selectedUid,
        actorId: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'Admin',
        teamName,
        ...(memberName ? { memberName } : {}),
      })
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
      title="Add member"
      description={`Add someone to ${teamName}. They'll immediately gain access to every project this team is on.`}
      size="md"
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void handleSubmit()
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-white/80">User</label>
          <UserPicker
            mode="single"
            value={selectedUid}
            onChange={setSelectedUid}
            placeholder="Pick someone"
            excludeUids={currentMemberIds}
            allowCreate
          />
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
            type="submit"
            disabled={!selectedUid || submitting}
            className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Adding…
              </span>
            ) : (
              'Add to team'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}