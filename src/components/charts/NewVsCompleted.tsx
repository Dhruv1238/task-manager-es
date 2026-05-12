import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Task } from '../../types/models'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

interface Props {
  tasks: Task[]
  weeks?: number
  title?: string
  subtitle?: string
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay()
  copy.setDate(copy.getDate() - day)
  return copy
}

function formatLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function NewVsCompleted({
  tasks,
  weeks = 6,
  title = 'New vs completed',
  subtitle,
}: Props) {
  const data = useMemo(() => {
    const buckets: { label: string; created: number; completed: number; start: number; end: number }[] = []
    const now = startOfWeek(new Date())
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i * 7)
      const end = new Date(d)
      end.setDate(end.getDate() + 7)
      buckets.push({
        label: formatLabel(d),
        created: 0,
        completed: 0,
        start: d.getTime(),
        end: end.getTime(),
      })
    }

    for (const t of tasks) {
      if (t.createdAt) {
        const ms = t.createdAt.toDate().getTime()
        for (const b of buckets) if (ms >= b.start && ms < b.end) b.created += 1
      }
      if (t.completedAt) {
        const ms = t.completedAt.toDate().getTime()
        for (const b of buckets) if (ms >= b.start && ms < b.end) b.completed += 1
      }
    }

    return buckets
  }, [tasks, weeks])

  const empty = data.every((b) => b.created === 0 && b.completed === 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? `Last ${weeks} weeks`}
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} stroke={GRID_COLOR} />
          <YAxis tick={AXIS_STYLE} stroke={GRID_COLOR} allowDecimals={false} width={32} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--color-fg-muted)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ fill: 'var(--color-fill-2)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'var(--color-fg-muted)' }}
            iconType="circle"
          />
          <Bar dataKey="created" name="Created" fill="var(--color-info-dot)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="completed" name="Completed" fill="var(--color-success-dot)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}