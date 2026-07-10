import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import UserPicker from '../ui/UserPicker'
import TeamPicker from '../ui/TeamPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useFeature } from '../../contexts/AppConfigContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import { useAllUsers } from '../../hooks/useAllUsers'
import { duplicateTask } from '../../lib/firestore'
import { KIND_STYLES, effectiveKind } from '../../lib/taskKind'
import type { Task } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
  onDuplicated: (newTaskId: string) => void
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

// Confirm-and-edit dialog for task duplication: pre-fills the copied fields, lets
// the user tweak title/description and reassign, and spells out what is (and
// isn't) copied.
export default function DuplicateTaskModal({ open, onClose, task, onDuplicated }: Props) {
  const { user, profile } = useAuth()
  const crossTeamOn = useFeature('crossTeamSubtasks')
  const { teams } = useAllTeams()
  const { users } = useAllUsers()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed on open / when the dialog is pointed at a different task. Keyed on
  // task.id (NOT the live title/description/assignee) so a concurrent edit to
  // the source task while this dialog is open doesn't clobber in-progress input.
  useEffect(() => {
    if (open) {
      setTitle(`Copy of ${task.title}`)
      setDescription(task.description ?? '')
      setTeamId(task.teamId)
      setAssigneeId(task.assigneeId ?? null)
      setError(null)
      setSubmitting(false)
    }
    // Intentionally seed-once-per-open: reads live values at seed time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task.id])

  // Eligible assignees = the selected team (lead + members), same set as New Task.
  // Include the source's own assignee only while still on the source team, so a
  // pre-filled value renders even if they've since left the team.
  const eligibleUids = useMemo(() => {
    const team = teams.find((t) => t.id === teamId)
    const base = team ? [team.leadId, ...team.memberIds] : []
    const includeSource =
      teamId === task.teamId && task.assigneeId ? [task.assigneeId] : []
    return Array.from(new Set([...base, ...includeSource]))
  }, [teams, teamId, task.teamId, task.assigneeId])

  async function handleConfirm() {
    if (!user || submitting) return
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (!teamId) {
      setError('Pick a team.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const assigneeName = assigneeId
        ? users.find((u) => u.uid === assigneeId)?.displayName ?? null
        : null
      const teamName = teams.find((t) => t.id === teamId)?.name ?? task.teamName ?? ''
      const newId = await duplicateTask(
        task,
        { uid: user.uid, displayName: profile?.displayName ?? user.email ?? 'User' },
        { title, description, assigneeId, assigneeName, teamId, teamName },
      )
      onDuplicated(newId)
    } catch (e) {
      setError(friendlyError(e))
      setSubmitting(false)
    }
  }

  const kind = effectiveKind(task)
  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicate task"
      description="Creates a new task from this one. Review and edit before confirming."
      size="lg"
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void handleConfirm()
        }}
        className="space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <label htmlFor="dup-title" className="text-sm font-medium text-fg-muted">
            Title
          </label>
          <input
            id="dup-title"
            type="text"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="dup-description" className="text-sm font-medium text-fg-muted">
            Description <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <textarea
            id="dup-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>

        {crossTeamOn && (
          <div className="space-y-1.5">
            <label htmlFor="dup-team" className="text-sm font-medium text-fg-muted">
              Team
            </label>
            <TeamPicker
              id="dup-team"
              value={teamId}
              onChange={(next) => {
                // Only reset the assignee when the team actually changes — the
                // previous pick may not belong to the new team. Re-selecting the
                // same team must not wipe the seeded assignee.
                if (next !== teamId) setAssigneeId(null)
                setTeamId(next)
              }}
              placeholder="Search teams…"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="dup-assignee" className="text-sm font-medium text-fg-muted">
            Assignee <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <UserPicker
            id="dup-assignee"
            mode="single"
            value={assigneeId}
            onChange={setAssigneeId}
            placeholder="Unassigned"
            includeUids={eligibleUids}
            clearable
          />
        </div>

        <div className="rounded-lg border border-line bg-fill-1 px-3 py-2.5 text-xs text-fg-subtle">
          Carries over: <span className="text-fg-muted">{KIND_STYLES[kind].label}</span>, priority,
          type, and due date. Starts fresh as <span className="text-fg-muted">Todo</span>.
          <br />
          Not copied: subtasks, attachments, and links.
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg"
          >
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-2.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Duplicating…' : 'Duplicate task'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
