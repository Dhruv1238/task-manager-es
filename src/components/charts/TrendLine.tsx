import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

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
  const fmt = (v: number) =>
    percent ? `${Math.round(v * 100)}%` : `${Math.round(v * 100) / 100}${valueSuffix ?? ''}`
  return (
    <ChartCard title={title} subtitle={subtitle} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} stroke={GRID_COLOR} />
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
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
