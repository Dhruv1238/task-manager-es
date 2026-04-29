import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
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
  const day = copy.getDay() // 0 = Sunday
  copy.setDate(copy.getDate() - day)
  return copy
}

function formatLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function WeeklyCompletionLine({
  tasks,
  weeks = 8,
  title = 'Weekly completion',
  subtitle,
}: Props) {
  const data = useMemo(() => {
    const buckets: { key: string; label: string; count: number; start: number }[] = []
    const now = startOfWeek(new Date())
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i * 7)
      buckets.push({
        key: d.toISOString(),
        label: formatLabel(d),
        count: 0,
        start: d.getTime(),
      })
    }
    const end = new Date(now)
    end.setDate(end.getDate() + 7)
    const endMs = end.getTime()

    for (const t of tasks) {
      const completedAt = t.completedAt
      if (!completedAt) continue
      const ms = completedAt.toDate().getTime()
      const firstStart = buckets[0].start
      if (ms < firstStart || ms >= endMs) continue
      // find bucket
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (ms >= buckets[i].start) {
          buckets[i].count += 1
          break
        }
      }
    }
    return buckets
  }, [tasks, weeks])

  const total = data.reduce((a, d) => a + d.count, 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? `Last ${weeks} weeks`}
      empty={total === 0}
      emptyLabel="No completions in the window."
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} stroke={GRID_COLOR} />
          <YAxis tick={AXIS_STYLE} stroke={GRID_COLOR} allowDecimals={false} width={32} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'rgba(255, 255, 255, 0.8)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ stroke: 'rgba(255,255,255,0.15)' }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#c084fc"
            strokeWidth={2}
            dot={{ r: 3, fill: '#c084fc' }}
            activeDot={{ r: 5, fill: '#d8b4fe' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}