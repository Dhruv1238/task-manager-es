import TaskCard from './TaskCard'
import type { Task, TaskStatus, Team, User } from '../../types/models'

interface Props {
  tasks: Task[]
  users: Map<string, User>
  teams: Map<string, Team>
  tasksById?: Map<string, Task>
}

const COLUMNS: { status: TaskStatus; label: string; dotCls: string }[] = [
  { status: 'todo', label: 'Todo', dotCls: 'bg-white/40' },
  { status: 'in_progress', label: 'In Progress', dotCls: 'bg-blue-400' },
  { status: 'in_review', label: 'In Review', dotCls: 'bg-purple-400' },
  { status: 'done', label: 'Done', dotCls: 'bg-emerald-400' },
  { status: 'blocked', label: 'Blocked', dotCls: 'bg-red-400' },
]

export default function TaskBoard({ tasks, users, teams, tasksById }: Props) {
  const byStatus = new Map<TaskStatus, Task[]>()
  for (const col of COLUMNS) byStatus.set(col.status, [])
  for (const t of tasks) {
    const bucket = byStatus.get(t.status)
    if (bucket) bucket.push(t)
  }

  return (
    <div className="scrollbar-dark flex gap-4 overflow-x-auto pb-3">
      {COLUMNS.map((col) => {
        const items = byStatus.get(col.status) ?? []
        return (
          <div
            key={col.status}
            className="flex w-72 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/2"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${col.dotCls}`} aria-hidden />
                <span className="text-xs font-medium uppercase tracking-wider text-white/60">
                  {col.label}
                </span>
              </div>
              <span className="text-xs text-white/40">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-xs text-white/30">
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