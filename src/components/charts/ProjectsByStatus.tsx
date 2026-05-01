import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { Project, ProjectStatus } from '../../types/models'
import { LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import { STATUS_DISPLAY, STATUS_OPTIONS } from '../../lib/projectStatus'
import ChartCard from './ChartCard'

// Hex colors aligned with the pill tones in projectStatus.ts.
const COLOR: Record<ProjectStatus, string> = {
  in_progress: 'rgba(255,255,255,0.45)',
  submitted: '#60A5FA',
  not_submitted: 'rgba(255,255,255,0.35)',
  awarded: '#34D399',
  lost: '#F87171',
  on_hold: '#FBBF24',
}

interface Props {
  projects: Project[]
  title?: string
  subtitle?: string
}

export default function ProjectsByStatus({
  projects,
  title = 'Projects by status',
  subtitle,
}: Props) {
  const data = useMemo(() => {
    const counts = new Map<ProjectStatus, number>()
    for (const s of STATUS_OPTIONS) counts.set(s, 0)
    for (const p of projects) counts.set(p.status, (counts.get(p.status) ?? 0) + 1)
    return STATUS_OPTIONS.map((s) => ({
      name: STATUS_DISPLAY[s].label,
      value: counts.get(s) ?? 0,
      color: COLOR[s],
    })).filter((d) => d.value > 0)
  }, [projects])

  const total = data.reduce((a, d) => a + d.value, 0)

  return (
    <ChartCard title={title} subtitle={subtitle} empty={total === 0}>
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
              itemStyle={{ color: 'rgba(255, 255, 255, 0.8)' }}
              labelStyle={LABEL_STYLE}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/60">
        {data.map((d) => (
          <span key={d.name} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: d.color }}
              aria-hidden
            />
            <span>
              {d.name}
              <span className="ml-1 text-white/40">· {d.value}</span>
            </span>
          </span>
        ))}
      </div>
    </ChartCard>
  )
}
