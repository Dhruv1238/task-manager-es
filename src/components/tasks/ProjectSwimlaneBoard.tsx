import TaskCard from './TaskCard'
import { TASK_STATUS_META, bucketForActiveSet, useTaskStatuses } from '../../lib/taskStatus'
import type { Task, TaskStatus, Team, User } from '../../types/models'

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
  const { statuses, techOn } = useTaskStatuses()
  // One shared template so lane rows stay aligned with the header; the 220px
  // per-column floor makes the container scroll horizontally at 9 columns.
  const gridTemplate = `minmax(160px, 180px) repeat(${statuses.length}, minmax(220px, 1fr))`

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
    <div className="scrollbar-themed overflow-x-auto rounded-2xl border border-line bg-card">
      {/* Min width = the grid's intrinsic minimum, so narrow viewports scroll
          instead of clipping the rightmost columns. */}
      <div style={{ minWidth: 160 + statuses.length * 220 }}>
        <div
          className="grid border-b border-line bg-fill-1"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Team
          </div>
          {statuses.map((status) => {
            const meta = TASK_STATUS_META[status]
            return (
              <div
                key={status}
                className="flex items-center gap-2 border-l border-line-subtle px-3 py-2.5"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} aria-hidden />
                <span className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {meta.label}
                </span>
              </div>
            )
          })}
        </div>

        {lanes.length === 0 ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            No teams on this project yet.
          </div>
        ) : (
          lanes.map((lane, laneIdx) => {
            const byStatus = new Map<TaskStatus, Task[]>()
            for (const status of statuses) byStatus.set(status, [])
            for (const t of lane.tasks) {
              // Fold statuses outside the active set into their legacy column
              // so a tech-status task is never silently dropped flag-off.
              const bucket = byStatus.get(bucketForActiveSet(t.status, techOn))
              if (bucket) bucket.push(t)
            }
            const total = lane.tasks.length

            return (
              <div
                key={lane.key}
                className={`grid ${laneIdx > 0 ? 'border-t border-line-subtle' : ''}`}
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="flex flex-col justify-center gap-1 border-r border-line-subtle bg-fill-1 px-4 py-3">
                  <div className="truncate text-sm font-medium text-fg">
                    {lane.label}
                  </div>
                  <div className="text-[11px] text-fg-subtle">
                    {total} task{total === 1 ? '' : 's'}
                  </div>
                  {lane.team && onCreateTask && canCreateForTeam?.(lane.team) && (
                    <button
                      type="button"
                      onClick={() => onCreateTask(lane.team!.id)}
                      className="mt-1 inline-flex items-center justify-center gap-1 rounded-md border border-line bg-fill-2 px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      New task
                    </button>
                  )}
                </div>
                {statuses.map((status) => {
                  const items = byStatus.get(status) ?? []
                  return (
                    <div
                      key={status}
                      className="flex min-h-28 flex-col gap-2 border-l border-line-subtle p-2"
                    >
                      {items.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-line-subtle p-3 text-[11px] text-fg-faint">
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