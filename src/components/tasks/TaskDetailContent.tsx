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
  todo: { label: 'Todo', cls: 'border-white/15 bg-white/5 text-white/70' },
  in_progress: {
    label: 'In Progress',
    cls: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
  },
  in_review: {
    label: 'In Review',
    cls: 'border-purple-400/40 bg-purple-500/15 text-purple-200',
  },
  done: { label: 'Done', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' },
  blocked: { label: 'Blocked', cls: 'border-red-400/40 bg-red-500/15 text-red-200' },
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-white/60' },
  medium: { label: 'Medium', cls: 'text-amber-300' },
  high: { label: 'High', cls: 'text-red-300' },
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
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white"
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
    <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0">
      <StatusPill status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{task.title}</div>
        {task.description && (
          <div className="mt-0.5 line-clamp-1 text-xs text-white/50">
            {task.description}
          </div>
        )}
        {task.status === 'in_review' && (reviewer || task.reviewerName) && (
          <div className="mt-0.5 text-[11px] text-purple-200/80">
            🔍 In review by {reviewer?.displayName ?? task.reviewerName}
          </div>
        )}
      </div>
      <div className="hidden items-center gap-3 text-xs sm:flex">
        {assignee ? (
          <span className="inline-flex items-center gap-1.5 text-white/70">
            <Avatar user={assignee} size={18} />
            <span className="truncate">{assignee.displayName}</span>
          </span>
        ) : task.assigneeName ? (
          <span className="text-white/50">{task.assigneeName}</span>
        ) : (
          <span className="text-white/30">Unassigned</span>
        )}
        <span className={`font-medium ${priority.cls}`}>{priority.label}</span>
        <span className={overdue ? 'text-red-300' : 'text-white/50'}>
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
    // Approving from in_review goes through transitionTaskFromReview so reviewerId
    // is cleared and parent counters roll up cleanly. Prevents direct state writes
    // from bypassing the helper.
    if (task.status === 'in_review' && next === 'done') {
      if (!user || !profile) return
      await transitionTaskFromReview({
        taskId: task.id,
        decision: 'approve',
        authorId: user.uid,
        authorName: profile.displayName,
      })
      return
    }
    await setTaskStatus(task.id, next)
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
        <div className="flex flex-col gap-3 rounded-xl border border-purple-400/30 bg-purple-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-purple-100">
            <span aria-hidden>🔍</span>
            <span>
              In review by{' '}
              <span className="font-medium text-white">
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3.5 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approving ? 'Approving…' : 'Approve →'}
              </button>
              <button
                type="button"
                onClick={() => setSendBackOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3.5 py-1.5 text-sm font-medium text-amber-100 transition hover:bg-amber-500/20"
              >
                Send Back ↺
              </button>
            </div>
          )}
        </div>
      )}
      {approveError && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {approveError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <StatusMenu value={task.status} onChange={handleStatusChange} disabled={!canEdit} />
        {task.workType && (
          <span className="inline-flex items-center rounded-md border border-white/10 bg-white/4 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-white/60">
            {task.workType}
          </span>
        )}
        {assignee && (
          <span className="inline-flex items-center gap-1.5 text-white/70">
            <Avatar user={assignee.user} size={20} />
            <span>
              {assignee.user.displayName}
              {assignee.implicit && (
                <span className="ml-1 text-white/40">· Lead</span>
              )}
            </span>
          </span>
        )}
        <span className={`font-medium ${priority.cls}`}>{priority.label} priority</span>
        <span className={overdue ? 'text-red-300' : 'text-white/60'}>
          {overdue ? 'Overdue · ' : ''}
          {task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No deadline'}
        </span>
        <span className="text-white/50">
          {task.teamName ?? team?.name ?? '—'}
          <span className="mx-2 text-white/20">·</span>
          {task.projectTitle ?? '—'}
        </span>
        <Link
          to={`/projects/${task.projectId}/boards`}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-2 py-0.5 text-xs text-white/70 transition hover:bg-white/8 hover:text-white"
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
        <p className="whitespace-pre-wrap text-sm text-white/80">{task.description}</p>
      ) : (
        <p className="text-sm italic text-white/40">No description.</p>
      )}

      {!task.parentTaskId && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-wider text-white/40">
              Subtasks{' '}
              <span className="text-white/60">
                ({doneCount}/{totalCount})
              </span>
            </h3>
            {canAddSubtask && team && (
              <AddSubtaskForm parent={task} team={team} users={userById} />
            )}
          </div>

          {subtasksError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              Couldn't load subtasks: {subtasksError}
              {subtasksError.includes('index') && (
                <div className="mt-1 text-red-200/70">
                  Firestore wants a composite index for this query. Open the link in your browser
                  console to create it.
                </div>
              )}
            </div>
          ) : subtasksLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/2 p-6 text-center text-xs text-white/40">
              Loading subtasks…
            </div>
          ) : subtasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/1 p-6 text-center">
              <p className="text-sm text-white/50">
                No subtasks yet.{' '}
                {canAddSubtask
                  ? 'Break this task down to delegate work.'
                  : 'The team lead will add subtasks here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/2">
              {subtasks.map((s) => (
                <SubtaskRow key={s.id} task={s} users={userById} />
              ))}
            </div>
          )}
        </div>
      )}

      <TaskAttachmentsSection
        taskId={task.id}
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