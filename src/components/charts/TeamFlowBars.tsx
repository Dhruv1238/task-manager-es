import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

export interface TeamFlowDatum {
  teamId: string
  teamName: string
  efficiency: number // 0..1
}

interface Props {
  data: TeamFlowDatum[]
  title?: string
  subtitle?: string
}

// Flow efficiency compared across teams → sorted horizontal bars (magnitude by
// identity). Bars beat rings here because rings can't be compared across many.
export default function TeamFlowBars({ data, title = 'Team flow efficiency', subtitle }: Props) {
  const height = Math.max(160, data.length * 40)
  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? 'Hands-on stage time ÷ total elapsed (excl. on-hold), per attached team'}
      empty={data.length === 0}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
        >
          <CartesianGrid stroke={GRID_COLOR} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 1]}
            tick={AXIS_STYLE}
            stroke={GRID_COLOR}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
          />
          <YAxis
            type="category"
            dataKey="teamName"
            tick={AXIS_STYLE}
            stroke={GRID_COLOR}
            width={120}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--color-fg-muted)' }}
            labelStyle={LABEL_STYLE}
            cursor={{ fill: 'var(--color-line-subtle)' }}
            formatter={(value) => [`${Math.round(Number(value) * 100)}%`, 'Efficiency']}
          />
          <Bar
            dataKey="efficiency"
            fill="var(--color-brandtone-dot)"
            radius={[0, 4, 4, 0]}
            barSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
