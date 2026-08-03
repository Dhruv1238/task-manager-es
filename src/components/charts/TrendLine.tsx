import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { XAxisTickContentProps } from 'recharts'
import { usePrintMode } from '../../hooks/usePrintable'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

// Recharts centres every x tick on its data point. These series carry only a
// handful of points, so the outer ones sit hard against the plot edges and
// their centred labels overhang it — the first bleeding into the y-axis
// gutter, the last clipped by the card. Anchoring the end ticks inward keeps
// every label inside the plot without insetting the line itself.
function edgeAlignedTick({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  verticalAnchor,
}: XAxisTickContentProps) {
  const textAnchor =
    index === 0 ? 'start' : index === visibleTicksCount - 1 ? 'end' : 'middle'
  return (
    <Text x={x} y={y} textAnchor={textAnchor} verticalAnchor={verticalAnchor} {...AXIS_STYLE}>
      {String(payload.value)}
    </Text>
  )
}

export interface TrendPoint {
  label: string
  value: number
}

interface Props {
  title: string
  subtitle?: string
  data: TrendPoint[]
  // Format the value as a 0..1 percentage (pins the y-axis to 0..100%).
  percent?: boolean
  valueSuffix?: string
  // Optional dashed baseline reference (e.g. the baseline cohort median).
  reference?: { value: number; label?: string }
}

// Single-series time-series line. No legend (the title names the series); the
// tooltip carries per-point values. Reused by cycle-time, on-time, throughput,
// rework and win-rate.
export default function TrendLine({ title, subtitle, data, percent, valueSuffix, reference }: Props) {
  // Printing resizes the container, which restarts Recharts' 1500ms line
  // transition. The print pass would then capture the line part-way to its new
  // position, so snap straight to the final geometry instead.
  const printing = usePrintMode()
  const fmt = (v: number) =>
    percent ? `${Math.round(v * 100)}%` : `${Math.round(v * 100) / 100}${valueSuffix ?? ''}`
  return (
    <ChartCard title={title} subtitle={subtitle} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={edgeAlignedTick} stroke={GRID_COLOR} />
          <YAxis
            tick={AXIS_STYLE}
            stroke={GRID_COLOR}
            width={44}
            domain={percent ? [0, 1] : [0, 'auto']}
            tickFormatter={(v) => (percent ? `${Math.round(v * 100)}%` : String(v))}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--color-fg-muted)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ stroke: 'var(--color-line-strong)' }}
            formatter={(value) => [fmt(Number(value)), title]}
          />
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke="var(--color-line-strong)"
              strokeDasharray="4 4"
              label={{ value: reference.label, position: 'insideTopRight', fill: 'var(--color-fg-subtle)', fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-brandtone-dot)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--color-brandtone-dot)' }}
            activeDot={{ r: 5, fill: 'var(--color-brand)' }}
            isAnimationActive={!printing}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
