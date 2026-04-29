import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Task } from '../../types/models'
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
        if (t.status === 'done') return false
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

  const location = useLocation()

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
          const overdue = when.getTime() < Date.now()
          const dayLabel = when.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })
          return (
            <li key={t.id}>
              <Link
                to={`/tasks/${t.id}`}
                state={{ backgroundLocation: location }}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/3"
              >
                <span
                  className={`inline-block h-8 w-1 shrink-0 rounded-full ${overdue ? 'bg-red-400' : 'bg-purple-400'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{t.title}</div>
                  <div className="truncate text-xs text-white/40">
                    {t.projectTitle} · {t.teamName}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-xs ${overdue ? 'text-red-300' : 'text-white/60'}`}
                >
                  {overdue ? 'Overdue · ' : ''}
                  {dayLabel}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}