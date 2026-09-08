import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Task } from '../../types/models'
import TaskStatusPill from './TaskStatusPill'

interface Props {
  task: Task
  /** Right slot: a due date, a priority label, "Review →" — the caller's call. */
  right?: ReactNode
  /** Leading slot; defaults to the task's status pill. Pass null for none. */
  leading?: ReactNode
  /** Extra subtitle detail after `project · team` — e.g. "from Sneha". */
  meta?: ReactNode
  className?: string
}

/**
 * The flat task row for lists that are already grouped or filtered elsewhere
 * (deadlines, drill-down panels, review queues).
 *
 * The title link and the project link are SIBLINGS, never nested, and the row
 * itself is not a link: wrapping the whole row in one <Link> (what the
 * hand-rolled rows did) makes the project name unclickable, because a nested
 * <a> is invalid HTML and the browser drops it. That is the whole point of
 * this component.
 *
 * The whole row is still one click target, though. The title link carries a
 * stretched ::after that covers the row, so the right slot ("Review →", a due
 * date) and the dead space around it activate the task just as they did when
 * the row WAS one link — the project link simply sits above that overlay.
 */
export default function TaskListRow({
  task,
  right,
  leading = <TaskStatusPill status={task.status} />,
  meta,
  className = '',
}: Props) {
  const location = useLocation()
  // Carry the ORIGINAL background forward instead of the raw location: these
  // rows also render inside the drill-down panel, which stays mounted while a
  // task modal sits on top. Capturing the current location there would pin
  // /tasks/:id as the background and swap the page out from under the panel.
  // Same idiom as TaskDetailContent / LinkedTasksSection.
  const backgroundLocation =
    (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation ??
    location

  return (
    <li
      className={`relative flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-fill-1 ${className}`}
    >
      {leading}
      <div className="min-w-0 flex-1">
        {/* backgroundLocation is what makes the task open as a modal stacked
          * over whatever page we're on instead of navigating away (App.tsx). */}
        <Link
          to={`/tasks/${task.id}`}
          state={{ backgroundLocation }}
          className="block truncate text-sm text-fg transition after:absolute after:inset-0 after:content-[''] hover:text-fg-strong"
        >
          {task.title}
        </Link>
        <div className="truncate text-xs text-fg-subtle">
          {/* projectId is always set; only the denormalized title can be
            * missing, so the link stays live even when it reads as a dash. */}
          {/* relative + z-10 lifts this above the title's stretched overlay so
            * the project stays independently clickable. */}
          <Link
            to={`/projects/${task.projectId}`}
            className="relative z-10 transition hover:text-fg-muted hover:underline"
          >
            {task.projectTitle ?? '—'}
          </Link>
          {' · '}
          {task.teamName ?? '—'}
          {meta && (
            <>
              <span className="mx-1 text-fg-faint">·</span>
              {meta}
            </>
          )}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </li>
  )
}
