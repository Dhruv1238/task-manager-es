import { useCallback, useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Task } from '../../types/models'
import type { OnDrillDown } from '../me/types'
import { AXIS_STYLE, GRID_COLOR, LABEL_STYLE, TOOLTIP_STYLE } from './chartTheme'
import ChartCard from './ChartCard'

// One series, one colour — the buckets carry it so the chips, the stroke and
// the dots can never drift apart.
const LINE_COLOR = 'var(--color-brandtone-dot)'

interface Props {
  tasks: Task[]
  weeks?: number
  title?: string
  subtitle?: string
  /** Omit for a plain, non-interactive chart (admin dashboard, KPI reports). */
  onSelect?: OnDrillDown
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay() // 0 = Sunday
  copy.setDate(copy.getDate() - day)
  return copy
}

function formatLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function WeeklyCompletionLine({
  tasks,
  weeks = 8,
  title = 'Weekly completion',
  subtitle,
  onSelect,
}: Props) {
  // Each bucket owns the exact tasks behind its plotted point: the task is
  // pushed at the same place the count used to be incremented, so the number
  // on the chart and the list behind a click cannot disagree. Empty weeks are
  // KEPT (the window is a fixed last-N-weeks axis), which also means
  // buckets[i] and data[i] stay the same element and a click can map the
  // recharts index straight back. Never match on the label: labels repeat once
  // the window is longer than a year.
  const buckets = useMemo(() => {
    const acc: { key: string; label: string; color: string; start: number; tasks: Task[] }[] = []
    const now = startOfWeek(new Date())
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i * 7)
      acc.push({
        key: d.toISOString(),
        label: formatLabel(d),
        color: LINE_COLOR,
        start: d.getTime(),
        tasks: [],
      })
    }
    const end = new Date(now)
    end.setDate(end.getDate() + 7)
    const endMs = end.getTime()

    for (const t of tasks) {
      const completedAt = t.completedAt
      if (!completedAt) continue
      const ms = completedAt.toDate().getTime()
      const firstStart = acc[0].start
      if (ms < firstStart || ms >= endMs) continue
      // find bucket
      for (let i = acc.length - 1; i >= 0; i--) {
        if (ms >= acc[i].start) {
          acc[i].tasks.push(t)
          break
        }
      }
    }
    return acc
  }, [tasks, weeks])

  // Lean projection on purpose: recharts spreads every datum field onto the
  // rendered SVG element's props, so a Task[] in here would land in the DOM.
  const data = useMemo(
    () => buckets.map((b) => ({ label: b.label, count: b.tasks.length })),
    [buckets],
  )

  const total = data.reduce((a, d) => a + d.count, 0)

  const select = useCallback(
    (index: number) => {
      const bucket = buckets[index]
      // A week with no completions has no point to click, but the chart-level
      // handler resolves to the nearest x anyway — don't open an empty panel.
      if (!onSelect || !bucket || bucket.tasks.length === 0) return
      // Hand over the bucket's OWN array — the panel must never re-derive it.
      onSelect({
        title: `Week of ${bucket.label}`,
        subtitle: 'Completed that week',
        tasks: bucket.tasks,
        rightSlot: 'completed',
      })
    },
    [buckets, onSelect],
  )

  return (
    <ChartCard
      title={title}
      subtitle={subtitle ?? `Last ${weeks} weeks`}
      empty={total === 0}
      emptyLabel="No completions in the window."
      // ChartCard is a fixed height + 80px box, so the added chip row would eat
      // plot height; buy the line those pixels back instead.
      height={onSelect ? 260 : undefined}
    >
      {/* Wrapper needed once a chip row is a sibling: ChartCard's body is a
          flex column, so the plot has to flex rather than claim height 100%. */}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
            className={onSelect ? 'cursor-pointer' : undefined}
            // Chart-level, not on activeDot: in recharts 3 the dot's onClick
            // gets only an SVG event with no payload. activeTooltipIndex can be
            // a string or null, hence Number + Number.isInteger. A click in the
            // plot whitespace resolves to the nearest x index — the same
            // behaviour the tooltip already has.
            onClick={
              onSelect
                ? (s) => {
                    // Number(null) is 0, an integer — so a nullish active
                    // index used to sail through this guard and drill into
                    // the OLDEST week on any click outside the plot. Reject
                    // the nullish case before coercing, then bounds-check.
                    const raw = s?.activeTooltipIndex
                    if (raw == null || raw === '') return
                    const i = Number(raw)
                    if (!Number.isInteger(i) || i < 0 || i >= buckets.length) return
                    select(i)
                  }
                : undefined
            }
          >
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_STYLE} stroke={GRID_COLOR} />
            <YAxis tick={AXIS_STYLE} stroke={GRID_COLOR} allowDecimals={false} width={32} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: 'var(--color-fg-muted)' }}
              labelStyle={LABEL_STYLE}
              cursor={{ stroke: 'var(--color-line-strong)' }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={LINE_COLOR}
              strokeWidth={2}
              dot={{ r: 3, fill: LINE_COLOR }}
              activeDot={{ r: 5, fill: 'var(--color-brand)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {onSelect && (
        // The chips are the keyboard path: an SVG point can't be tabbed to, so
        // when drillable every week that has completions gets a real button
        // firing the same select(index). Weeks with none are skipped in place,
        // keeping the map index aligned with `buckets`.
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {buckets.map((b, i) =>
            b.tasks.length === 0 ? null : (
              <button
                key={b.key}
                type="button"
                onClick={() => select(i)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded transition hover:text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand-ring"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: b.color }}
                  aria-hidden
                />
                <span>
                  {b.label}
                  <span className="ml-1 text-fg-subtle">· {b.tasks.length}</span>
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </ChartCard>
  )
}
