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
import type { Task, TaskStatus, Team, User } from '../../types/models'
import { getEffectiveAssignee } from '../../lib/effectiveAssignee'
import { bucketForActiveSet, isTerminal, useTaskStatuses } from '../../lib/taskStatus'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, STATUS_COLOR, STATUS_LABEL, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

interface Props {
  tasks: Task[]
  users: Map<string, User>
  teams: Map<string, Team>
  title?: string
  subtitle?: string
  memberUids?: string[] // if provided, show these members even if they have 0 tasks
}

export default function MemberWorkload({
  tasks,
  users,
  teams,
  title = 'Member workload',
  subtitle,
  memberUids,
}: Props) {
  const { statuses, techOn } = useTaskStatuses()
  // The row keys below, the <Bar> dataKeys, and the rounded-cap index must all
  // derive from THIS array — a dataKey the rows don't carry renders zero-height
  // segments with no error.
  const openStatuses = useMemo(() => statuses.filter((s) => !isTerminal(s)), [statuses])

  const data = useMemo(() => {
    const perUser = new Map<string, Partial<Record<TaskStatus, number>> & { name: string; total: number }>()

    function ensure(uid: string) {
      if (!perUser.has(uid)) {
        const u = users.get(uid)
        perUser.set(uid, { name: u?.displayName ?? '—', total: 0 })
      }
      return perUser.get(uid)!
    }

    if (memberUids) for (const uid of memberUids) ensure(uid)

    for (const t of tasks) {
      // Fold flag-inactive statuses into their active column so no task vanishes.
      const status = bucketForActiveSet(t.status, techOn)
      if (!openStatuses.includes(status)) continue
      const assignee = getEffectiveAssignee(t, users, teams)
      if (!assignee) continue
      const bucket = ensure(assignee.user.uid)
      bucket[status] = (bucket[status] ?? 0) + 1
      bucket.total += 1
    }

    return Array.from(perUser.values())
      .sort((a, b) => b.total - a.total)
      .map((row) => {
        const out: Partial<Record<TaskStatus, number>> & { name: string; total: number } = {
          name: row.name,
          total: row.total,
        }
        for (const s of openStatuses) out[s] = row[s] ?? 0
        return out
      })
  }, [tasks, users, teams, memberUids, openStatuses, techOn])

  const empty = data.length === 0 || data.every((d) => d.total === 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? 'Open tasks per member, by status'}
      empty={empty}
      height={Math.max(180, data.length * 40 + 60)}
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
          {openStatuses.map((s, idx) => (
            <Bar
              key={s}
              dataKey={s}
              name={STATUS_LABEL[s]}
              stackId="workload"
              fill={STATUS_COLOR[s]}
              radius={idx === openStatuses.length - 1 ? [0, 4, 4, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}