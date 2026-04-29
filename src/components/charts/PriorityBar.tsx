import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Task, TaskPriority } from '../../types/models'
import {
  AXIS_STYLE,
  GRID_COLOR,
  LABEL_STYLE,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  TOOLTIP_STYLE,
} from './chartTheme'
import ChartCard from './ChartCard'

const ORDER: TaskPriority[] = ['high', 'medium', 'low']

interface Props {
  tasks: Task[]
  title?: string
  subtitle?: string
  excludeDone?: boolean
}

export default function PriorityBar({
  tasks,
  title = 'Priority mix',
  subtitle,
  excludeDone = true,
}: Props) {
  const data = useMemo(() => {
    const counts = new Map<TaskPriority, number>()
    for (const p of ORDER) counts.set(p, 0)
    for (const t of tasks) {
      if (excludeDone && t.status === 'done') continue
      counts.set(t.priority, (counts.get(t.priority) ?? 0) + 1)
    }
    return ORDER.map((p) => ({
      name: PRIORITY_LABEL[p],
      value: counts.get(p) ?? 0,
      color: PRIORITY_COLOR[p],
    }))
  }, [tasks, excludeDone])

  const total = data.reduce((a, d) => a + d.value, 0)

  return (
    <ChartCard title={title} subtitle={subtitle} empty={total === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
        >
          <CartesianGrid stroke={GRID_COLOR} horizontal={false} />
          <XAxis type="number" tick={AXIS_STYLE} stroke={GRID_COLOR} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS_STYLE}
            stroke={GRID_COLOR}
            width={72}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'rgba(255, 255, 255, 0.8)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}