import TaskCard from './TaskCard'
import { TASK_STATUS_META, bucketForActiveSet, useTaskStatuses } from '../../lib/taskStatus'
import type { Task, TaskStatus, Team, User } from '../../types/models'

interface Props {
  tasks: Task[]
  users: Map<string, User>
  teams: Map<string, Team>
  tasksById?: Map<string, Task>
}

export default function TaskBoard({ tasks, users, teams, tasksById }: Props) {
  const { statuses, techOn } = useTaskStatuses()
  const byStatus = new Map<TaskStatus, Task[]>()
  for (const status of statuses) byStatus.set(status, [])
  for (const t of tasks) {
    // Fold statuses outside the active set into their legacy column so a
    // tech-status task is never silently dropped while the flag is off.
    const bucket = byStatus.get(bucketForActiveSet(t.status, techOn))
    if (bucket) bucket.push(t)
  }

  return (
    <div className="scrollbar-themed flex gap-4 overflow-x-auto pb-3">
      {statuses.map((status) => {
        const meta = TASK_STATUS_META[status]
        const items = byStatus.get(status) ?? []
        return (
          <div
            key={status}
            className="flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-card"
          >
            <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} aria-hidden />
                <span className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {meta.label}
                </span>
              </div>
              <span className="text-xs text-fg-subtle">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <div className="rounded-md border border-dashed border-line p-4 text-center text-xs text-fg-faint">
                  Empty
                </div>
              ) : (
                items.map((t) => {
                  const parentTitle = t.parentTaskId
                    ? tasksById?.get(t.parentTaskId)?.title ?? null
                    : null
                  return (
                    <TaskCard
                      key={t.id}
                      task={t}
                      users={users}
                      teams={teams}
                      parentTitle={parentTitle}
                    />
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}