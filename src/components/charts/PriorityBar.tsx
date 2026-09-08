import { useCallback, useMemo } from 'react'
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
import type { Task, TaskPriority } from '../../types/models'
import { isTerminal } from '../../lib/taskStatus'
import type { OnDrillDown } from '../me/types'
import {
  AXIS_STYLE,
  GRID_COLOR,
  LABEL_STYLE,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  TOOLTIP_STYLE,
} from './chartTheme'
import ChartCard from './ChartCard'

const ORDER: TaskPriority[] = ['high', 'medium', 'low']

interface Props {
  tasks: Task[]
  title?: string
  subtitle?: string
  excludeDone?: boolean
  /** Omit for a plain, non-interactive chart (admin dashboard, KPI reports). */
  onSelect?: OnDrillDown
}

export default function PriorityBar({
  tasks,
  title = 'Priority mix',
  subtitle,
  excludeDone = true,
  onSelect,
}: Props) {
  // One pass builds buckets, each owning the exact tasks behind its bar.
  // Empty buckets are deliberately KEPT: ORDER is a fixed three-element list
  // and the three category ticks have always been on the axis even at zero.
  //
  // That means the render index recharts passes to Bar.onClick canNOT be used
  // to index these buckets: recharts drops zero-dimension rectangles from the
  // array it enumerates (Bar.js "Filter out 0-dimension rectangles early",
  // then .filter(Boolean)) and its own source warns that "the render index
  // parameter is based on the filtered array". With High at zero, a click on
  // Low arrived as index 1 and opened Medium. Read `originalDataIndex` off the
  // datum instead — recharts documents it as the stable pre-filter index.
  const buckets = useMemo(() => {
    const byPriority = new Map<TaskPriority, Task[]>()
    for (const p of ORDER) byPriority.set(p, [])
    for (const t of tasks) {
      // "excludeDone" means "open work only" — cancelled is just as closed.
      if (excludeDone && isTerminal(t.status)) continue
      byPriority.get(t.priority)?.push(t)
    }
    return ORDER.map((p) => ({
      name: PRIORITY_LABEL[p],
      color: PRIORITY_COLOR[p],
      tasks: byPriority.get(p) ?? [],
    }))
  }, [tasks, excludeDone])

  // Lean projection on purpose: recharts spreads every datum field onto the
  // rendered SVG rectangle's props, so a Task[] in here would land in the DOM.
  const data = useMemo(
    () => buckets.map((b) => ({ name: b.name, color: b.color, value: b.tasks.length })),
    [buckets],
  )

  const total = data.reduce((a, d) => a + d.value, 0)

  const select = useCallback(
    (index: number) => {
      const bucket = buckets[index]
      // An empty bucket has no bar to click, but its chip is still rendered.
      if (!onSelect || !bucket || bucket.tasks.length === 0) return
      // Hand over the bucket's OWN array — the panel must never re-derive it.
      onSelect({ title: bucket.name, subtitle, tasks: bucket.tasks, rightSlot: 'due' })
    },
    [buckets, onSelect, subtitle],
  )

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      empty={total === 0}
      // ChartCard is a fixed height + 80px box, so the added chip row would eat
      // plot height; buy the bars those pixels back instead.
      height={onSelect ? 260 : undefined}
    >
      <div className="min-h-0 flex-1">
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
              width={72}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: 'var(--color-fg-muted)' }}
              labelStyle={LABEL_STYLE}
              cursor={{ fill: 'var(--color-fill-2)' }}
            />
            <Bar
              dataKey="value"
              radius={[0, 4, 4, 0]}
              className={onSelect ? 'cursor-pointer' : undefined}
              onClick={onSelect ? (d) => select(d.originalDataIndex) : undefined}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* This chart has no legend of its own; when drillable the chips are the
          keyboard path, since an SVG bar can't be tabbed to. Styled like the
          StatusDonut legend row. */}
      {onSelect && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {data.map((d, i) => (
            <button
              key={d.name}
              type="button"
              disabled={d.value === 0}
              onClick={() => select(i)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded transition hover:text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand-ring disabled:cursor-default disabled:text-fg-faint disabled:hover:text-fg-faint"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: d.color }}
                aria-hidden
              />
              <span>
                {d.name}
                <span className="ml-1 text-fg-subtle">· {d.value}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </ChartCard>
  )
}
