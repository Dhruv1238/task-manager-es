import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, RefreshCw } from 'lucide-react'
import { useTimeReport } from '../hooks/useTimeReport'
import { formatDateKey, formatDuration, monthStartDateKey, todayDateKey } from '../lib/duration'
import {
  TIME_GROUP_COLUMNS,
  TIME_GROUP_LABELS,
  dailyTotals,
  filterTimeEntries,
  groupTimeEntries,
  summarizeTimeEntries,
  type TimeGroupBy,
} from '../lib/timeReport'
import type { TimeEntry } from '../types/models'
import ChartCard from '../components/charts/ChartCard'
import KpiStatCard from '../components/charts/KpiStatCard'
import TimeEntriesPanel from '../components/charts/TimeEntriesPanel'
import Avatar from '../components/ui/Avatar'
import Dropdown from '../components/ui/Dropdown'
import { AXIS_STYLE, GRID_COLOR, ITEM_STYLE, LABEL_STYLE, TOOLTIP_STYLE } from '../components/charts/chartTheme'

const GROUP_MODES: TimeGroupBy[] = ['user', 'project', 'day', 'userProject', 'userDay']

const inputCls =
  'rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

/**
 * Time report (features.timeTracking) — per-person / per-project / per-day
 * totals over a date window.
 *
 * Read budget: ONE windowed getDocs of `timeEntries`, and that is the whole
 * cost of the page. The person and project filters, all five group-by modes,
 * the tiles, the chart, the drill-down and the CSV are computed in memory from
 * that single result, so only moving the date window refetches.
 *
 * The filter option lists are derived from the fetched window rather than from
 * a users/projects query: it costs no extra reads, and a time report should
 * only offer to filter by people and projects that actually logged time in the
 * window being looked at.
 */
