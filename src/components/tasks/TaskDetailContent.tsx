import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import { useAllTeams } from '../../hooks/useAllTeams'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useSubtasks } from '../../hooks/useSubtasks'
import { useOpenBlockers } from '../../hooks/useOpenBlockers'
import { useAncestorChain } from '../../hooks/useAncestorChain'
import { usePermissions } from '../../hooks/usePermissions'
import { useTaskPermissions } from '../../hooks/useTaskPermissions'
import { useAuth } from '../../contexts/AuthContext'
import { useFeature } from '../../contexts/AppConfigContext'
import { setTaskStatus, transitionTaskFromReview, updateTaskDetails } from '../../lib/firestore'
import { getEffectiveAssignee } from '../../lib/effectiveAssignee'
import {
  KIND_STYLES,
  canHaveChildren,
  childSectionLabel,
  effectiveKind,
} from '../../lib/taskKind'
import AddSubtaskForm from './AddSubtaskForm'
import DuplicateTaskModal from './DuplicateTaskModal'
import LinkedTasksSection from './LinkedTasksSection'
import StatusMenu from './StatusMenu'
import TaskAttachmentsSection from './TaskAttachmentsSection'
import CommentsSection from './CommentsSection'
import SubmitForReviewModal from '../workflow/SubmitForReviewModal'
import SendBackModal from '../workflow/SendBackModal'
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
  const location = useLocation()
  // Propagate the ORIGINAL background so opening the subtask swaps this modal in
  // place (over the same underlying page) instead of stacking overlays.
  const backgroundLocation =
    (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation ??
    location
  const assignee = task.assigneeId ? users.get(task.assigneeId) : null
  const reviewer = task.reviewerId ? users.get(task.reviewerId) : null
  const priority = PRIORITY_STYLES[task.priority]
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    task.dueDate.toDate().getTime() < Date.now()

  return (
    <Link
      to={`/tasks/${task.id}`}
      state={{ backgroundLocation }}
      className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 transition last:border-b-0 hover:bg-fill-2"
    >
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
    </Link>
  )
}

