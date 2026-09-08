import { useCallback, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Task } from '../../types/models'
import { tasksByProject } from '../../lib/myTasksDerive'
import type { OnDrillDown } from '../me/types'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

// ONE fill for every bar. This dimension is projects, not statuses: a project
// has no tone of its own, so per-bar colours would imply a meaning that isn't
// there (and would collide with the status/priority palettes elsewhere on the
// page). Length is the only encoding.
const BAR_FILL = 'var(--color-brandtone-dot)'

// The YAxis band is a fixed 120px, so long project titles would be clipped
// mid-word by the SVG. Truncate with an ellipsis instead; the tooltip and the
// drill-down panel both still show the full title.
const TICK_MAX = 18

function truncateTick(label: string): string {
  return label.length > TICK_MAX ? `${label.slice(0, TICK_MAX - 1)}…` : label
}

interface Props {
  tasks: Task[]
  title?: string
  subtitle?: string
  limit?: number
  /** Count finished work as well — driven by the "Show completed" toggle. */
  includeCompleted?: boolean
  /** Omit for a plain, non-interactive chart (admin dashboard, KPI reports). */
  onSelect?: OnDrillDown
}

export default function TasksByProjectBar({
  tasks,
  title = 'Tasks by project',
  subtitle,
  limit = 8,
  includeCompleted = false,
  onSelect,
}: Props) {
  // INDEX-ALIGNED buckets, each owning the exact tasks behind its bar, so a
  // click can map the recharts index straight back to a task array. Empty
  // buckets are dropped HERE, before `data` is projected, to keep buckets[i]
  // and data[i] the same element. Never match on the label instead: two
  // projects can carry the same title, and both would read as one bar.
  const buckets = useMemo(
    () =>
      tasksByProject(tasks, { limit, includeCompleted })
        .map((row) => ({
          projectId: row.projectId,
          name: row.projectTitle,
          color: BAR_FILL,
          tasks: row.tasks,
        }))
        .filter((b) => b.tasks.length > 0),
    [tasks, limit, includeCompleted],
  )

  // Lean projection on purpose: recharts spreads every datum field onto the
  // rendered SVG element's props, so a Task[] in here would land in the DOM.
  // No `color` either, unlike the donut — one shared fill lives on the Bar.
  const data = useMemo(
    () => buckets.map((b) => ({ name: b.name, value: b.tasks.length })),
    [buckets],
  )

  const select = useCallback(
    (index: number) => {
      const bucket = buckets[index]
      if (!onSelect || !bucket) return
      // Hand over the bucket's OWN array — the panel must never re-derive it.
      onSelect({
        title: bucket.name,
        subtitle: includeCompleted ? 'On this project' : 'Open tasks on this project',
        tasks: bucket.tasks,
        rightSlot: 'due',
      })
    },
    [buckets, onSelect, includeCompleted],
  )

  // ChartCard is a fixed height + 80px box, so eight projects would be crushed
  // inside the default 240 (same row-count sizing as OverdueTasksList). The
  // chip row is another band of content inside that box, so buy those pixels
  // back rather than letting the plot absorb them.
  // The chip row keeps to ONE line and scrolls sideways instead of wrapping.
  // Project names are long, so a wrapping row of eight would take four or five
  // lines in the half-width column and eat the plot; reserving for that worst
  // case instead left dead space whenever the names were short. A fixed
  // single-line strip is the one predictable option, and 44px covers the row
  // plus its scrollbar.
  const height = Math.max(200, buckets.length * 30 + 40) + (onSelect ? 44 : 0)

  return (
    <ChartCard
      title={title}
      subtitle={
        subtitle ?? (includeCompleted ? 'Busiest project first' : 'Open tasks, busiest project first')
      }
      empty={buckets.length === 0}
      emptyLabel="No open tasks to chart."
      height={height}
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
              width={120}
              tickFormatter={(v: string) => truncateTick(v)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: 'var(--color-fg-muted)' }}
              labelStyle={LABEL_STYLE}
              cursor={{ fill: 'var(--color-fill-2)' }}
            />
            <Bar
              dataKey="value"
              fill={BAR_FILL}
              radius={[0, 4, 4, 0]}
              className={onSelect ? 'cursor-pointer' : undefined}
              // Pre-filter index, not the render index — see PriorityBar.
              onClick={onSelect ? (d) => select(d.originalDataIndex) : undefined}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Chips exist ONLY as the keyboard path: an SVG bar can't be tabbed to.
          The YAxis already labels every bar, so for the non-drillable callers
          they would be pure duplication eating plot height — hence no legend
          at all when onSelect is omitted. Mapped over `buckets` (index-
          identical to `data`) because only the bucket carries a projectId, and
          project titles can collide, so a title is not a safe React key. */}
      {onSelect && (
        <div className="scrollbar-themed flex shrink-0 flex-nowrap gap-x-3 overflow-x-auto pb-1 text-xs text-fg-muted">
          {buckets.map((b, i) => (
            <button
              key={b.projectId}
              type="button"
              onClick={() => select(i)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded transition hover:text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: b.color }}
                aria-hidden
              />
              <span>
                {b.name}
                <span className="ml-1 text-fg-subtle">· {b.tasks.length}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </ChartCard>
  )
}
