import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollapsibleSection from '../ui/CollapsibleSection'
import { useMyTimeEntries } from '../../hooks/useMyTimeEntries'
import { formatDateKey, formatDuration, shiftDateKey, todayDateKey } from '../../lib/duration'
import { groupTimeEntries, summarizeTimeEntries } from '../../lib/timeReport'

// Two weeks covers "this week" plus the tail of the last one, which is the span
// people actually reconcile against a timesheet.
const WINDOW_DAYS = 13

/**
 * "My time" on /me (features.timeTracking) — the personal counterpart to the
 * admin report, so someone without the `reports` grant can still see their own
 * cross-task totals.
 *
 * Collapsed by default and fetched only on expand, so the page costs nothing
 * extra for people who never open it. Hence the CollapsibleSection is used in
 * controlled mode: `open` is the hook's `enabled` flag, not just a style bit.
 */
export default function MyTimeSection({ uid }: { uid: string | undefined }) {
  const [open, setOpen] = useState(false)
  // Captured once per mount so expanding and collapsing doesn't refire the read
  // with a different window.
  const [from] = useState(() => shiftDateKey(todayDateKey(), -WINDOW_DAYS))
  const { entries, loading, error } = useMyTimeEntries(uid, from, open)

  const byDay = useMemo(() => groupTimeEntries(entries, 'day'), [entries])
  const summary = useMemo(() => summarizeTimeEntries(entries), [entries])

  return (
    <CollapsibleSection
      title="My time"
      open={open}
      onOpenChange={setOpen}
      description={
        <>
          What you logged over the last {WINDOW_DAYS + 1} days, by day.
          {open && !loading && entries.length > 0 && (
            <span className="ml-1 text-fg-muted">
              {formatDuration(summary.minutes)} across {summary.entryCount}{' '}
              {summary.entryCount === 1 ? 'entry' : 'entries'}.
            </span>
          )}
        </>
      }
    >
      {loading ? (
        <div className="rounded-xl border border-line bg-card p-4 text-center text-xs text-fg-subtle">
          Loading…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
        >
          {error}
        </div>
      ) : byDay.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-sm text-fg-subtle">
          You haven't logged time in this period. Open a task and use its Time section.
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map((day) => (
            <div key={day.key} className="rounded-xl border border-line bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-line/60 px-4 py-2.5">
                <span className="text-sm font-medium text-fg">{formatDateKey(day.key)}</span>
                <span className="text-sm tabular-nums text-fg-strong">
                  {formatDuration(day.minutes)}
                </span>
              </div>
              <ul className="divide-y divide-line/60">
                {day.entries.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                    <Link
                      to={`/tasks/${e.taskId}`}
                      className="min-w-0 flex-1 truncate text-fg transition hover:text-brand"
                    >
                      {e.taskTitle || 'Untitled task'}
                    </Link>
                    {e.note && (
                      <span className="hidden min-w-0 max-w-[16rem] truncate text-xs text-fg-subtle sm:block">
                        {e.note}
                      </span>
                    )}
                    <span className="shrink-0 tabular-nums text-fg-muted">
                      {formatDuration(e.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  )
}
