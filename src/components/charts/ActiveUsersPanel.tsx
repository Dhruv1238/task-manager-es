import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { UserActivity, UserStats } from '../../lib/kpi/kpiCompute'
import { auditActionLabel, dayTime, monthLabel } from '../../lib/kpi/format'
import Avatar from '../ui/Avatar'
import Modal from '../ui/Modal'
import SearchInput from '../ui/SearchInput'

type Segment = 'active' | 'idle' | 'all'

/**
 * Drill-down behind the "Active users" tile: the named people the ratio is made
 * of, for the month the tile is scoped to.
 *
 * Everything shown comes from the roster userStats already built, so the list
 * and the tile can't drift — no second query, no second definition of "active".
 */
export default function ActiveUsersPanel({
  open,
  onClose,
  stats,
  month,
  isCurrentMonth,
}: {
  open: boolean
  onClose: () => void
  stats: UserStats
  month: string
  isCurrentMonth: boolean
}) {
  const [segment, setSegment] = useState<Segment>('active')
  const [q, setQ] = useState('')

  const idleCount = stats.total - stats.active
  const segments: Array<{ key: Segment; label: string; count: number }> = [
    { key: 'active', label: 'Active', count: stats.active },
    { key: 'idle', label: 'Idle', count: idleCount },
    { key: 'all', label: 'All onboarded', count: stats.total },
  ]

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return stats.roster.filter((r) => {
      if (segment === 'active' && !r.active) return false
      if (segment === 'idle' && r.active) return false
      if (!needle) return true
      return `${r.displayName ?? ''} ${r.email ?? ''}`.toLowerCase().includes(needle)
    })
  }, [stats.roster, segment, q])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Active users · ${monthLabel(month)}`}
      description={`${stats.active} of ${stats.total} onboarded ${
        stats.total === 1 ? 'person' : 'people'
      } recorded at least one action${isCurrentMonth ? ' so far this month' : ' that month'}.`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-line bg-fill-2 p-0.5">
            {segments.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                aria-pressed={segment === s.key}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  segment === s.key
                    ? 'bg-fill-4 text-fg-strong'
                    : 'text-fg-subtle hover:text-fg'
                }`}
              >
                {s.label}{' '}
                <span className="tabular-nums text-fg-faint">{s.count}</span>
              </button>
            ))}
          </div>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Filter by name or email"
            infoText="Filters the list below by display name or email address."
            className="min-w-48 flex-1"
          />
          <button
            type="button"
            onClick={() => downloadRosterCsv(rows, month, segment)}
            disabled={rows.length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-muted transition hover:border-brand-edge hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={14} aria-hidden /> CSV
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-fg-subtle">
            {q.trim()
              ? 'Nobody in this segment matches that filter.'
              : segment === 'idle'
                ? 'Everyone onboarded was active — no idle seats this month.'
                : 'Nobody recorded an action in this month.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-faint">
                  <th className="pb-2 pr-3 font-medium">Person</th>
                  <th className="pb-2 pr-3 text-right font-medium">Actions</th>
                  <th className="pb-2 pr-3 font-medium">Last action</th>
                  <th className="pb-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-b border-line/60 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.displayName} email={r.email} size={28} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-fg">
                              {r.displayName || r.email || r.uid}
                            </span>
                            {r.deactivated && (
                              <span className="shrink-0 rounded-full border border-line px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                                Deactivated
                              </span>
                            )}
                          </div>
                          {r.email && (
                            <div className="truncate text-xs text-fg-subtle">{r.email}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-fg-muted">
                      {r.active ? r.actions : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-fg-muted">{auditActionLabel(r.lastAction)}</td>
                    <td className="py-2.5 whitespace-nowrap text-fg-subtle">
                      {r.active ? dayTime(r.lastActionMs) : 'No activity'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs leading-relaxed text-fg-faint">
          "Action" means a recorded write — creating or updating a project or task, moving a stage,
          assigning work. Read-only visits leave no audit trail, so someone who only browsed shows
          as idle. Idle seats include accounts onboarded mid-month and deactivated ones.
        </p>
      </div>
    </Modal>
  )
}

// Same rows as the table (segment + filter applied), so what you export is what
// you're looking at.
function downloadRosterCsv(rows: UserActivity[], month: string, segment: Segment): void {
  if (typeof window === 'undefined' || rows.length === 0) return
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const csv = [
    ['Name', 'Email', 'Status', 'Actions', 'Last action', 'Last active', 'Account'].join(','),
    ...rows.map((r) =>
      [
        cell(r.displayName ?? ''),
        cell(r.email ?? ''),
        cell(r.active ? 'Active' : 'Idle'),
        r.actions,
        cell(r.active ? auditActionLabel(r.lastAction) : ''),
        cell(r.lastActionMs == null ? '' : new Date(r.lastActionMs).toISOString()),
        cell(r.deactivated ? 'Deactivated' : 'Active'),
      ].join(','),
    ),
  ].join('\r\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `active-users-${segment}-${month}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
