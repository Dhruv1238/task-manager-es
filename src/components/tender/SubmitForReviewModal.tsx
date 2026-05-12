import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAllTeams } from '../../hooks/useAllTeams'
import { transitionTaskToReview } from '../../lib/firestore'
import type { Task } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
}

// Submit a task to review. Reviewer suggestion is the project's CS lead by default
// (CS validates execution); a searchable picker (same UserPicker used elsewhere)
// lets the user pick anyone on the project including other CS members.
export default function SubmitForReviewModal({ open, onClose, task }: Props) {
  const { user, profile } = useAuth()
  const { users } = useAllUsers()
  const { teams } = useAllTeams()
  const [reviewerId, setReviewerId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // CS lead of this project — used as the default-suggested reviewer.
  const csLeadId = useMemo(() => {
    const projectTeams = teams.filter((t) => t.projectIds?.includes(task.projectId))
    const cs = projectTeams.find((t) => /client servicing|^cs\b/i.test(t.name))
    return cs?.leadId ?? null
  }, [teams, task.projectId])

  // All members of teams attached to this project — the eligible reviewer pool.
  // Excludes the current user (you can't review your own task).
  const projectMemberUids = useMemo(() => {
    const projectTeams = teams.filter((t) => t.projectIds?.includes(task.projectId))
    const ids = new Set<string>()
    for (const t of projectTeams) {
      ids.add(t.leadId)
      t.memberIds.forEach((id) => ids.add(id))
    }
    return Array.from(ids)
  }, [teams, task.projectId])

  useEffect(() => {
    if (open) {
      // Pre-select the CS lead, but never pre-select yourself.
      setReviewerId(csLeadId && csLeadId !== user?.uid ? csLeadId : null)
      setNotes('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, csLeadId, user?.uid])

  async function handleSubmit() {
    if (!user || !profile) return
    if (!reviewerId) {
      setError('Pick a reviewer.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const reviewer = users.find((u) => u.uid === reviewerId)
      await transitionTaskToReview({
        taskId: task.id,
        reviewerId,
        ...(reviewer?.displayName ? { reviewerName: reviewer.displayName } : {}),
        notes,
        authorId: user.uid,
        authorName: profile.displayName,
        taskTitle: task.title,
        projectId: task.projectId,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit for review')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  // UserPicker excludes current user (no self-review). includeUids constrains to
  // project members so a 200-person org doesn't surface unrelated names.
  const exclude = user?.uid ? [user.uid] : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit for review"
      description={
        csLeadId
          ? "We've suggested the project's CS lead — change them if someone else should validate."
          : 'Pick the reviewer who should validate this work.'
      }
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
          <label htmlFor="reviewer" className="text-sm font-medium text-fg-muted">
            Reviewer
          </label>
          <UserPicker
            id="reviewer"
            mode="single"
            value={reviewerId}
            onChange={setReviewerId}
            placeholder="Search project members…"
            includeUids={projectMemberUids}
            excludeUids={exclude}
          />
          {projectMemberUids.length === 0 && (
            <p className="text-xs text-tone-warn-fg/80">
              No project members yet. Add teams to this project first.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="notes" className="text-sm font-medium text-fg-muted">
            Notes for reviewer <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything specific to validate?"
            rows={3}
            className={`${inputCls} resize-none`}
          />
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
            disabled={!reviewerId || submitting}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
