import { useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import UserPicker from '../ui/UserPicker'
import { useAuth } from '../../contexts/AuthContext'
import { addSubtask } from '../../lib/firestore'
import type { Task, TaskPriority, Team, User } from '../../types/models'

interface Props {
  parent: Task
  team: Team
  users: Map<string, User>
}

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export default function AddSubtaskForm({ parent, team, users }: Props) {
  const { user, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle('')
    setDescription('')
    setAssigneeId(null)
    setPriority('medium')
    setDueDate('')
    setError(null)
    setSubmitting(false)
  }

  function close() {
    reset()
    setOpen(false)
  }

  async function handleSubmit() {
    if (!user) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Title is required.')
      return
    }
    if (!assigneeId) {
      setError('Pick an assignee.')
      return
    }
    const assignee = users.get(assigneeId)
    if (!assignee) {
      setError('Selected user not found.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await addSubtask({
        parentTaskId: parent.id,
        projectId: parent.projectId,
        teamId: parent.teamId,
        projectTitle: parent.projectTitle ?? '',
        teamName: parent.teamName ?? '',
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : undefined,
        assigneeId: assignee.uid,
        assigneeName: assignee.displayName,
        createdBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
      })
      close()
    } catch (e) {
      setError(friendlyError(e))
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add subtask
      </button>
    )
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void handleSubmit()
      }}
      className="space-y-3 rounded-xl border border-line bg-card p-4"
      noValidate
    >
      <input
        type="text"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Subtask title"
        autoComplete="off"
        autoFocus
        className={inputCls}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <UserPicker
          mode="single"
          value={assigneeId}
          onChange={setAssigneeId}
          placeholder="Assign to teammate"
          includeUids={team.memberIds}
        />

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={`${inputCls} scheme-dark`}
        />
      </div>

      <div className="flex gap-2">
        {PRIORITIES.map((p) => {
          const active = priority === p.value
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPriority(p.value)}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
                active
                  ? 'border-brand-edge bg-brand-soft text-fg'
                  : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-4'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className={`${inputCls} resize-none`}
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={close}
          disabled={submitting}
          className="rounded-lg border border-line bg-fill-2 px-4 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim() || !assigneeId}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-white" />
              Adding…
            </span>
          ) : (
            'Add subtask'
          )}
        </button>
      </div>
    </form>
  )
}