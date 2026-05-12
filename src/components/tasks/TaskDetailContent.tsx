import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import { useAllTeams } from '../../hooks/useAllTeams'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useSubtasks } from '../../hooks/useSubtasks'
import { usePermissions } from '../../hooks/usePermissions'
import { useTaskPermissions } from '../../hooks/useTaskPermissions'
import { useAuth } from '../../contexts/AuthContext'
import { setTaskStatus, transitionTaskFromReview } from '../../lib/firestore'
import { getEffectiveAssignee } from '../../lib/effectiveAssignee'
import AddSubtaskForm from './AddSubtaskForm'
import StatusMenu from './StatusMenu'
import TaskAttachmentsSection from './TaskAttachmentsSection'
import CommentsSection from './CommentsSection'
import SubmitForReviewModal from '../tender/SubmitForReviewModal'
import SendBackModal from '../tender/SendBackModal'
import type { Task, TaskPriority, TaskStatus, Team, User } from '../../types/models'

interface Props {
  task: Task
}

const STATUS_STYLES: Record<TaskStatus, { label: string; cls: string }> = {
  todo: { label: 'Todo', cls: 'border-line bg-fill-2 text-fg-muted' },
  in_progress: {
    label: 'In Progress',
    cls: 'border-tone-info-bd bg-tone-info-bg text-tone-info-fg',
  },
  in_review: {
    label: 'In Review',
    cls: 'border-brand-edge bg-brand-soft text-brand',
  },
  done: { label: 'Done', cls: 'border-tone-success-bd bg-tone-success-bg text-tone-success-fg' },
  blocked: { label: 'Blocked', cls: 'border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg' },
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-fg-muted' },
  medium: { label: 'Medium', cls: 'text-tone-warn-fg' },
  high: { label: 'High', cls: 'text-tone-danger-fg' },
}

function StatusPill({ status }: { status: TaskStatus }) {
  const s = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  )
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 22 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

function SubtaskRow({ task, users }: { task: Task; users: Map<string, User> }) {
  const assignee = task.assigneeId ? users.get(task.assigneeId) : null
  const reviewer = task.reviewerId ? users.get(task.reviewerId) : null
  const priority = PRIORITY_STYLES[task.priority]
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    task.dueDate.toDate().getTime() < Date.now()

  return (
    <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-b-0">
      <StatusPill status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{task.title}</div>
        {task.description && (
          <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">
            {task.description}
          </div>
        )}
        {task.status === 'in_review' && (reviewer || task.reviewerName) && (
          <div className="mt-0.5 text-[11px] text-brand/80">
            🔍 In review by {reviewer?.displayName ?? task.reviewerName}
          </div>
        )}
      </div>
      <div className="hidden items-center gap-3 text-xs sm:flex">
        {assignee ? (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <Avatar user={assignee} size={18} />
            <span className="truncate">{assignee.displayName}</span>
          </span>
        ) : task.assigneeName ? (
          <span className="text-fg-subtle">{task.assigneeName}</span>
        ) : (
          <span className="text-fg-faint">Unassigned</span>
        )}
        <span className={`font-medium ${priority.cls}`}>{priority.label}</span>
        <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}>
          {overdue ? 'Overdue · ' : ''}
          {formatDate(task.dueDate)}
        </span>
      </div>
    </div>
  )
}

