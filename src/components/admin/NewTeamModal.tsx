import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import { useAuth } from '../../contexts/AuthContext'
import { addTeam } from '../../lib/firestore'

interface Props {
  open: boolean
  onClose: () => void
  // When provided, called with the new team id after creation instead of navigating to /teams/:id.
  // Use this for inline creation (e.g. from ManageTeamsModal) so the caller can keep context.
  onCreated?: (teamId: string) => void
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function NewTeamModal({ open, onClose, onCreated }: Props) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [leadId, setLeadId] = useState<string | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      setLeadId(null)
      setMemberIds([])
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  const memberPickerExclude = useMemo(() => (leadId ? [leadId] : []), [leadId])

  async function handleSubmit() {
    if (!user) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Team name is required.')
      return
    }
    if (!leadId) {
      setError('Pick a team lead.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const finalMembers = Array.from(new Set([leadId, ...memberIds]))
      const teamId = await addTeam({
        name: trimmedName,
        description: description.trim() || undefined,
        leadId,
        memberIds: finalMembers,
        createdBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'Admin',
      })
      onClose()
      if (onCreated) {
        onCreated(teamId)
      } else {
        navigate(`/teams/${teamId}`)
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  const canSubmit = !!name.trim() && !!leadId && !submitting

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New team"
      description="Teams are global and can be assigned to any project."
      size="lg"
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <label htmlFor="team-name" className="text-sm font-medium text-fg-muted">
            Name
          </label>
          <input
            id="team-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Design Team"
            autoComplete="off"
            className={inputCls}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="team-description" className="text-sm font-medium text-fg-muted">
            Description <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <textarea
            id="team-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this team own?"
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="team-lead" className="text-sm font-medium text-fg-muted">
            Team lead
          </label>
          <UserPicker
            id="team-lead"
            mode="single"
            value={leadId}
            onChange={setLeadId}
            placeholder="Pick a lead"
            allowCreate
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="team-members" className="text-sm font-medium text-fg-muted">
              Additional members
            </label>
            <span className="text-xs text-fg-subtle">
              {leadId ? 'Lead is always a member' : 'Pick a lead first'}
            </span>
          </div>
          <UserPicker
            id="team-members"
            mode="multi"
            value={memberIds}
            onChange={setMemberIds}
            placeholder="Add teammates"
            excludeUids={memberPickerExclude}
            allowCreate
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
          >
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
            disabled={!canSubmit}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-white" />
                Creating…
              </span>
            ) : (
              'Create team'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}