import { useState } from 'react'
import { useKpiMetrics } from '../hooks/useKpiMetrics'
import KpiStatCard from '../components/charts/KpiStatCard'
import TrendLine from '../components/charts/TrendLine'
import TeamFlowBars from '../components/charts/TeamFlowBars'

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

export default function KpiReports() {
  // Demo mode swaps every metric input for the deterministic in-memory dataset
  // (lib/kpi/demoData) — same compute pipeline, no Firestore writes. For
  // walking an audience through the metrics before real data accumulates.
  const [demoMode, setDemoMode] = useState(false)
  const { metrics, loading, collabProjectCount } = useKpiMetrics({ demoMode })

  const cyc = metrics.cycleTime
  const firstCycle = cyc[0]
  const latestCycle = cyc[cyc.length - 1]
  const cycleReductionPct =
    firstCycle && latestCycle && firstCycle.value > 0
      ? Math.round(((firstCycle.value - latestCycle.value) / firstCycle.value) * 100)
      : null

  const wr = metrics.winRate
  const totAwarded = wr.reduce((a, b) => a + b.awarded, 0)
  const totLost = wr.reduce((a, b) => a + b.lost, 0)
  const winOverall = totAwarded + totLost ? totAwarded / (totAwarded + totLost) : null

  const ot = metrics.onTime
  const latestOt = ot.points[ot.points.length - 1]

  const u = metrics.users

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-fg-subtle">Admin</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">KPI Reports</h1>
          <p className="mt-2 max-w-2xl text-fg-muted">
            Operational KPIs over the collaborative (tender) flow, computed from project history.
            {loading ? ' Loading…' : ` ${collabProjectCount} collaborative projects in scope.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDemoMode((v) => !v)}
          className={
            demoMode
              ? 'shrink-0 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-4 py-2 text-sm font-medium text-tone-warn-fg transition hover:opacity-90'
              : 'shrink-0 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4'
          }
        >
          {demoMode ? 'Exit demo data' : 'Populate demo data'}
        </button>
      </div>

      {demoMode && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-tone-warn-bd bg-tone-warn-bg px-4 py-3 text-sm text-tone-warn-fg">
          <span aria-hidden>⚠</span>
          <span>
            <b>Demo data.</b> Every number below is synthetic (generated in your browser — nothing
            is saved). Exit demo to return to real portal data.
          </span>
        </div>
      )}

      {/* Headline stat tiles */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStatCard
          label="Win rate"
          value={pct(winOverall)}
          sub={`${totAwarded} awarded · ${totLost} lost (window)`}
          info="Of every tender the client decided, how many we won. Awarded and Completed both count as wins (completed = awarded work delivered); Lost counts against. Higher is better."
        />
        <KpiStatCard
          label="On-time submission"
          value={latestOt ? pct(latestOt.rate) : '—'}
          sub={latestOt ? `${latestOt.onTime}/${latestOt.total} this month` : 'No submissions yet'}
          info="Of the tenders we submitted, how many went out before their stored deadline. A missed tender deadline usually means a lost bid, so this protects revenue."
        />
        <KpiStatCard
          label="Active users (month)"
          value={`${u.active}/${u.total}`}
          sub={`${pct(u.rate)} of onboarded users active`}
          info="How many onboarded people actually did something in the portal this month (created or updated work). A low ratio means unused seats or an adoption problem."
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
      </div>

      {/* Trend charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TrendLine
          title="Cycle-time reduction"
          subtitle="Median days from created to submitted/closed (excl. on-hold), by cohort quarter"
          data={cyc.map((p) => ({ label: p.quarter, value: p.value }))}
          valueSuffix=" d"
          reference={firstCycle ? { value: firstCycle.value, label: 'baseline' } : undefined}
        />
        <TrendLine
          title="On-time submission rate"
          subtitle="On-time ÷ pursued tenders, by month of submission"
          data={ot.points.map((p) => ({ label: p.month, value: p.rate }))}
          percent
        />
        <TrendLine
          title="Throughput per head"
          subtitle="Projects closed ÷ active contributors, by quarter"
          data={metrics.throughput.map((p) => ({ label: p.quarter, value: p.perHead }))}
        />
        <TrendLine
          title="Rework rate trend"
          subtitle="Mean send-backs per closed project, by quarter"
          data={metrics.rework.map((p) => ({ label: p.quarter, value: p.value }))}
        />
        <TrendLine
          title="Win rate"
          subtitle="Awarded ÷ (awarded + lost), by quarter of decision"
          data={wr.map((p) => ({ label: p.quarter, value: p.rate }))}
          percent
        />
        <TeamFlowBars data={metrics.teamFlow} />
        <TrendLine
          title="Active users trend"
          subtitle="People with ≥1 action ÷ users onboarded by then, by month"
          data={metrics.activeUsers.map((p) => ({ label: p.month, value: p.rate }))}
          percent
        />
      </div>

      {/* Definitions — one entry per card, in the order they appear above. */}
      <details className="mt-6 rounded-2xl border border-line bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-fg-muted">
          How these are calculated
        </summary>
        <p className="mt-3 text-xs text-fg-subtle">
          Scope: collaborative (tender) projects only. All timings come from each project's own
          history — the timestamp recorded every time its status or stage changed.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg-subtle">
          <li>
            <b>Win rate (tile & chart):</b> among tenders the client has decided,{' '}
            <i>wins ÷ (wins + lost)</i>. A win is a project that ever reached <i>Awarded</i> or{' '}
            <i>Completed</i> — completed means the awarded work was delivered, so it counts even
            when the awarded step was skipped. Each project counts once, dated by its first
            win/loss event. Undecided tenders aren't counted.
          </li>
          <li>
            <b>On-time submission (tile & chart):</b> of the tenders we submitted,{' '}
            <i>submitted before its stored deadline ÷ all submitted</i>, by month of submission.
            {ot.unmeasurable > 0 &&
              ` (${ot.unmeasurable} submitted project(s) have no deadline stored and are left out.)`}
          </li>
          <li>
            <b>Active users (tile):</b> people who performed ≥1 recorded action in the portal this
            month (created/updated a project or task, moved a stage…) ÷ everyone onboarded to date.
            Viewing-only visits aren't counted.
          </li>
          <li>
            <b>Median cycle time (tile) / Cycle-time reduction (chart):</b> for each project, days
            from creation until its pitch went out (or it closed) — minus any time on hold. Projects
            are grouped by the quarter they were <i>created</i>; the chart plots each cohort's
            median (typical) value against the first cohort as baseline.
          </li>
          <li>
            <b>Throughput per head (chart), step by step:</b> ① count projects that reached a final
            outcome this quarter (completed, lost, not submitted, or archived) → ② count the
            distinct people who performed ≥1 action in the portal that same quarter → ③ divide ①
            by ②. <i>Example: 12 projects closed in Q2 and 8 people were active → 12 ÷ 8 = 1.5
            projects per person.</i> Rising = the same team is clearing more work.
          </li>
          <li>
            <b>Rework rate trend (chart), step by step:</b> every time work is sent back for another
            pass ("request changes" during execution, or "reject — send back" at lead review), the
            project's send-back counter goes up by one. When a project closes, it brings that count
            with it: ① take all projects closed in the quarter → ② average their send-back counts.{' '}
            <i>Example: three projects close with 2, 1 and 0 send-backs → (2+1+0) ÷ 3 = 1.0
            send-backs per project.</i> Falling = review loops are catching less rework.
          </li>
          <li>
            <b>Team flow efficiency (bars), step by step:</b> ① every stage change is timestamped
            automatically, so we know how long a project sat in each stage → ② hands-on stages
            (eligibility review, task setup, execution, lead review) count as <i>active</i>; queue
            stages (awaiting lead decision, ready-for-client) count only toward the total → ③ time
            on hold is removed from both → ④ each attached team's bar = its projects' active time ÷
            total time. <i>Example: 2d awaiting a lead + 8d execution/reviews + 3d with the client
            = 8 ÷ 13 ≈ 62%.</i> Task check-box updates are deliberately not timed — stage
            timestamps are automatic, while task statuses depend on people remembering to update
            them. Note: a project with no team attached counts toward no bar.
          </li>
          <li>
            <b>Active users trend (chart):</b> for each month, distinct people with ≥1 action ÷ how
            many users had been onboarded by that month's end — the adoption trajectory over time.
          </li>
        </ul>
      </details>
    </main>
  )
}
