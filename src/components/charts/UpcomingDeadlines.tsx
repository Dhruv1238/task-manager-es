import { useMemo } from 'react'
import type { Task } from '../../types/models'
import { isOverdueTask } from '../../lib/myTasksDerive'
import { isTerminal } from '../../lib/taskStatus'
import TaskListRow from '../tasks/TaskListRow'
import ChartCard from './ChartCard'

interface Props {
  tasks: Task[]
  days?: number
  title?: string
  subtitle?: string
}

export default function UpcomingDeadlines({
  tasks,
  days = 14,
  title = 'Upcoming deadlines',
  subtitle,
}: Props) {
  const items = useMemo(() => {
    const now = Date.now()
    const cutoff = now + days * 24 * 60 * 60 * 1000
    return tasks
      .filter((t) => {
        if (!t.dueDate) return false
        if (isTerminal(t.status)) return false
        const ms = t.dueDate.toDate().getTime()
        return ms >= now - 24 * 60 * 60 * 1000 && ms <= cutoff
      })
      .sort(
        (a, b) =>
          (a.dueDate?.toDate().getTime() ?? 0) -
          (b.dueDate?.toDate().getTime() ?? 0),
      )
      .slice(0, 6)
  }, [tasks, days])

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? `Next ${days} days`}
      empty={items.length === 0}
      emptyLabel="No deadlines coming up."
      height={240}
    >
      <ul className="space-y-1">
        {items.map((t) => {
          const when = t.dueDate!.toDate()
          const overdue = isOverdueTask(t)
          const dayLabel = when.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })
          return (
            <TaskListRow
              key={t.id}
              task={t}
              leading={
                <span
                  className={`inline-block h-8 w-1 shrink-0 rounded-full ${overdue ? 'bg-danger-dot' : 'bg-brandtone-dot'}`}
                  aria-hidden
                />
              }
              right={
                <span
                  className={`text-xs ${overdue ? 'text-tone-danger-fg' : 'text-fg-muted'}`}
                >
                  {overdue ? 'Overdue · ' : ''}
                  {dayLabel}
                </span>
              }
            />
          )
        })}
      </ul>
    </ChartCard>
  )
}