export default function TaskDetailContent({ task }: Props) {
  const { teams } = useAllTeams()
  const { users } = useAllUsers()
  const { subtasks, loading: subtasksLoading, error: subtasksError } = useSubtasks(task.id)
  const { isAdmin, isProjectOwner, isTeamLead } = usePermissions(task.projectId, task.teamId)
  const taskPerms = useTaskPermissions(task)
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const hierarchyOn = useFeature('taskHierarchy')
  const linkingOn = useFeature('taskLinking')
  const duplicationOn = useFeature('taskDuplication')
  const ancestors = useAncestorChain(hierarchyOn ? task : null)
  // Tasks that block this one and aren't done yet — gate completion (the write
  // path enforces it authoritatively; this drives the UI affordance).
  const openBlockers = useOpenBlockers(task)

  const [submitReviewOpen, setSubmitReviewOpen] = useState(false)
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  // Inline title/description editing.
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDescription, setEditDescription] = useState(task.description)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

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
  const isCreator = user?.uid === task.createdBy
  // Editing title/description + managing attachments: the creator, the assignee,
  // and anyone with project/team update rights.
  const canEdit = isAdmin || isProjectOwner || isTeamLead || isAssignee || isCreator
  const canAddSubtask = isAdmin || isProjectOwner || isTeamLead

  const kind = effectiveKind(task)
  // With hierarchy on, whether a task can have children depends on its tier
  // (a subtask can't). With it off, the legacy 2-level rule: only top-level.
  const showChildren = hierarchyOn ? canHaveChildren(kind) : !task.parentTaskId
  const isBlocked = openBlockers.length > 0
  // Generic on purpose — the specific blockers are already listed under Linked
  // Tasks, so we don't repeat their names here.
  const blockerHint = isBlocked
    ? `Blocked by ${openBlockers.length === 1 ? 'a linked task' : 'linked tasks'} — complete ${
        openBlockers.length === 1 ? 'it' : 'them'
      } first.`
    : undefined
  // Propagate the ORIGINAL background so opening an ancestor/linked task keeps
  // the modal stack sane (this view usually renders inside the overlay route).
  const backgroundLocation =
    (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation ??
    location

  function startEditing() {
    setEditTitle(task.title)
    setEditDescription(task.description)
    setEditError(null)
    setEditing(true)
  }

  async function handleSaveEdit() {
    if (!user || !profile || savingEdit) return
    if (!editTitle.trim()) {
      setEditError('Title is required.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      await updateTaskDetails({
        taskId: task.id,
        title: editTitle,
        description: editDescription,
        actorId: user.uid,
        actorName: profile.displayName,
      })
      setEditing(false)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setSavingEdit(false)
    }
  }

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
    setStatusError(null)
    try {
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
    } catch (e) {
      // Most likely the completion gate (blocked by an unfinished task).
      setStatusError(e instanceof Error ? e.message : 'Failed to change status')
    }
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
                disabled={approving || isBlocked}
                title={isBlocked ? blockerHint : undefined}
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

      {hierarchyOn && ancestors.length > 0 && (
        <nav className="flex flex-wrap items-center gap-1 text-xs text-fg-subtle" aria-label="Ancestors">
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <Link
                to={`/tasks/${a.id}`}
                state={{ backgroundLocation }}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-fill-2 px-2 py-0.5 transition hover:bg-fill-4 hover:text-fg"
              >
                <span className="text-fg-faint">{KIND_STYLES[a.kind].label}</span>
                <span className="max-w-48 truncate">{a.title}</span>
              </Link>
              <span aria-hidden className="text-fg-faint">/</span>
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <StatusMenu
          value={task.status}
          onChange={handleStatusChange}
          disabled={!canEdit}
          disabledStatuses={isBlocked ? ['done'] : undefined}
          disabledHint={blockerHint}
        />
        {hierarchyOn && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${KIND_STYLES[kind].cls}`}
          >
            {KIND_STYLES[kind].label}
          </span>
        )}
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
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-fill-2 px-2 py-0.5 text-xs text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </button>
        )}
        {duplicationOn && canAddSubtask && (
          <button
            type="button"
            onClick={() => setDuplicateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-fill-2 px-2 py-0.5 text-xs text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Duplicate
          </button>
        )}
      </div>

      {statusError && (
        <div
          role="alert"
          className="rounded-xl border border-tone-danger-bd bg-tone-danger-bg px-3 py-2.5 text-sm text-tone-danger-fg"
        >
          {statusError}
        </div>
      )}

      {editing ? (
        <div className="space-y-3 rounded-xl border border-line bg-card p-4">
          <div className="space-y-1.5">
            <label htmlFor="edit-task-title" className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Title
            </label>
            <input
              id="edit-task-title"
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-task-desc" className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Description
            </label>
            <textarea
              id="edit-task-desc"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
            />
          </div>
          {editError && (
            <div role="alert" className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">
              {editError}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={savingEdit}
              className="rounded-lg border border-line bg-fill-2 px-4 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={savingEdit || !editTitle.trim()}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingEdit ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : task.description ? (
        <p className="whitespace-pre-wrap text-sm text-fg-muted">{task.description}</p>
      ) : (
        <p className="text-sm italic text-fg-subtle">No description.</p>
      )}

      {showChildren && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
              {hierarchyOn ? childSectionLabel(kind) : 'Subtasks'}{' '}
              <span className="text-fg-muted">
                ({doneCount}/{totalCount})
              </span>
            </h3>
            {canAddSubtask && (
              <AddSubtaskForm parent={task} users={userById} teams={teamById} />
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

      {linkingOn && <LinkedTasksSection task={task} canEdit={canEdit} />}

      <TaskAttachmentsSection
        taskId={task.id}
        taskTitle={task.title}
        projectId={task.projectId}
        attachments={task.attachments ?? []}
        canEdit={canEdit}
      />

      <CommentsSection
        taskId={task.id}
        users={userById}
        projectId={task.projectId}
        taskTitle={task.title}
      />

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
      <DuplicateTaskModal
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        task={task}
        onDuplicated={(newId) => {
          setDuplicateOpen(false)
          navigate(`/tasks/${newId}`, { state: { backgroundLocation } })
        }}
      />
    </div>
  )
}