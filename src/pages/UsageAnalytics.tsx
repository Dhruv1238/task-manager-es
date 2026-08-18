import { useState } from 'react'
import { useKpiMetrics } from '../hooks/useKpiMetrics'
import { usePrintable } from '../hooks/usePrintable'
import { monthLabel } from '../lib/kpi/format'
import KpiDefinitions from '../components/charts/KpiDefinitions'
import KpiHeadlineTiles from '../components/charts/KpiHeadlineTiles'
import KpiPageHeader from '../components/charts/KpiPageHeader'
import PrintFooter from '../components/charts/PrintFooter'
import PrintingOverlay from '../components/charts/PrintingOverlay'
import TrendLine from '../components/charts/TrendLine'

// Seeds the Save-as-PDF filename; usePrintable appends the generation stamp.
const PDF_TITLE = 'Show-runner Usage analytics'

/**
 * Adoption + delivery-speed view: the shared headline tiles, then the three
 * month/cohort trends that answer "is the portal being used, and is work
 * getting faster". The throughput / rework / win-rate / team-flow charts stay
 * on KPI Reports.
 */
export default function UsageAnalytics() {
  // Demo mode swaps every metric input for the deterministic in-memory dataset
  // (lib/kpi/demoData) — same compute pipeline, no Firestore writes.
  const [demoMode, setDemoMode] = useState(false)
  // Feeds back into the hook: the active-users tile recomputes per month.
  const [userMonth, setUserMonth] = useState<string | null>(null)
  const { print, preparing, generatedAt } = usePrintable(PDF_TITLE)
  const kpi = useKpiMetrics({ demoMode, userMonth: userMonth ?? undefined })
  const { metrics, loading, collabProjectCount, reportMonths } = kpi

  const cyc = metrics.cycleTime
  const firstCycle = cyc[0]
  const ot = metrics.onTime

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {preparing && <PrintingOverlay />}
      {/* Sheet 1 of the PDF: everything down to the chart grid, with the
          footer pushed to the paper's bottom edge. Inert on screen. */}
      <div className="kpi-print-sheet">
        <KpiPageHeader
          title="Usage Analytics"
          description={
            <>
              Portal adoption and delivery speed over the collaborative flow - who is actually
              working in the portal, and how long work takes to get out.
              {loading ? ' Loading…' : ` ${collabProjectCount} collaborative projects in scope.`}
            </>
          }
          demoMode={demoMode}
          onToggleDemo={() => setDemoMode((v) => !v)}
          onPrint={print}
        />

        <KpiHeadlineTiles kpi={kpi} onUserMonthChange={setUserMonth} />

        <div className="kpi-print-charts grid gap-4 lg:grid-cols-2">
          <TrendLine
            title="On-time submission rate"
            subtitle="On-time ÷ pursued tenders, by month of submission"
            data={ot.points.map((p) => ({ label: p.month, value: p.rate }))}
            percent
          />
          <TrendLine
            title="Cycle-time reduction"
            subtitle="Median days from created to submitted/closed (excl. on-hold), by cohort quarter"
            data={cyc.map((p) => ({ label: p.quarter, value: p.value }))}
            valueSuffix=" d"
            reference={firstCycle ? { value: firstCycle.value, label: 'baseline' } : undefined}
          />
          <TrendLine
            title="Active users trend"
            subtitle="People with ≥1 action ÷ users onboarded by then, by month"
            data={metrics.activeUsers.map((p) => ({ label: p.month, value: p.rate }))}
            percent
          />
        </div>

        <PrintFooter page={1} of={2} generatedAt={generatedAt} />
      </div>

      {/* Definitions — one entry per card, in the order they appear above. */}
      <KpiDefinitions footer={<PrintFooter page={2} of={2} generatedAt={generatedAt} />}>
        <li>
          <b>Win rate (tile):</b> among tenders the client has decided, <i>wins ÷ (wins + lost)</i>.
          A win is a project that ever reached <i>Awarded</i> or <i>Completed</i> — completed means
          the awarded work was delivered, so it counts even when the awarded step was skipped. Each
          project counts once, dated by its first win/loss event. Undecided tenders aren't counted.
        </li>
        <li>
          <b>On-time submission (tile & chart):</b> of the tenders we submitted,{' '}
          <i>submitted before its stored deadline ÷ all submitted</i>, by month of submission. The
          tile's month picker defaults to the most recent month that had a submission, so it never
          shows an older month's rate as if it were this one; the chart plots every month that had
          one (months with none are absent rather than drawn as 0%).
          {ot.unmeasurable > 0 &&
            ` (${ot.unmeasurable} submitted project(s) have no deadline stored and are left out.)`}
        </li>
        <li>
          <b>Active users (tile):</b> people who performed ≥1 recorded action in the portal during
          the selected month (created/updated a project or task, moved a stage…) ÷ everyone
          onboarded by the end of that month. Viewing-only visits aren't counted. The month pickers
          on this page go back to {monthLabel(reportMonths[reportMonths.length - 1])}, where portal
          activity starts; the current month is counted to date, so it reads low until the month
          fills out. The tile's <i>Who's active?</i> button opens the named roster behind the
          ratio for the selected month — active, idle, and a CSV export.
        </li>
        <li>
          <b>Median cycle time (tile) / Cycle-time reduction (chart):</b> for each project, days
          from creation until its pitch went out (or it closed) — minus any time on hold. Projects
          are grouped by the quarter they were <i>created</i>; the chart plots each cohort's median
          (typical) value against the first cohort as baseline.
        </li>
        <li>
          <b>Active users trend (chart):</b> for each month, distinct people with ≥1 action ÷ how
          many users had been onboarded by that month's end — the adoption trajectory over time.
          Leading months with no activity are trimmed; a dip after launch is left visible because a
          real drop in usage is signal.
        </li>
      </KpiDefinitions>
    </main>
  )
}
