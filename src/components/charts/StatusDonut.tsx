import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { Task, TaskStatus } from '../../types/models'
import { LABEL_STYLE, STATUS_COLOR, STATUS_LABEL, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

const ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked']

interface Props {
  tasks: Task[]
  title?: string
  subtitle?: string
  excludeDone?: boolean
}

export default function StatusDonut({
  tasks,
  title = 'Status breakdown',
  subtitle,
  excludeDone = false,
}: Props) {
  const data = useMemo(() => {
    const counts = new Map<TaskStatus, number>()
    for (const s of ORDER) counts.set(s, 0)
    for (const t of tasks) {
      if (excludeDone && t.status === 'done') continue
      counts.set(t.status, (counts.get(t.status) ?? 0) + 1)
    }
    return ORDER.map((s) => ({
      name: STATUS_LABEL[s],
      value: counts.get(s) ?? 0,
      color: STATUS_COLOR[s],
    })).filter((d) => d.value > 0)
  }, [tasks, excludeDone])

  const total = data.reduce((acc, d) => acc + d.value, 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      empty={total === 0}
      emptyLabel="No tasks to chart."
    >
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="85%"
              strokeWidth={0}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: 'var(--color-fg-muted)' }}
              labelStyle={LABEL_STYLE}
              cursor={{ fill: 'var(--color-fill-2)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
        {data.map((d) => (
          <span key={d.name} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: d.color }}
              aria-hidden
            />
            <span>
              {d.name}
              <span className="ml-1 text-fg-subtle">· {d.value}</span>
            </span>
          </span>
        ))}
      </div>
    </ChartCard>
  )
}