import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useOrgStructure } from '../../contexts/AppConfigContext'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAllTeams } from '../../hooks/useAllTeams'
import { resolveCoordinatorTeam } from '../../lib/orgResolver'
import { transitionTaskToReview } from '../../lib/firestore'
import type { Task } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
  // Which review status the task enters (features.techTaskStatuses adds
  // in_uat). Every entry into the review pipeline routes through this modal so
  // the task always carries a named reviewer. Defaults to in_review.
  targetStatus?: 'in_review' | 'in_uat'
}

// Submit a task to review. Reviewer suggestion is the coordinator team's lead
// by default (the team that owns client-facing validation); a searchable picker
// lets the user pick anyone on the project. Falls back to "pick a reviewer"
// when the tenant hasn't configured a coordinator role.
export default function SubmitForReviewModal({ open, onClose, task, targetStatus }: Props) {
  const { user, profile } = useAuth()
  const org = useOrgStructure()
  const { users } = useAllUsers()
  const { teams } = useAllTeams()
  const [reviewerId, setReviewerId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Coordinator team's lead — default-suggested reviewer. Null when the
  // tenant hasn't configured a coordinator role.
  const coordinatorLead = useMemo(() => {
    const projectTeams = teams.filter((t) => t.projectIds?.includes(task.projectId))
    return resolveCoordinatorTeam(projectTeams, org)
  }, [teams, task.projectId, org])
  const coordinatorLeadId = coordinatorLead?.leadId ?? null

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
      // Pre-select the coordinator lead, but never pre-select yourself.
      setReviewerId(coordinatorLeadId && coordinatorLeadId !== user?.uid ? coordinatorLeadId : null)
      setNotes('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, coordinatorLeadId, user?.uid])

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
        ...(targetStatus ? { targetStatus } : {}),
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
      title={targetStatus === 'in_uat' ? 'Move to UAT' : 'Submit for review'}
      description={
        coordinatorLead
          ? `We've suggested the lead of ${coordinatorLead.name} — change them if someone else should validate.`
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
