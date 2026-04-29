import TaskCard from './TaskCard'
import type { Task, TaskStatus, Team, User } from '../../types/models'

const COLUMNS: { status: TaskStatus; label: string; dotCls: string }[] = [
  { status: 'todo', label: 'Todo', dotCls: 'bg-white/40' },
  { status: 'in_progress', label: 'In Progress', dotCls: 'bg-blue-400' },
  { status: 'in_review', label: 'In Review', dotCls: 'bg-purple-400' },
  { status: 'done', label: 'Done', dotCls: 'bg-emerald-400' },
  { status: 'blocked', label: 'Blocked', dotCls: 'bg-red-400' },
]

interface SwimlaneSpec {
  key: string
  label: string
  team: Team | null
  tasks: Task[]
}

interface Props {
  tasks: Task[]
  teams: Team[]
  teamsMap: Map<string, Team>
  users: Map<string, User>
  tasksById: Map<string, Task>
  onCreateTask?: (teamId: string) => void
  canCreateForTeam?: (team: Team) => boolean
}

export default function ProjectSwimlaneBoard({
  tasks,
  teams,
  teamsMap,
  users,
  tasksById,
  onCreateTask,
  canCreateForTeam,
}: Props) {
  const lanes: SwimlaneSpec[] = []
  const laneByTeam = new Map<string, SwimlaneSpec>()

  for (const team of teams) {
    const lane: SwimlaneSpec = { key: team.id, label: team.name, team, tasks: [] }
    lanes.push(lane)
    laneByTeam.set(team.id, lane)
  }

  let orphanLane: SwimlaneSpec | null = null
  for (const t of tasks) {
    const lane = laneByTeam.get(t.teamId)
    if (lane) {
      lane.tasks.push(t)
      continue
    }
    if (!orphanLane) {
      orphanLane = {
        key: '__unassigned',
        label: 'Unassigned team',
        team: null,
        tasks: [],
      }
      lanes.push(orphanLane)
    }
    orphanLane.tasks.push(t)
  }

  return (
    <div className="scrollbar-dark overflow-x-auto rounded-2xl border border-white/10 bg-white/2">
      <div className="min-w-240">
        <div
          className="grid border-b border-white/10 bg-white/2"
          style={{ gridTemplateColumns: `minmax(160px, 180px) repeat(${COLUMNS.length}, minmax(220px, 1fr))` }}
        >
          <div className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-white/40">
            Team
          </div>
          {COLUMNS.map((col) => (
            <div
              key={col.status}
              className="flex items-center gap-2 border-l border-white/5 px-3 py-2.5"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${col.dotCls}`} aria-hidden />
              <span className="text-xs font-medium uppercase tracking-wider text-white/60">
                {col.label}
              </span>
            </div>
          ))}
        </div>

        {lanes.length === 0 ? (
          <div className="p-10 text-center text-sm text-white/40">
            No teams on this project yet.
          </div>
        ) : (
          lanes.map((lane, laneIdx) => {
            const byStatus = new Map<TaskStatus, Task[]>()
            for (const col of COLUMNS) byStatus.set(col.status, [])
            for (const t of lane.tasks) {
              const bucket = byStatus.get(t.status)
              if (bucket) bucket.push(t)
            }
            const total = lane.tasks.length

            return (
              <div
                key={lane.key}
                className={`grid ${laneIdx > 0 ? 'border-t border-white/5' : ''}`}
                style={{ gridTemplateColumns: `minmax(160px, 180px) repeat(${COLUMNS.length}, minmax(220px, 1fr))` }}
              >
                <div className="flex flex-col justify-center gap-1 border-r border-white/5 bg-white/1 px-4 py-3">
                  <div className="truncate text-sm font-medium text-white">
                    {lane.label}
                  </div>
                  <div className="text-[11px] text-white/40">
                    {total} task{total === 1 ? '' : 's'}
                  </div>
                  {lane.team && onCreateTask && canCreateForTeam?.(lane.team) && (
                    <button
                      type="button"
                      onClick={() => onCreateTask(lane.team!.id)}
                      className="mt-1 inline-flex items-center justify-center gap-1 rounded-md border border-white/10 bg-white/4 px-2 py-1 text-[11px] font-medium text-white/80 transition hover:bg-white/8 hover:text-white"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      New task
                    </button>
                  )}
                </div>
                {COLUMNS.map((col) => {
                  const items = byStatus.get(col.status) ?? []
                  return (
                    <div
                      key={col.status}
                      className="flex min-h-28 flex-col gap-2 border-l border-white/5 p-2"
                    >
                      {items.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-white/5 p-3 text-[11px] text-white/25">
                          Empty
                        </div>
                      ) : (
                        items.map((t) => {
                          const parentTitle = t.parentTaskId
                            ? tasksById.get(t.parentTaskId)?.title ?? null
                            : null
                          return (
                            <TaskCard
                              key={t.id}
                              task={t}
                              users={users}
                              teams={teamsMap}
                              parentTitle={parentTitle}
                            />
                          )
                        })
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}