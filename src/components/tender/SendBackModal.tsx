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
    'w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20'

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
          <label htmlFor="rev-feedback" className="text-sm font-medium text-white/80">
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
          <label htmlFor="rev-reassign" className="text-sm font-medium text-white/80">
            Reassign to <span className="font-normal text-white/40">(optional)</span>
          </label>
          <select
            id="rev-reassign"
            value={newAssigneeId}
            onChange={(e) => setNewAssigneeId(e.target.value)}
            className={inputCls}
          >
            <option value="" className="bg-[#11111a]">
              Keep current assignee
            </option>
            {assignees.map((u) => (
              <option key={u.uid} value={u.uid} className="bg-[#11111a]">
                {u.displayName}
              </option>
            ))}
          </select>
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
            disabled={!feedback.trim() || submitting}
            className="flex-1 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm font-medium text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Sending back…' : 'Send Back'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
