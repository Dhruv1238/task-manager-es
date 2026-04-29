import { Link, useLocation } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import { getEffectiveAssignee } from '../../lib/effectiveAssignee'
import type { Task, TaskPriority, Team, User } from '../../types/models'

interface Props {
  task: Task
  users: Map<string, User>
  teams: Map<string, Team>
  parentTitle?: string | null
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string; dot: string }> = {
  low: { label: 'Low', cls: 'text-white/50', dot: 'bg-white/40' },
  medium: { label: 'Medium', cls: 'text-amber-300', dot: 'bg-amber-400' },
  high: { label: 'High', cls: 'text-red-300', dot: 'bg-red-400' },
}

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 18 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white"
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
  const assignee = getEffectiveAssignee(task, users, teams)
  const priority = PRIORITY_STYLES[task.priority]
  const due = formatShortDate(task.dueDate)
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    task.dueDate.toDate().getTime() < Date.now()
  const isSubtask = Boolean(task.parentTaskId)

  return (
    <Link
      to={`/tasks/${task.id}`}
      state={{ backgroundLocation: location }}
      className="group block rounded-lg border border-white/10 bg-white/3 p-3 transition hover:border-white/20 hover:bg-white/6"
    >
      {isSubtask && parentTitle && (
        <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/35">
          <span aria-hidden>↳</span>
          <span className="truncate">{parentTitle}</span>
        </div>
      )}

      <div className="line-clamp-2 text-sm font-medium text-white">{task.title}</div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 ${priority.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} aria-hidden />
          {priority.label}
        </span>
        {due && (
          <span className={overdue ? 'text-red-300' : 'text-white/40'}>
            {overdue ? '⚠ ' : ''}
            {due}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        {assignee ? (
          <div className="flex items-center gap-1.5 text-white/70">
            <Avatar user={assignee.user} size={18} />
            <span className="truncate">
              {assignee.user.displayName}
              {assignee.implicit && (
                <span className="ml-1 text-white/40">· Lead</span>
              )}
            </span>
          </div>
        ) : (
          <span className="text-white/30">Unassigned</span>
        )}
        {!isSubtask && (task.subtaskCount ?? 0) > 0 && (
          <span className="text-white/40">
            {task.subtaskDoneCount ?? 0}/{task.subtaskCount ?? 0}
          </span>
        )}
      </div>
    </Link>
  )
}