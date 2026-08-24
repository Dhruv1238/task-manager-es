import { Link, useLocation } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import { Clock } from 'lucide-react'
import { getEffectiveAssignee } from '../../lib/effectiveAssignee'
import { formatDuration } from '../../lib/duration'
import { useFeature } from '../../contexts/AppConfigContext'
import { KIND_STYLES, effectiveKind } from '../../lib/taskKind'
import type { Task, TaskPriority, Team, User } from '../../types/models'

interface Props {
  task: Task
  users: Map<string, User>
  teams: Map<string, Team>
  parentTitle?: string | null
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string; dot: string }> = {
  low: { label: 'Low', cls: 'text-fg-subtle', dot: 'bg-neutral-dot' },
  medium: { label: 'Medium', cls: 'text-tone-warn-fg', dot: 'bg-warn-dot' },
  high: { label: 'High', cls: 'text-tone-danger-fg', dot: 'bg-danger-dot' },
}

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 18 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

function formatShortDate(ts: Timestamp | undefined): string | null {
  if (!ts) return null
  return ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function TaskCard({ task, users, teams, parentTitle }: Props) {
  const location = useLocation()
  const showDescription = useFeature('descriptionPreview')
  const hierarchyOn = useFeature('taskHierarchy')
  const assignee = getEffectiveAssignee(task, users, teams)
  const priority = PRIORITY_STYLES[task.priority]
  const due = formatShortDate(task.dueDate)
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    task.dueDate.toDate().getTime() < Date.now()
  const isSubtask = Boolean(task.parentTaskId)
  const kind = effectiveKind(task)
  // Fall back to the denormalized parentTitle when the bucketing layer couldn't
  // resolve the parent (e.g. My-Tasks-fed boards where the parent isn't loaded).
  const parentCaption = parentTitle ?? task.parentTitle ?? null

  return (
    <Link
      to={`/tasks/${task.id}`}
      state={{ backgroundLocation: location }}
      className="group block rounded-lg border border-line bg-card p-3 transition hover:border-line-strong hover:bg-fill-3"
    >
      {isSubtask && parentCaption && (
        <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-faint">
          <span aria-hidden>↳</span>
          <span className="truncate">{parentCaption}</span>
        </div>
      )}

      {hierarchyOn && kind !== 'task' && (
        <div
          className={`mb-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${KIND_STYLES[kind].cls}`}
        >
          {KIND_STYLES[kind].label}
        </div>
      )}

      <div className="line-clamp-2 text-sm font-medium text-fg">{task.title}</div>

      {showDescription && task.description?.trim() && (
        <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">{task.description}</div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 ${priority.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} aria-hidden />
          {priority.label}
        </span>
        {task.workType && (
          <span className="inline-flex items-center rounded-md border border-line bg-fill-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
            {task.workType}
          </span>
        )}
        {task.status === 'in_review' && task.reviewerName && (
          <span
            className="inline-flex items-center rounded-md border border-brand-edge bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand"
            title={`In review by ${task.reviewerName}`}
          >
            🔍 {task.reviewerName.split(' ')[0]}
          </span>
        )}
        {due && (
          <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}>
            {overdue ? '⚠ ' : ''}
            {due}
          </span>
        )}
        {/* Not flag-gated: logged time is data, and the counter costs no reads. */}
        {(task.timeSpentMinutes ?? 0) > 0 && (
          <span
            className="inline-flex items-center gap-1 text-fg-subtle"
            title={`${formatDuration(task.timeSpentMinutes)} logged`}
          >
            <Clock size={11} aria-hidden />
            {formatDuration(task.timeSpentMinutes)}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        {assignee ? (
          <div className="flex items-center gap-1.5 text-fg-muted">
            <Avatar user={assignee.user} size={18} />
            <span className="truncate">
              {assignee.user.displayName}
              {assignee.implicit && (
                <span className="ml-1 text-fg-subtle">· Lead</span>
              )}
            </span>
          </div>
        ) : (
          <span className="text-fg-faint">Unassigned</span>
        )}
        {!isSubtask && (task.subtaskCount ?? 0) > 0 && (
          <span className="text-fg-subtle">
            {task.subtaskDoneCount ?? 0}/{task.subtaskCount ?? 0}
          </span>
        )}
      </div>
    </Link>
  )
}