export default function TaskDetailContent({ task }: Props) {
  const { teams } = useAllTeams()
  const { users } = useAllUsers()
  const { subtasks, loading: subtasksLoading, error: subtasksError } = useSubtasks(task.id)
  const { isAdmin, isProjectOwner, isTeamLead } = usePermissions(task.projectId, task.teamId)
  const taskPerms = useTaskPermissions(task)
  const { user, profile } = useAuth()

  const [submitReviewOpen, setSubmitReviewOpen] = useState(false)
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const team = useMemo(
    () => teams.find((t) => t.id === task.teamId) ?? null,
    [teams, task.teamId],
  )

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  const teamById = useMemo(() => {
    const m = new Map<string, Team>()
    for (const t of teams) m.set(t.id, t)
    return m
  }, [teams])

  const assignee = useMemo(
    () => getEffectiveAssignee(task, userById, teamById),
    [task, userById, teamById],
  )

  const isAssignee = user?.uid === task.assigneeId
  const canEdit = isAdmin || isProjectOwner || isTeamLead || isAssignee
  const canAddSubtask = isAdmin || isProjectOwner || isTeamLead

  const priority = PRIORITY_STYLES[task.priority]
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    task.dueDate.toDate().getTime() < Date.now()

  const doneCount = task.subtaskDoneCount ?? 0
  const totalCount = task.subtaskCount ?? subtasks.length

  async function handleStatusChange(next: TaskStatus) {
    // Submitting to review is a structured transition — open the modal so the
    // user picks a reviewer (and optionally writes notes). Modal commits the write.
    if (next === 'in_review' && task.status !== 'in_review') {
      setSubmitReviewOpen(true)
      return
    }
    if (!user || !profile) return
    // Approving from in_review goes through transitionTaskFromReview so reviewerId
    // is cleared and parent counters roll up cleanly. Prevents direct state writes
    // from bypassing the helper.
    if (task.status === 'in_review' && next === 'done') {
      await transitionTaskFromReview({
        taskId: task.id,
        decision: 'approve',
        authorId: user.uid,
        authorName: profile.displayName,
      })
      return
    }
    await setTaskStatus({
      taskId: task.id,
      status: next,
      actorId: user.uid,
      actorName: profile.displayName,
    })
  }

  async function handleApproveClick() {
    if (!user || !profile) return
    setApproving(true)
    setApproveError(null)
    try {
      await transitionTaskFromReview({
        taskId: task.id,
        decision: 'approve',
        authorId: user.uid,
        authorName: profile.displayName,
      })
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : 'Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  const reviewer =
    task.reviewerId ? userById.get(task.reviewerId) ?? null : null

  return (
    <div className="space-y-8">
      {task.status === 'in_review' && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand-edge bg-brand-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-tone-brandtone-fg">
            <span aria-hidden>🔍</span>
            <span>
              In review by{' '}
              <span className="font-medium text-fg">
                {reviewer?.displayName ?? task.reviewerName ?? 'someone'}
              </span>
            </span>
          </div>
          {taskPerms.canDecideReview && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApproveClick}
                disabled={approving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-tone-success-bd bg-tone-success-bg px-3.5 py-1.5 text-sm font-medium text-tone-success-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approving ? 'Approving…' : 'Approve →'}
              </button>
              <button
                type="button"
                onClick={() => setSendBackOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3.5 py-1.5 text-sm font-medium text-tone-warn-fg transition hover:opacity-90"
              >
                Send Back ↺
              </button>
            </div>
          )}
        </div>
      )}
      {approveError && (
        <div role="alert" className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          {approveError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <StatusMenu value={task.status} onChange={handleStatusChange} disabled={!canEdit} />
        {task.workType && (
          <span className="inline-flex items-center rounded-md border border-line bg-fill-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
            {task.workType}
          </span>
        )}
        {assignee && (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <Avatar user={assignee.user} size={20} />
            <span>
              {assignee.user.displayName}
              {assignee.implicit && (
                <span className="ml-1 text-fg-subtle">· Lead</span>
              )}
            </span>
          </span>
        )}
        <span className={`font-medium ${priority.cls}`}>{priority.label} priority</span>
        <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-muted'}>
          {overdue ? 'Overdue · ' : ''}
          {task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No deadline'}
        </span>
        <span className="text-fg-subtle">
          {task.teamName ?? team?.name ?? '—'}
          <span className="mx-2 text-fg-faint">·</span>
          {task.projectTitle ?? '—'}
        </span>
        <Link
          to={`/projects/${task.projectId}/boards`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-fill-2 px-2 py-0.5 text-xs text-fg-muted transition hover:bg-fill-4 hover:text-fg"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="6" height="16" rx="1" />
            <rect x="10" y="4" width="6" height="10" rx="1" />
            <rect x="17" y="4" width="4" height="7" rx="1" />
          </svg>
          Board View
        </Link>
      </div>

      {task.description ? (
        <p className="whitespace-pre-wrap text-sm text-fg-muted">{task.description}</p>
      ) : (
        <p className="text-sm italic text-fg-subtle">No description.</p>
      )}

      {!task.parentTaskId && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
              Subtasks{' '}
              <span className="text-fg-muted">
                ({doneCount}/{totalCount})
              </span>
            </h3>
            {canAddSubtask && team && (
              <AddSubtaskForm parent={task} team={team} users={userById} />
            )}
          </div>

          {subtasksError ? (
            <div className="rounded-xl border border-tone-danger-bd bg-tone-danger-bg p-4 text-sm text-tone-danger-fg">
              Couldn't load subtasks: {subtasksError}
              {subtasksError.includes('index') && (
                <div className="mt-1 text-tone-danger-fg/70">
                  Firestore wants a composite index for this query. Open the link in your browser
                  console to create it.
                </div>
              )}
            </div>
          ) : subtasksLoading ? (
            <div className="rounded-xl border border-line bg-card p-6 text-center text-xs text-fg-subtle">
              Loading subtasks…
            </div>
          ) : subtasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center">
              <p className="text-sm text-fg-subtle">
                No subtasks yet.{' '}
                {canAddSubtask
                  ? 'Break this task down to delegate work.'
                  : 'The team lead will add subtasks here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-card">
              {subtasks.map((s) => (
                <SubtaskRow key={s.id} task={s} users={userById} />
              ))}
            </div>
          )}
        </div>
      )}

      <TaskAttachmentsSection
        taskId={task.id}
        taskTitle={task.title}
        projectId={task.projectId}
        attachments={task.attachments ?? []}
        canEdit={canEdit}
      />

      <CommentsSection taskId={task.id} users={userById} />

      <SubmitForReviewModal
        open={submitReviewOpen}
        onClose={() => setSubmitReviewOpen(false)}
        task={task}
      />
      <SendBackModal
        open={sendBackOpen}
        onClose={() => setSendBackOpen(false)}
        task={task}
      />
    </div>
  )
}