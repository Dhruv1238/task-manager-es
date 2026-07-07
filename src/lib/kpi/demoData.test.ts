import { describe, it, expect } from 'vitest'
import { buildKpiDemoData } from './demoData'
import {
  activeUsersSeries,
  cycleTimeSeries,
  onTimeSeries,
  reworkSeries,
  teamFlowEfficiency,
  throughputSeries,
  userStats,
  winRateSeries,
} from './kpiCompute'

// Fixed "now" so assertions are stable regardless of when tests run.
const NOW = new Date(2026, 6, 2).getTime()

describe('buildKpiDemoData → kpiCompute pipeline', () => {
  const demo = buildKpiDemoData(NOW)
  const monthStart = new Date(2026, 6, 1).getTime()

  it('is deterministic', () => {
    const again = buildKpiDemoData(NOW)
    expect(again.projects.length).toBe(demo.projects.length)
    expect(again.projects[0].id).toBe(demo.projects[0].id)
    expect(again.events.length).toBe(demo.events.length)
  })

  it('populates every metric series', () => {
    expect(cycleTimeSeries(demo.projects).length).toBeGreaterThanOrEqual(5)
    expect(onTimeSeries(demo.projects).points.length).toBeGreaterThan(3)
    expect(throughputSeries(demo.projects, demo.events).length).toBeGreaterThanOrEqual(5)
    expect(reworkSeries(demo.projects, false).length).toBeGreaterThanOrEqual(4)
    expect(winRateSeries(demo.projects).length).toBeGreaterThanOrEqual(4)
    expect(teamFlowEfficiency(demo.projects, demo.teams, NOW).length).toBe(4)
  })

  it('tells the improvement story: cycle time falls, rework falls', () => {
    const cyc = cycleTimeSeries(demo.projects)
    expect(cyc[cyc.length - 1].value).toBeLessThan(cyc[0].value)
    const rew = reworkSeries(demo.projects, false)
    expect(rew[rew.length - 1].value).toBeLessThan(rew[0].value)
  })

  it('team efficiencies are distinct and within (0,1)', () => {
    const flow = teamFlowEfficiency(demo.projects, demo.teams, NOW)
    for (const t of flow) {
      expect(t.efficiency).toBeGreaterThan(0)
      expect(t.efficiency).toBeLessThan(1)
    }
    expect(flow[0].efficiency).toBeGreaterThan(flow[flow.length - 1].efficiency)
  })

  it('reports current-month user stats', () => {
    const u = userStats(demo.users, demo.events, monthStart)
    expect(u.total).toBe(13)
    expect(u.active).toBeGreaterThanOrEqual(9)
    expect(u.rate).toBeGreaterThan(0)
    expect(u.rate).toBeLessThanOrEqual(1)
  })

  it('produces a bounded active-users trend anchored at first activity', () => {
    const windowStart = new Date(2025, 3, 1).getTime() // 6 quarters back from 2026-07
    const series = activeUsersSeries(demo.users, demo.events, windowStart, NOW)
    expect(series.length).toBeGreaterThan(0)
    expect(series.length).toBeLessThanOrEqual(16) // ≤ Apr 2025 … Jul 2026
    expect(series[0].active).toBeGreaterThan(0) // leading dead months trimmed
    for (const p of series) {
      expect(p.rate).toBeGreaterThanOrEqual(0)
      expect(p.rate).toBeLessThanOrEqual(1)
      expect(p.onboarded).toBe(13)
    }
  })
})
