import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Task, Team } from '../../types/models'
import { isTerminal } from '../../lib/taskStatus'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

interface Props {
  teams: Team[]
  tasks: Task[]
  title?: string
  subtitle?: string
}

export default function TeamUtilization({
  teams,
  tasks,
  title = 'Team utilization',
  subtitle,
}: Props) {
  const data = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (isTerminal(t.status)) continue
      counts.set(t.teamId, (counts.get(t.teamId) ?? 0) + 1)
    }
    return teams
      .map((team) => ({ name: team.name, open: counts.get(team.id) ?? 0 }))
      .sort((a, b) => b.open - a.open)
  }, [teams, tasks])

  const total = data.reduce((a, d) => a + d.open, 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? 'Open tasks per team'}
      empty={total === 0}
      height={Math.max(200, teams.length * 36 + 60)}
    >
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
            width={120}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--color-fg-muted)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ fill: 'var(--color-fill-2)' }}
          />
          <Bar dataKey="open" fill="var(--color-brandtone-dot)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}