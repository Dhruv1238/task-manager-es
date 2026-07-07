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
  onTimeSeries,
  reworkSeries,
  teamFlowEfficiency,
  throughputSeries,
  userStats,
  winRateSeries,
} from '../lib/kpi/kpiCompute'

// Anchors captured once at mount so the windowed audit query + all buckets stay
// stable across renders (a changing windowStart would refire the getDocs read).
function computeAnchors() {
  const nowMs = Date.now()
  const now = new Date(nowMs)
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  // Start of the quarter 6 quarters ago → the default reporting window.
  const q = Math.floor(now.getMonth() / 3)
  const windowStartMs = new Date(now.getFullYear(), q * 3 - 15, 1).getTime()
  return { nowMs, monthStartMs, windowStartMs }
}

export interface UseKpiOptions {
  // Send-backs = iterationCount only (default) or + escalationCount.
  includeEscalations?: boolean
  // Demo mode: swap all inputs for the deterministic in-memory dataset
  // (lib/kpi/demoData). Same compute pipeline, zero Firestore writes.
  demoMode?: boolean
}

export function useKpiMetrics(opts: UseKpiOptions = {}) {
  const includeEscalations = opts.includeEscalations ?? false
  const demoMode = opts.demoMode ?? false
  const [{ nowMs, monthStartMs, windowStartMs }] = useState(computeAnchors)

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
      users: userStats(effUsers, effEvents, monthStartMs),
      activeUsers: activeUsersSeries(effUsers, effEvents, windowStartMs, nowMs),
    }),
    [collabProjects, effEvents, effUsers, effTeams, includeEscalations, nowMs, monthStartMs, windowStartMs],
  )

  return {
    metrics,
    loading: demoMode ? false : projectsLoading || usersLoading || teamsLoading || auditLoading,
    windowStartMs,
    monthStartMs,
    collabProjectCount: collabProjects.length,
  }
}
