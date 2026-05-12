import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import { useAllUsers } from '../../hooks/useAllUsers'
import { transitionTaskFromReview } from '../../lib/firestore'
import type { Task } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
}

// Flow 18c — Reviewer rejects (sends back) with mandatory feedback.
// Optional reassign-to dropdown defaults to the original assignee.
export default function SendBackModal({ open, onClose, task }: Props) {
  const { user, profile } = useAuth()
  const { teams } = useAllTeams()
  const { users } = useAllUsers()

  const [feedback, setFeedback] = useState('')
  const [newAssigneeId, setNewAssigneeId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const team = useMemo(
    () => teams.find((t) => t.id === task.teamId) ?? null,
    [teams, task.teamId],
  )
  const assignees = useMemo(() => {
    if (!team) return []
    const ids = [team.leadId, ...team.memberIds.filter((id) => id !== team.leadId)]
    return ids
      .map((id) => users.find((u) => u.uid === id))
      .filter((u): u is (typeof users)[number] => Boolean(u))
  }, [team, users])

  useEffect(() => {
    if (open) {
      setFeedback('')
      setNewAssigneeId(task.assigneeId ?? '')
      setError(null)
      setSubmitting(false)
    }
  }, [open, task.assigneeId])

  async function handleSubmit() {
    if (!user || !profile) return
    const trimmed = feedback.trim()
    if (!trimmed) {
      setError('Feedback is required when sending back.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const newAssignee = newAssigneeId ? users.find((u) => u.uid === newAssigneeId) : undefined
      await transitionTaskFromReview({
        taskId: task.id,
        decision: 'reject',
        feedback: trimmed,
        newAssigneeId: newAssignee?.uid ?? null,
        newAssigneeName: newAssignee?.displayName ?? null,
        authorId: user.uid,
        authorName: profile.displayName,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send back')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send back for rework"
      description="Be specific — feedback is required and will appear in the task comments."
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
          <label htmlFor="rev-feedback" className="text-sm font-medium text-fg-muted">
            Feedback
          </label>
          <textarea
            id="rev-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Specifically what needs to change?"
            rows={4}
            className={`${inputCls} resize-none`}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rev-reassign" className="text-sm font-medium text-fg-muted">
            Reassign to <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <select
            id="rev-reassign"
            value={newAssigneeId}
            onChange={(e) => setNewAssigneeId(e.target.value)}
            className={inputCls}
          >
            <option value="" className="bg-overlay">
              Keep current assignee
            </option>
            {assignees.map((u) => (
              <option key={u.uid} value={u.uid} className="bg-overlay">
                {u.displayName}
              </option>
            ))}
          </select>
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
            disabled={!feedback.trim() || submitting}
            className="flex-1 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Sending back…' : 'Send Back'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
