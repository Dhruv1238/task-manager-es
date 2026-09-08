import { Link, useLocation } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import type { Task, TaskPriority } from '../../types/models'
import { isOverdueTask, type ProjectBucket } from '../../lib/myTasksDerive'
import { subtaskRatio } from '../../lib/progress'
import TaskStatusPill from '../tasks/TaskStatusPill'

// Literal class strings per priority — never interpolate a Tailwind class
// (src/lib/taskStatus.ts:21). Deliberately duplicated in TaskDrillDownPanel:
// react-refresh/only-export-components forbids exporting a non-component from
// a .tsx, and a two-entry style map is not worth a module in src/lib.
const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-fg-subtle' },
  medium: { label: 'Medium', cls: 'text-tone-warn-fg' },
  high: { label: 'High', cls: 'text-tone-danger-fg' },
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function TaskRow({ task, showSubtaskProgress = false }: { task: Task; showSubtaskProgress?: boolean }) {
  const location = useLocation()
  // Carry the ORIGINAL background forward instead of the raw location: these
  // rows also render inside the drill-down panel, which stays mounted while a
  // task modal sits on top. Capturing the current location there would pin
  // /tasks/:id as the background and swap the page out from under the panel.
  // Same idiom as TaskDetailContent / LinkedTasksSection.
  const backgroundLocation =
    (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation ??
    location
  // Overdue lives in lib/myTasksDerive so this row and MyTasksView's "Overdue"
  // tile can never disagree on what overdue means (terminal is never overdue).
  const overdue = isOverdueTask(task)
  const priority = PRIORITY_STYLES[task.priority]
  const ratio = subtaskRatio(task)

  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <Link
        to={`/tasks/${task.id}`}
        state={{ backgroundLocation }}
        className="flex items-center gap-3 px-5 py-3 transition hover:bg-fill-1"
      >
        <TaskStatusPill status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">{task.title}</div>
          {task.description && (
            <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">
              {task.description}
            </div>
          )}
        </div>
        <div className="hidden items-center gap-4 text-xs text-fg-subtle sm:flex">
          <span className={`font-medium ${priority.cls}`}>{priority.label}</span>
          <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}>
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.dueDate)}
          </span>
          {showSubtaskProgress && (
            <span className="text-fg-subtle">
              {ratio.done}/{ratio.total}
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}

/**
 * The project → team → task list behind "Assigned to me" and "Led by me".
 *
 * Grouping happens upstream (groupByProjectTeam in lib/myTasksDerive.ts) so
 * this stays a pure renderer of an already-shaped bucket list.
 */
export default function GroupedTaskList({
  grouped,
  showSubtaskProgress,
}: {
  grouped: ProjectBucket[]
  showSubtaskProgress?: boolean
}) {
  return (
    <div className="space-y-6">
      {grouped.map((proj) => (
        <section key={proj.projectId}>
          <Link
            to={`/projects/${proj.projectId}`}
            className="group inline-flex items-center gap-2 text-sm text-fg-subtle transition hover:text-fg-muted"
          >
            <span className="text-xs uppercase tracking-wider text-fg-subtle">Project</span>
            <span className="font-medium text-fg-strong group-hover:text-fg">
              {proj.projectTitle}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fg-faint"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>

          <div className="mt-3 space-y-4">
            {Array.from(proj.teams.values()).map((team) => (
              <div
                key={team.teamId}
                className="overflow-hidden rounded-2xl border border-line bg-card"
              >
                <div className="flex items-center justify-between border-b border-line-subtle px-5 py-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                    {team.teamName}
                  </span>
                  <Link
                    to={`/projects/${proj.projectId}/teams/${team.teamId}`}
                    className="text-xs text-brand transition hover:text-brand"
                  >
                    Open workspace →
                  </Link>
                </div>
                <ul>
                  {team.tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      showSubtaskProgress={showSubtaskProgress}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
