import { useState } from 'react'
import { useKpiMetrics } from '../hooks/useKpiMetrics'
import { monthLabel } from '../lib/kpi/format'
import KpiDefinitions from '../components/charts/KpiDefinitions'
import KpiHeadlineTiles from '../components/charts/KpiHeadlineTiles'
import KpiPageHeader from '../components/charts/KpiPageHeader'
import TrendLine from '../components/charts/TrendLine'
import TeamFlowBars from '../components/charts/TeamFlowBars'

export default function KpiReports() {
  // Demo mode swaps every metric input for the deterministic in-memory dataset
  // (lib/kpi/demoData) — same compute pipeline, no Firestore writes. For
  // walking an audience through the metrics before real data accumulates.
  const [demoMode, setDemoMode] = useState(false)
  // Feeds back into the hook: the active-users tile recomputes per month.
  const [userMonth, setUserMonth] = useState<string | null>(null)
  const kpi = useKpiMetrics({ demoMode, userMonth: userMonth ?? undefined })
  const { metrics, loading, collabProjectCount, reportMonths } = kpi

  const cyc = metrics.cycleTime
  const firstCycle = cyc[0]
  const ot = metrics.onTime

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <KpiPageHeader
        title="KPI Reports"
        description={
          <>
            Operational KPIs over the collaborative (tender) flow, computed from project history.
            {loading ? ' Loading…' : ` ${collabProjectCount} collaborative projects in scope.`}
          </>
        }
        demoMode={demoMode}
        onToggleDemo={() => setDemoMode((v) => !v)}
      />

      {/* Headline stat tiles */}
      <KpiHeadlineTiles kpi={kpi} onUserMonthChange={setUserMonth} />

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
          data={metrics.winRate.map((p) => ({ label: p.quarter, value: p.rate }))}
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
      <KpiDefinitions>
        <li>
          <b>Win rate (tile & chart):</b> among tenders the client has decided,{' '}
          <i>wins ÷ (wins + lost)</i>. A win is a project that ever reached <i>Awarded</i> or{' '}
          <i>Completed</i> — completed means the awarded work was delivered, so it counts even when
          the awarded step was skipped. Each project counts once, dated by its first win/loss event.
          Undecided tenders aren't counted.
        </li>
        <li>
          <b>On-time submission (tile & chart):</b> of the tenders we submitted,{' '}
          <i>submitted before its stored deadline ÷ all submitted</i>, by month of submission. The
          tile's month picker defaults to the most recent month that had a submission, so it never
          shows an older month's rate as if it were this one.
          {ot.unmeasurable > 0 &&
            ` (${ot.unmeasurable} submitted project(s) have no deadline stored and are left out.)`}
        </li>
        <li>
          <b>Active users (tile):</b> people who performed ≥1 recorded action in the portal during
          the selected month (created/updated a project or task, moved a stage…) ÷ everyone
          onboarded by the end of that month. Viewing-only visits aren't counted. The month pickers
          on this page go back to {monthLabel(reportMonths[reportMonths.length - 1])}, where portal
          activity starts; the current month is counted to date, so it reads low until the month
          fills out.
        </li>
        <li>
          <b>Median cycle time (tile) / Cycle-time reduction (chart):</b> for each project, days
          from creation until its pitch went out (or it closed) — minus any time on hold. Projects
          are grouped by the quarter they were <i>created</i>; the chart plots each cohort's median
          (typical) value against the first cohort as baseline.
        </li>
        <li>
          <b>Throughput per head (chart), step by step:</b> ① count projects that reached a final
          outcome this quarter (completed, lost, not submitted, or archived) → ② count the distinct
          people who performed ≥1 action in the portal that same quarter → ③ divide ① by ②.{' '}
          <i>Example: 12 projects closed in Q2 and 8 people were active → 12 ÷ 8 = 1.5 projects per
          person.</i> Rising = the same team is clearing more work.
        </li>
        <li>
          <b>Rework rate trend (chart), step by step:</b> every time work is sent back for another
          pass ("request changes" during execution, or "reject — send back" at lead review), the
          project's send-back counter goes up by one. When a project closes, it brings that count
          with it: ① take all projects closed in the quarter → ② average their send-back counts.{' '}
          <i>Example: three projects close with 2, 1 and 0 send-backs → (2+1+0) ÷ 3 = 1.0 send-backs
          per project.</i> Falling = review loops are catching less rework.
        </li>
        <li>
          <b>Team flow efficiency (bars), step by step:</b> ① every stage change is timestamped
          automatically, so we know how long a project sat in each stage → ② hands-on stages
          (eligibility review, task setup, execution, lead review) count as <i>active</i>; queue
          stages (awaiting lead decision, ready-for-client) count only toward the total → ③ time on
          hold is removed from both → ④ each attached team's bar = its projects' active time ÷ total
          time. <i>Example: 2d awaiting a lead + 8d execution/reviews + 3d with the client = 8 ÷ 13
          ≈ 62%.</i> Task check-box updates are deliberately not timed — stage timestamps are
          automatic, while task statuses depend on people remembering to update them. Note: a
          project with no team attached counts toward no bar.
        </li>
        <li>
          <b>Active users trend (chart):</b> for each month, distinct people with ≥1 action ÷ how
          many users had been onboarded by that month's end — the adoption trajectory over time.
        </li>
      </KpiDefinitions>
    </main>
  )
}
