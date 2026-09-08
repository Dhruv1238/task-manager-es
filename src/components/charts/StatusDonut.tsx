import { useCallback, useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { Task, TaskStatus } from '../../types/models'
import { bucketForActiveSet, isTerminal, useTaskStatuses } from '../../lib/taskStatus'
import type { OnDrillDown } from '../me/types'
import { LABEL_STYLE, STATUS_COLOR, STATUS_LABEL, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

interface Props {
  tasks: Task[]
  title?: string
  subtitle?: string
  excludeDone?: boolean
  /** Omit for a plain, non-interactive chart (admin dashboard, KPI reports). */
  onSelect?: OnDrillDown
}

export default function StatusDonut({
  tasks,
  title = 'Status breakdown',
  subtitle,
  excludeDone = false,
  onSelect,
}: Props) {
  const { statuses, techOn } = useTaskStatuses()

  // One pass builds INDEX-ALIGNED buckets, each owning the exact tasks behind
  // its slice. Empty buckets are dropped HERE, before `data` is projected, so
  // buckets[i] and data[i] are always the same element and a click can map the
  // recharts index straight back. Never match on the label instead: labels
  // collide once bucketForActiveSet folds flag-inactive statuses into their
  // legacy bucket (dev_done/in_uat/ready_for_prod all read "In Review").
  const buckets = useMemo(() => {
    const byStatus = new Map<TaskStatus, Task[]>()
    for (const s of statuses) byStatus.set(s, [])
    for (const t of tasks) {
      // "excludeDone" means "open work only" — cancelled is just as closed.
      if (excludeDone && isTerminal(t.status)) continue
      // Fold flag-inactive statuses into their legacy slice so no task vanishes.
      byStatus.get(bucketForActiveSet(t.status, techOn))?.push(t)
    }
    return statuses
      .map((s) => ({
        name: STATUS_LABEL[s],
        color: STATUS_COLOR[s],
        tasks: byStatus.get(s) ?? [],
      }))
      .filter((b) => b.tasks.length > 0)
  }, [tasks, excludeDone, statuses, techOn])

  // Lean projection on purpose: recharts spreads every datum field onto the
  // rendered SVG sector's props, so a Task[] in here would land in the DOM.
  const data = useMemo(
    () => buckets.map((b) => ({ name: b.name, color: b.color, value: b.tasks.length })),
    [buckets],
  )

  const total = data.reduce((acc, d) => acc + d.value, 0)

  const select = useCallback(
    (index: number) => {
      const bucket = buckets[index]
      if (!onSelect || !bucket) return
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
      emptyLabel="No tasks to chart."
      // ChartCard is a fixed height + 80px box, so the taller button chip row
      // would eat plot height; buy the donut those pixels back instead.
      height={onSelect ? 260 : undefined}
    >
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
              className={onSelect ? 'cursor-pointer' : undefined}
              // The raw render index is safe HERE, unlike the bar charts:
              // Pie maps over its sectors and returns null in place for a
              // zero-angle one (recharts Pie.js, no filter(Boolean)), so `i`
              // stays the original index. Bar filters its rect array first,
              // which is why PriorityBar has to read originalDataIndex. Empty
              // buckets are dropped above anyway, so no zero sector exists.
              onClick={onSelect ? (_d, i) => select(i) : undefined}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: 'var(--color-fg-muted)' }}
              labelStyle={LABEL_STYLE}
              cursor={{ fill: 'var(--color-fill-2)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
        {data.map((d, i) => {
          const chip = (
            <>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: d.color }}
                aria-hidden
              />
              <span>
                {d.name}
                <span className="ml-1 text-fg-subtle">· {d.value}</span>
              </span>
            </>
          )
          // The chips are the keyboard path: an SVG slice can't be tabbed to,
          // so when drillable they become real buttons firing the same select.
          return onSelect ? (
            <button
              key={d.name}
              type="button"
              onClick={() => select(i)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded transition hover:text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              {chip}
            </button>
          ) : (
            <span key={d.name} className="inline-flex items-center gap-1.5">
              {chip}
            </span>
          )
        })}
      </div>
    </ChartCard>
  )
}
