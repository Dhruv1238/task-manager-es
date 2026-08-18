import { useState } from 'react'
import { Users } from 'lucide-react'
import type { KpiData } from '../../hooks/useKpiMetrics'
import { pct } from '../../lib/kpi/format'
import ActiveUsersPanel from './ActiveUsersPanel'
import KpiStatCard from './KpiStatCard'
import MonthSelect from './MonthSelect'

/**
 * The four headline stat tiles, shared verbatim by KPI Reports and Usage
 * Analytics so both pages open with the same summary row. Each page keeps its
 * own charts below.
 *
 * Month state is split by necessity: the active-users month has to round-trip
 * through useKpiMetrics (it changes which audit window userStats counts), so
 * the page owns it and passes it back down. The on-time month only picks a
 * bucket out of an already-computed series, so it lives here.
 *
 * The active-users tile also opens a roster drill-down (ActiveUsersPanel) —
 * "41/183" is only actionable once you can see which 41.
 */
export default function KpiHeadlineTiles({
  kpi,
  onUserMonthChange,
}: {
  kpi: KpiData
  onUserMonthChange: (month: string) => void
}) {
  const { metrics, reportMonths, currentMonth, userMonth } = kpi
  const [otMonth, setOtMonth] = useState<string | null>(null)
  const [rosterOpen, setRosterOpen] = useState(false)

  const wr = metrics.winRate
  const totAwarded = wr.reduce((a, b) => a + b.awarded, 0)
  const totLost = wr.reduce((a, b) => a + b.lost, 0)
  const winOverall = totAwarded + totLost ? totAwarded / (totAwarded + totLost) : null

  // onTimeSeries only emits buckets for months that had submissions, so the
  // tile defaults to the most recent month that actually has one rather than
  // silently labelling it "this month". Months in range with no submissions are
  // still selectable — they read as "no submissions", which is real signal.
  const ot = metrics.onTime
  const otByMonth = new Map(ot.points.map((p) => [p.month, p]))
  const defaultOtMonth = reportMonths.find((m) => otByMonth.has(m)) ?? currentMonth
  const activeOtMonth = otMonth && reportMonths.includes(otMonth) ? otMonth : defaultOtMonth
  const otPoint = otByMonth.get(activeOtMonth)

  const cyc = metrics.cycleTime
  const firstCycle = cyc[0]
  const latestCycle = cyc[cyc.length - 1]
  const cycleReductionPct =
    firstCycle && latestCycle && firstCycle.value > 0
      ? Math.round(((firstCycle.value - latestCycle.value) / firstCycle.value) * 100)
      : null

  const u = metrics.users
  const isCurrentMonth = userMonth === currentMonth

  return (
    <div className="kpi-print-tiles mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiStatCard
        label="Win rate"
        value={pct(winOverall)}
        sub={`${totAwarded} awarded · ${totLost} lost (window)`}
        info="Of every tender the client decided, how many we won. Awarded and Completed both count as wins (completed = awarded work delivered); Lost counts against. Higher is better."
      />
      <KpiStatCard
        label="On-time submission"
        value={otPoint ? pct(otPoint.rate) : '—'}
        sub={
          otPoint
            ? `${otPoint.onTime}/${otPoint.total} submitted on time`
            : ot.points.length
              ? 'Nothing submitted this month'
              : 'No submissions yet'
        }
        info="Of the tenders we submitted in the selected month, how many went out before their stored deadline. A missed tender deadline usually means a lost bid, so this protects revenue."
        control={
          <MonthSelect
            value={activeOtMonth}
            months={reportMonths}
            onChange={setOtMonth}
            label="Month for on-time submission"
          />
        }
      />
      <KpiStatCard
        label="Active users"
        value={`${u.active}/${u.total}`}
        sub={
          isCurrentMonth
            ? `${pct(u.rate)} of onboarded users active · month to date`
            : `${pct(u.rate)} of users onboarded by then`
        }
        info="How many onboarded people actually did something in the portal in the selected month (created or updated work), out of everyone onboarded by the end of that month. A low ratio means unused seats or an adoption problem."
        control={
          <MonthSelect
            value={userMonth}
            months={reportMonths}
            onChange={onUserMonthChange}
            label="Month for active users"
          />
        }
        action={
          u.total > 0 && (
            <button
              type="button"
              onClick={() => setRosterOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:border-brand-edge hover:text-fg focus-visible:border-brand-edge focus-visible:text-fg"
            >
              <Users size={12} aria-hidden />
              Who's active?
            </button>
          )
        }
      />
      <KpiStatCard
        label="Median cycle time"
        value={latestCycle ? `${latestCycle.value} d` : '—'}
        sub={
          cycleReductionPct == null
            ? 'Time to submit / close (excl. on-hold)'
            : `${cycleReductionPct >= 0 ? '↓' : '↑'} ${Math.abs(cycleReductionPct)}% vs baseline`
        }
        delta={
          cycleReductionPct == null
            ? undefined
            : {
                value: `${Math.abs(cycleReductionPct)}%`,
                direction: cycleReductionPct >= 0 ? 'down' : 'up',
                good: cycleReductionPct >= 0,
              }
        }
        info="Typical days from a project being created to its pitch going out (or the project closing). Time spent on hold waiting on clients is not counted. Lower is better."
      />
      <ActiveUsersPanel
        open={rosterOpen}
        onClose={() => setRosterOpen(false)}
        stats={u}
        month={userMonth}
        isCurrentMonth={isCurrentMonth}
      />
    </div>
  )
}
