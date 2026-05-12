import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Project, Task } from '../../types/models'
import { aggregateProgress, formatPercent } from '../../lib/progress'
import { isProjectLive } from '../../lib/projectStatus'
import ChartCard from './ChartCard'

interface Props {
  projects: Project[]
  tasks: Task[] // team-level tasks (parentTaskId === null)
  title?: string
  subtitle?: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export default function AtRiskProjects({
  projects,
  tasks,
  title = 'At-risk projects',
  subtitle,
}: Props) {
  const items = useMemo(() => {
    const tasksByProject = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.parentTaskId !== null) continue
      let arr = tasksByProject.get(t.projectId)
      if (!arr) {
        arr = []
        tasksByProject.set(t.projectId, arr)
      }
      arr.push(t)
    }

    const now = Date.now()
    const within = now + WEEK_MS

    return projects
      .filter((p) => isProjectLive(p.status) && p.deadline)
      .map((p) => {
        const deadline = p.deadline!.toDate().getTime()
        const progress = aggregateProgress(tasksByProject.get(p.id) ?? [])
        const daysToDeadline = Math.ceil(
          (deadline - now) / (24 * 60 * 60 * 1000),
        )
        return { project: p, deadline, progress, daysToDeadline }
      })
      .filter(
        (row) =>
          row.deadline <= within && row.progress < 0.8,
      )
      .sort((a, b) => a.deadline - b.deadline)
  }, [projects, tasks])

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? 'Deadline in < 7 days AND progress < 80%'}
      empty={items.length === 0}
      emptyLabel="No projects at risk."
      height={Math.max(200, items.length * 50 + 40)}
    >
      <ul className="space-y-1">
        {items.map(({ project, progress, daysToDeadline }) => (
          <li key={project.id}>
            <Link
              to={`/projects/${project.id}`}
              className="flex items-center gap-3 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-2.5 transition hover:border-tone-warn-bd hover:opacity-90"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">
                  {project.title}
                </div>
                <div className="text-xs text-fg-subtle">
                  {formatPercent(progress)} complete
                </div>
              </div>
              <span
                className={`shrink-0 text-xs ${
                  daysToDeadline < 0 ? 'text-tone-danger-fg' : 'text-tone-warn-fg'
                }`}
              >
                {daysToDeadline < 0
                  ? `${Math.abs(daysToDeadline)}d overdue`
                  : daysToDeadline === 0
                  ? 'Due today'
                  : `${daysToDeadline}d left`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}