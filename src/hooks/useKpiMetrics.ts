import { useMemo, useState } from 'react'
import { useAllProjects } from './useAllProjects'
import { useAllUsers } from './useAllUsers'
import { useAllTeams } from './useAllTeams'
import { useAuditEvents } from './useAuditEvents'
import { useActiveWorkflows } from '../contexts/AppConfigContext'
import { buildKpiDemoData } from '../lib/kpi/demoData'
import {
  activeUsersSeries,
  cycleTimeSeries,
  monthBounds,
  monthKey,
  monthKeysInRange,
  onTimeSeries,
  reworkSeries,
  teamFlowEfficiency,
  throughputSeries,
  userStats,
  winRateSeries,
} from '../lib/kpi/kpiCompute'

// Earliest month the per-tile month pickers offer. The audit window reaches
// further back (6 quarters), but the portal has no meaningful activity before
// this — those months would render a confident zero rather than "no data".
// Raise it if the data floor ever moves; the pickers and the definitions notes
// both read from here.
const REPORT_MONTH_FLOOR = '2026-05'

// Anchors captured once at mount so the windowed audit query + all buckets stay
// stable across renders (a changing windowStart would refire the getDocs read).
function computeAnchors() {
  const nowMs = Date.now()
  const now = new Date(nowMs)
  // Start of the quarter 6 quarters ago → the default reporting window.
  const q = Math.floor(now.getMonth() / 3)
  const windowStartMs = new Date(now.getFullYear(), q * 3 - 15, 1).getTime()
  return { nowMs, windowStartMs }
}

export interface UseKpiOptions {
  // Send-backs = iterationCount only (default) or + escalationCount.
  includeEscalations?: boolean
  // Demo mode: swap all inputs for the deterministic in-memory dataset
  // (lib/kpi/demoData). Same compute pipeline, zero Firestore writes.
  demoMode?: boolean
  // Month ('YYYY-MM') the active-users tile reports on. Defaults to the current
  // month, and anything outside the offered range falls back to it.
  userMonth?: string
}

// Everything the KPI surfaces need from one hook call. Both report pages pass
// this object straight to the shared tile row / definitions, so the Firestore
// listeners are opened once per page rather than once per component.
export type KpiData = ReturnType<typeof useKpiMetrics>

export function useKpiMetrics(opts: UseKpiOptions = {}) {
  const includeEscalations = opts.includeEscalations ?? false
  const demoMode = opts.demoMode ?? false
  const [{ nowMs, windowStartMs }] = useState(computeAnchors)

  // Selectable months, newest first — the current month heads the list. Shared
  // by every month-scoped tile so the page reads one range. Floored at
  // REPORT_MONTH_FLOOR but never past `now`, so the list always offers at least
  // the current month even if the floor is later moved forward.
  const reportMonths = useMemo(() => {
    const floorMs = Math.max(windowStartMs, monthBounds(REPORT_MONTH_FLOOR).startMs)
    return monthKeysInRange(Math.min(floorMs, nowMs), nowMs).reverse()
  }, [windowStartMs, nowMs])
  const currentMonth = monthKey(nowMs)
  const userMonth =
    opts.userMonth && reportMonths.includes(opts.userMonth) ? opts.userMonth : currentMonth
  const { startMs: monthStartMs, endMs: monthEndMs } = useMemo(
    () => monthBounds(userMonth),
    [userMonth],
  )

  const { projects, loading: projectsLoading } = useAllProjects()
  const { users, loading: usersLoading } = useAllUsers()
  const { teams, loading: teamsLoading } = useAllTeams()
  const { events, loading: auditLoading } = useAuditEvents(windowStartMs)

  const demo = useMemo(() => (demoMode ? buildKpiDemoData(nowMs) : null), [demoMode, nowMs])

  // Scope: every collaborative-flow project — the seeded collab workflow AND
  // authored workflows (the canvas authors flowType 'collaborative'). Resolved
  // from the project's pinned snapshot first (survives workflow retirement),
  // falling back to the active-workflows registry for pre-pinning projects.
  const { workflows } = useActiveWorkflows()
  const collabProjects = useMemo(() => {
    if (demo) return demo.projects
    const flowTypeById = new Map(workflows.map((w) => [w.id, w.flowType]))
    return projects.filter(
      (p) => (p.pinnedWorkflow?.flowType ?? flowTypeById.get(p.workflowId)) === 'collaborative',
    )
  }, [demo, projects, workflows])
  const effUsers = demo?.users ?? users
  const effTeams = demo?.teams ?? teams
  const effEvents = demo?.events ?? events

  const metrics = useMemo(
    () => ({
      cycleTime: cycleTimeSeries(collabProjects),
      onTime: onTimeSeries(collabProjects),
      throughput: throughputSeries(collabProjects, effEvents),
      rework: reworkSeries(collabProjects, includeEscalations),
      winRate: winRateSeries(collabProjects),
      teamFlow: teamFlowEfficiency(collabProjects, effTeams, nowMs),
      users: userStats(effUsers, effEvents, monthStartMs, monthEndMs),
      activeUsers: activeUsersSeries(effUsers, effEvents, windowStartMs, nowMs),
    }),
    [
      collabProjects,
      effEvents,
      effUsers,
      effTeams,
      includeEscalations,
      nowMs,
      monthStartMs,
      monthEndMs,
      windowStartMs,
    ],
  )

  return {
    metrics,
    loading: demoMode ? false : projectsLoading || usersLoading || teamsLoading || auditLoading,
    windowStartMs,
    // Bounds of the month the users tile reports on (the selected one).
    monthStartMs,
    monthEndMs,
    userMonth,
    reportMonths,
    currentMonth,
    collabProjectCount: collabProjects.length,
  }
}