export default function TimeReport() {
  // Initialised once so the mount query doesn't refire (the KPI page's
  // captured-anchors trick, in its simplest form).
  const [from, setFrom] = useState(monthStartDateKey)
  const [to, setTo] = useState(todayDateKey)
  const [uid, setUid] = useState('')
  const [projectId, setProjectId] = useState('')
  const [groupBy, setGroupBy] = useState<TimeGroupBy>('user')
  // The row's key, not the row object itself — so the drill-down always
  // reflects the CURRENT filters/window rather than a stale snapshot taken at
  // click time. If the window narrows and the row no longer exists, the
  // lookup below yields null and the modal closes on its own.
  const [drillKey, setDrillKey] = useState<string | null>(null)

  const { entries, loading, error, refresh } = useTimeReport(from, to)

  const people = useMemo(() => optionsFrom(entries, 'uid', 'userName', 'Unknown user'), [entries])
  const projects = useMemo(
    () => optionsFrom(entries, 'projectId', 'projectTitle', 'Untitled project'),
    [entries],
  )

  const filtered = useMemo(
    () => filterTimeEntries(entries, { uid: uid || null, projectId: projectId || null }),
    [entries, uid, projectId],
  )
  const summary = useMemo(() => summarizeTimeEntries(filtered), [filtered])
  const rows = useMemo(() => groupTimeEntries(filtered, groupBy), [filtered, groupBy])
  const drillRow = useMemo(() => rows.find((r) => r.key === drillKey) ?? null, [rows, drillKey])
  const perDay = useMemo(
    () => dailyTotals(filtered).map((d) => ({ ...d, hours: round2(d.minutes / 60) })),
    [filtered],
  )

  const rangeLabel = `${formatDateKey(from)} – ${formatDateKey(to)}`
  const invalidRange = Boolean(from && to && from > to)
  const columns = TIME_GROUP_COLUMNS[groupBy]

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-faint">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold text-fg-strong">Time Report</h1>
        <p className="mt-2 max-w-3xl text-sm text-fg-subtle">
          Time logged against tasks, grouped however you need it. Everything below is computed from
          one read of the chosen date range — switching filters or grouping costs nothing.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-card px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-subtle">From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className={`${inputCls} scheme-dark`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-subtle">To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className={`${inputCls} scheme-dark`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-subtle">Person</span>
          <Dropdown
            value={uid}
            onChange={setUid}
            options={[{ value: '', label: 'Everyone' }, ...people]}
            searchable
            searchPlaceholder="Search people…"
            className="min-w-44"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-subtle">Project</span>
          <Dropdown
            value={projectId}
            onChange={setProjectId}
            options={[{ value: '', label: 'All projects' }, ...projects]}
            searchable
            searchPlaceholder="Search projects…"
            className="min-w-48"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-subtle">Group by</span>
          <div className="flex flex-wrap rounded-lg border border-line bg-fill-2 p-0.5">
            {GROUP_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setGroupBy(m)}
                aria-pressed={groupBy === m}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  groupBy === m ? 'bg-fill-4 text-fg-strong' : 'text-fg-subtle hover:text-fg'
                }`}
              >
                {TIME_GROUP_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        {/* This page is a one-shot read, so time logged elsewhere after it
            loaded won't appear on its own. Re-pull the same window without
            having to nudge the dates. */}
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-muted transition hover:border-brand-edge hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw size={14} aria-hidden className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={() => downloadTimeEntriesCsv(filtered, from, to)}
          disabled={filtered.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-muted transition hover:border-brand-edge hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={14} aria-hidden /> CSV
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg"
        >
          {error}
        </div>
      )}
      {invalidRange && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-2 text-sm text-tone-warn-fg"
        >
          The start date is after the end date — nothing to show.
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiStatCard
          label="Total time"
          value={loading ? '—' : formatDuration(summary.minutes)}
          sub={rangeLabel}
          info="Sum of every time entry in the selected window, after the person and project filters."
        />
        <KpiStatCard
          label="Entries"
          value={loading ? '—' : String(summary.entryCount)}
          sub={`across ${summary.days} ${summary.days === 1 ? 'day' : 'days'}`}
          info="Individual logs. One person can log several times on the same task and day."
        />
        <KpiStatCard
          label="People"
          value={loading ? '—' : String(summary.people)}
          sub="logged time in range"
          info="Distinct people with at least one entry in the window, after filters."
        />
      </div>

      <ChartCard
        title="Hours per day"
        subtitle="Days with no logged time are omitted"
        className="mb-6"
        empty={!loading && perDay.length === 0}
        emptyLabel="No time logged in this range."
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={perDay} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={ITEM_STYLE}
              labelStyle={LABEL_STYLE}
              formatter={(value) => [formatDuration(Math.round(Number(value) * 60)), 'Logged']}
            />
            <Bar dataKey="hours" fill="var(--color-brandtone-dot)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-muted">
          By {TIME_GROUP_LABELS[groupBy].toLowerCase()}
        </h2>
        {loading ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-fg-subtle">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-fg-subtle">
            {entries.length === 0
              ? 'Nobody logged time in this range.'
              : 'No entries match these filters.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-faint">
                  <th className="pb-2 pr-3 font-medium">{columns.label}</th>
                  {columns.sublabel && <th className="pb-2 pr-3 font-medium">{columns.sublabel}</th>}
                  <th className="pb-2 pr-3 text-right font-medium">Time</th>
                  <th className="pb-2 pr-3 text-right font-medium">Entries</th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    {groupBy === 'user' || groupBy === 'userProject' || groupBy === 'userDay'
                      ? 'Share'
                      : 'People'}
                  </th>
                  <th className="pb-2 font-medium sr-only">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => setDrillKey(r.key)}
                    className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-fill-2"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2.5">
                        {r.uid && <Avatar name={r.label} size={26} className="shrink-0" />}
                        <span className="truncate font-medium text-fg">{r.label}</span>
                      </div>
                    </td>
                    {columns.sublabel && (
                      <td className="max-w-[14rem] truncate py-2.5 pr-3 text-fg-muted">
                        {r.sublabel}
                      </td>
                    )}
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums text-fg-strong">
                      {formatDuration(r.minutes)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-fg-muted">
                      {r.entryCount}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-fg-subtle">
                      {groupBy === 'user' || groupBy === 'userProject' || groupBy === 'userDay'
                        ? summary.minutes > 0
                          ? `${Math.round((r.minutes / summary.minutes) * 100)}%`
                          : '—'
                        : r.people}
                    </td>
                    <td className="py-2.5 text-right text-xs text-fg-faint">View</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs leading-relaxed text-fg-faint">
          Totals come from the raw entries every time, so they stay correct even if a task's
          cached total drifts. Click any row to see the individual entries behind it.
        </p>
      </div>

      <TimeEntriesPanel
        open={drillRow !== null}
        onClose={() => setDrillKey(null)}
        row={drillRow}
        rangeLabel={rangeLabel}
      />
    </main>
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Distinct id → label pairs present in the window, alphabetical. */
function optionsFrom(
  entries: TimeEntry[],
  idKey: 'uid' | 'projectId',
  labelKey: 'userName' | 'projectTitle',
  fallback: string,
): { value: string; label: string }[] {
  const seen = new Map<string, string>()
  for (const e of entries) {
    const id = e[idKey]
    if (!id) continue
    const label = e[labelKey]?.trim()
    // Prefer a non-empty snapshot if any entry has one.
    if (!seen.get(id)) seen.set(id, label || fallback)
  }
  return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

/**
 * Exports the RAW filtered entries rather than the grouped view: raw rows
 * re-pivot in a spreadsheet, grouped rows don't un-pivot. `Minutes` is left
 * unquoted so SUM() works on it directly.
 */
function downloadTimeEntriesCsv(rows: TimeEntry[], from: string, to: string): void {
  if (typeof window === 'undefined' || rows.length === 0) return
  const cell = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const ordered = rows
    .slice()
    .sort((a, b) => (a.dateKey === b.dateKey ? a.id.localeCompare(b.id) : a.dateKey.localeCompare(b.dateKey)))
  const csv = [
    ['Date', 'Person', 'Project', 'Task', 'Duration', 'Minutes', 'Note'].join(','),
    ...ordered.map((e) =>
      [
        cell(e.dateKey),
        cell(e.userName ?? ''),
        cell(e.projectTitle ?? ''),
        cell(e.taskTitle ?? ''),
        cell(formatDuration(e.minutes)),
        e.minutes,
        cell(e.note ?? ''),
      ].join(','),
    ),
  ].join('\r\n')
  // Leading BOM so Excel reads it as UTF-8.
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `time-entries-${from}-to-${to}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
