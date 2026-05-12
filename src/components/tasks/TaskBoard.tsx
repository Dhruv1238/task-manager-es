import TaskCard from './TaskCard'
import type { Task, TaskStatus, Team, User } from '../../types/models'

interface Props {
  tasks: Task[]
  users: Map<string, User>
  teams: Map<string, Team>
  tasksById?: Map<string, Task>
}

const COLUMNS: { status: TaskStatus; label: string; dotCls: string }[] = [
  { status: 'todo', label: 'Todo', dotCls: 'bg-neutral-dot' },
  { status: 'in_progress', label: 'In Progress', dotCls: 'bg-info-dot' },
  { status: 'in_review', label: 'In Review', dotCls: 'bg-brandtone-dot' },
  { status: 'done', label: 'Done', dotCls: 'bg-success-dot' },
  { status: 'blocked', label: 'Blocked', dotCls: 'bg-danger-dot' },
]

export default function TaskBoard({ tasks, users, teams, tasksById }: Props) {
  const byStatus = new Map<TaskStatus, Task[]>()
  for (const col of COLUMNS) byStatus.set(col.status, [])
  for (const t of tasks) {
    const bucket = byStatus.get(t.status)
    if (bucket) bucket.push(t)
  }

  return (
    <div className="scrollbar-themed flex gap-4 overflow-x-auto pb-3">
      {COLUMNS.map((col) => {
        const items = byStatus.get(col.status) ?? []
        return (
          <div
            key={col.status}
            className="flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-card"
          >
            <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${col.dotCls}`} aria-hidden />
                <span className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {col.label}
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