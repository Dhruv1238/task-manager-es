import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts'
import ChartCard from './ChartCard'
import { STAGE_NAMES, STAGE_SHORT_NAMES } from '../../types/models'
import { STAGE_TONE } from '../tender/stageStyle'
import { isProjectClosed } from '../../lib/projectStatus'
import type { Project, Stage } from '../../types/models'

interface Props {
  projects: Project[]
}

const STAGES: Stage[] = [1, 2, 4, 6, 7, 8, 10]

const COLOR_BY_STAGE: Record<Stage, string> = {
  1: '#F59E0B',
  2: '#F59E0B',
  3: '#EF4444',
  4: '#3B82F6',
  6: '#3B82F6',
  7: '#A855F7',
  8: '#6366F1',
  9: '#EF4444',
  10: '#10B981',
}

// Count of projects in each phase. Surfaces where tenders are getting stuck.
export default function TenderPipelineFunnel({ projects }: Props) {
  const data = useMemo(() => {
    return STAGES.map((stage) => ({
      // Short label is the bar's x-axis tick.
      phase: STAGE_SHORT_NAMES[stage],
      // Full label is the tooltip header.
      label: STAGE_NAMES[stage],
      // Count live projects at this phase; closed projects contribute to "Sent"
      // (the shipped bucket) so the funnel reflects total throughput.
      count:
        projects.filter((p) => p.stage === stage && !isProjectClosed(p.status)).length +
        (stage === 10 ? projects.filter((p) => isProjectClosed(p.status)).length : 0),
      fill: COLOR_BY_STAGE[stage],
    }))
  }, [projects])

  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <ChartCard
      title="Tender pipeline"
      subtitle="Projects by phase — find the bottleneck"
      empty={total === 0}
      emptyLabel="No tenders yet"
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="phase"
            stroke="rgba(255,255,255,0.4)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            contentStyle={{
              background: '#0e0e16',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: 'white',
              fontSize: 12,
            }}
            formatter={(v) => {
              const n = Number(v ?? 0)
              return [`${n} project${n === 1 ? '' : 's'}`, '']
            }}
            labelFormatter={(_label, payload) => {
              const item = payload?.[0]?.payload as typeof data[number] | undefined
              return item?.label ?? ''
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.phase} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
        {STAGES.map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${STAGE_TONE[s].pill}`}
          >
            <span className={`h-1 w-1 rounded-full ${STAGE_TONE[s].dot}`} />
            {STAGE_NAMES[s]}
          </span>
        ))}
      </div>
    </ChartCard>
  )
}
