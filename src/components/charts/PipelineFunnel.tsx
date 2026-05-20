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
import ChartCard from './ChartCard'
import { ITEM_STYLE, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import { stageTone } from '../workflow/stageStyle'
import { isProjectClosed } from '../../lib/projectStatus'
import type { Project } from '../../types/models'
import type { Workflow } from '../../types/workflow'

interface Props {
  projects: Project[]
  // Phase 2b: the workflow this funnel renders. Parent (AdminDashboard) picks
  // one per tab and passes the projects filtered to that workflow's bucket.
  workflow: Workflow
}

// Funnel by workflow stage. Iterates `workflow.stages` in order, counts
// projects bucketed by `currentStageId`, dropping terminal stages from the
// x-axis (closed projects roll into the last non-terminal bucket so total
// throughput stays accurate). The caller is responsible for narrowing
// `projects` to those on this workflow before rendering.
export default function PipelineFunnel({ projects, workflow }: Props) {
  const data = useMemo(() => {
    const ordered = [...workflow.stages].sort((a, b) => a.order - b.order)
    const lastNonTerminal = [...ordered].reverse().find((s) => !s.isTerminal) ?? ordered[ordered.length - 1]
    const terminalIds = new Set(ordered.filter((s) => s.isTerminal).map((s) => s.id))
    // Pre-filter to projects on THIS workflow so callers can hand us the full
    // accessible list without having to slice it themselves.
    const scoped = projects.filter((p) => p.workflowId === workflow.id)
    return ordered
      .filter((s) => !s.isTerminal)
      .map((stage) => {
        const order = stage.order
        const matching = scoped.filter((p) => {
          // Bucket closed-by-status OR landed-in-terminal-stage projects into
          // the last non-terminal bucket. Either signal counts as "finished"
          // for funnel purposes — they shouldn't disappear from totals.
          if (isProjectClosed(p.status) || (p.currentStageId && terminalIds.has(p.currentStageId))) {
            return stage.id === lastNonTerminal.id
          }
          return p.currentStageId === stage.id
        })
        return {
          // X-axis tick — short label when authored, fall back to display name.
          phase: stage.shortDisplayName ?? stage.displayName,
          // Tooltip header + legend chip text — always the full display name.
          label: stage.displayName,
          count: matching.length,
          order,
          fill: tonePillToHex(order, stage.isTerminal),
          isTerminal: stage.isTerminal,
        }
      })
  }, [projects, workflow])

  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <ChartCard
      title="Pipeline"
      subtitle="Projects by stage — find the bottleneck"
      empty={total === 0}
      emptyLabel="No projects yet"
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 28 }}>
          <CartesianGrid stroke="var(--color-line-subtle)" vertical={false} />
          <XAxis
            dataKey="phase"
            stroke="var(--color-fg-subtle)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval={0}
            // Tilt labels so 6-8 stages don't collide even if a tenant
            // authored a longer shortDisplayName.
            angle={-30}
            textAnchor="end"
            height={48}
          />
          <YAxis
            stroke="var(--color-fg-subtle)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-line-subtle)' }}
            contentStyle={TOOLTIP_STYLE}
            itemStyle={ITEM_STYLE}
            labelStyle={LABEL_STYLE}
            separator=""
            formatter={(v) => {
              const n = Number(v ?? 0)
              return [`${n} project${n === 1 ? '' : 's'}`, '']
            }}
            labelFormatter={(_label, payload) => {
              const item = payload?.[0]?.payload as (typeof data)[number] | undefined
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
        {data.map((d) => {
          const tone = stageTone(d.order, d.isTerminal)
          return (
            <span
              key={d.phase}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${tone.pill}`}
            >
              <span className={`h-1 w-1 rounded-full ${tone.dot}`} />
              {d.label}
            </span>
          )
        })}
      </div>
    </ChartCard>
  )
}

// Recharts wants a hex/var for `fill`. Map the tone palette index to a CSS var
// referenced by index.css. Mirrors the original COLOR_BY_STAGE table but keyed
// by order.
const TONE_VAR: Record<number, string> = {
  0: 'var(--color-warn-dot)',
  1: 'var(--color-info-dot)',
  2: 'var(--color-cool-dot)',
  3: 'var(--color-brandtone-dot)',
  4: 'var(--color-accent-dot)',
  5: 'var(--color-success-dot)',
}

function tonePillToHex(order: number, isTerminal: boolean): string {
  if (isTerminal) return 'var(--color-success-dot)'
  return TONE_VAR[((order - 1) % 6 + 6) % 6]
}
