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
import type { Task, TaskStatus, Team } from '../../types/models'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, STATUS_COLOR, STATUS_LABEL, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

const COUNT_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked']

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
  const data = useMemo(
    () =>
      teams.map((team) => {
        const list = tasksByTeam.get(team.id) ?? []
        const row: Record<string, number | string> = { name: team.name }
        for (const s of COUNT_STATUSES) {
          row[s] = list.filter((t) => t.status === s).length
        }
        return row
      }),
    [teams, tasksByTeam],
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
            itemStyle={{ color: 'rgba(255, 255, 255, 0.8)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}
            iconType="circle"
          />
          {COUNT_STATUSES.map((s, idx) => (
            <Bar
              key={s}
              dataKey={s}
              name={STATUS_LABEL[s]}
              stackId="status"
              fill={STATUS_COLOR[s]}
              radius={idx === COUNT_STATUSES.length - 1 ? [0, 4, 4, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}