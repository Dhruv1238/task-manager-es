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
import type { Task, Team } from '../../types/models'
import { bucketForActiveSet, useTaskStatuses } from '../../lib/taskStatus'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, STATUS_COLOR, STATUS_LABEL, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

interface Props {
  teams: Team[]
  tasksByTeam: Map<string, Task[]>
  title?: string
  subtitle?: string
}

export default function PerTeamProgress({
  teams,
  tasksByTeam,
  title = 'Per-team progress',
  subtitle,
}: Props) {
  // Row keys, <Bar> dataKeys, and the rounded-cap index all derive from the
  // active set — a dataKey the rows don't carry renders silently as zero-height.
  const { statuses, techOn } = useTaskStatuses()
  const data = useMemo(
    () =>
      teams.map((team) => {
        const list = tasksByTeam.get(team.id) ?? []
        const row: Record<string, number | string> = { name: team.name }
        for (const s of statuses) row[s] = 0
        for (const t of list) {
          // Fold flag-inactive statuses into their active column so no task vanishes.
          const bucket = bucketForActiveSet(t.status, techOn)
          row[bucket] = ((row[bucket] as number) ?? 0) + 1
        }
        return row
      }),
    [teams, tasksByTeam, statuses, techOn],
  )

  const empty = teams.length === 0

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? 'Team-level tasks by status'}
      empty={empty}
      height={Math.max(180, teams.length * 40 + 60)}
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
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'var(--color-fg-muted)' }}
            iconType="circle"
          />
          {statuses.map((s, idx) => (
            <Bar
              key={s}
              dataKey={s}
              name={STATUS_LABEL[s]}
              stackId="status"
              fill={STATUS_COLOR[s]}
              radius={idx === statuses.length - 1 ? [0, 4, 4, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}