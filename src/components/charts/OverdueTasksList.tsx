import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Task } from '../../types/models'
import ChartCard from './ChartCard'

interface Props {
  tasks: Task[]
  title?: string
  subtitle?: string
}

export default function OverdueTasksList({
  tasks,
  title = 'Overdue tasks',
  subtitle,
}: Props) {
  const items = useMemo(() => {
    const now = Date.now()
    return tasks
      .filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          t.dueDate.toDate().getTime() < now,
      )
      .sort(
        (a, b) =>
          (a.dueDate?.toDate().getTime() ?? 0) -
          (b.dueDate?.toDate().getTime() ?? 0),
      )
      .slice(0, 8)
  }, [tasks])

  const location = useLocation()

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? 'Past deadline, not done'}
      empty={items.length === 0}
      emptyLabel="Nothing overdue. Nice."
      height={Math.max(200, items.length * 44 + 40)}
    >
      <ul className="space-y-1">
        {items.map((t) => {
          const when = t.dueDate!.toDate()
          const daysLate = Math.max(
            1,
            Math.ceil((Date.now() - when.getTime()) / (24 * 60 * 60 * 1000)),
          )
          return (
            <li key={t.id}>
              <Link
                to={`/tasks/${t.id}`}
                state={{ backgroundLocation: location }}
                className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 transition hover:border-red-500/40 hover:bg-red-500/10"
              >
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{t.title}</div>
                  <div className="truncate text-xs text-white/40">
                    {t.projectTitle} · {t.teamName}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-red-300">
                  {daysLate}d late
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}