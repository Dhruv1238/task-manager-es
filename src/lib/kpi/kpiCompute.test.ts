import { describe, it, expect } from 'vitest'
import type { Project } from '../../types/models'
import type { Timestamp } from 'firebase/firestore'
import {
  activeUsersSeries,
  cycleTime,
  flowEfficiency,
  isWin,
  monthBounds,
  monthKeysInRange,
  onHoldIntervals,
  statusChangeEvents,
  throughputSeries,
  userStats,
  winRateSeries,
} from './kpiCompute'
import type { AuditEvent } from '../../types/models'

const DAY = 86_400_000
// Minimal Timestamp stand-in — kpiCompute reads only .toMillis().
const ts = (ms: number) => ({ toMillis: () => ms }) as unknown as Timestamp

// Status-change stage event: payload carries { from, to }.
const statusEv = (stageId: string, to: string, at: number, from = '') => ({
  kind: 'stage' as const,
  stageId,
  enteredAt: ts(at),
  enteredBy: 'u1',
  payload: { from, to, note: '' },
})

// Genuine stage transition: payload has no `to`.
const stageEv = (stageId: string, at: number) => ({
  kind: 'stage' as const,
  stageId,
  enteredAt: ts(at),
  enteredBy: 'u1',
  payload: null,
})

function project(partial: Partial<Project>): Project {
  return {
    id: 'p1',
    title: 't',
    createdAt: ts(0),
    status: 'in_progress',
    projectHistory: [],
    teamIds: [],
    workflowId: 'collab-default',
    currentStageId: 'created',
    ...partial,
  } as unknown as Project
}

describe('statusChangeEvents', () => {
  it('keeps only status events (payload.to) and sorts by time', () => {
    const p = project({
      projectHistory: [
        stageEv('created', 0),
        statusEv('delivered', 'submitted', 2 * DAY),
        stageEv('in_execution', 1 * DAY), // transition, ignored
        statusEv('delivered', 'awarded', 3 * DAY, 'submitted'),
      ],
    })
    const changes = statusChangeEvents(p)
    expect(changes.map((c) => c.to)).toEqual(['submitted', 'awarded'])
    expect(changes[0].at).toBe(2 * DAY)
  })
})

describe('onHoldIntervals', () => {
  it('opens on on_hold and closes on the next status change', () => {
    const changes = statusChangeEvents(
      project({
        projectHistory: [
          statusEv('s', 'on_hold', 2 * DAY),
          statusEv('s', 'in_progress', 5 * DAY, 'on_hold'),
        ],
      }),
    )
    expect(onHoldIntervals(changes, 10 * DAY)).toEqual([[2 * DAY, 5 * DAY]])
  })

  it('clamps an unclosed hold to the end boundary', () => {
    const changes = statusChangeEvents(
      project({ projectHistory: [statusEv('s', 'on_hold', 4 * DAY)] }),
    )
    expect(onHoldIntervals(changes, 9 * DAY)).toEqual([[4 * DAY, 9 * DAY]])
  })
})

describe('cycleTime', () => {
  it('measures created → submitted minus on-hold', () => {
    const p = project({
      createdAt: ts(0),
      projectHistory: [
        statusEv('s', 'on_hold', 2 * DAY),
        statusEv('s', 'in_progress', 4 * DAY, 'on_hold'), // 2 days on hold
        statusEv('delivered', 'submitted', 10 * DAY, 'in_progress'),
      ],
    })
    const ct = cycleTime(p)
    expect(ct).not.toBeNull()
    expect(ct!.adjustedMs).toBe(8 * DAY) // 10 elapsed - 2 on hold
  })

  it('falls back to first closed status when never submitted', () => {
    const p = project({
      createdAt: ts(0),
      projectHistory: [statusEv('delivered', 'not_submitted', 6 * DAY, 'in_progress')],
    })
    expect(cycleTime(p)!.adjustedMs).toBe(6 * DAY)
  })

  it('returns null when never submitted or closed', () => {
    const p = project({ projectHistory: [statusEv('s', 'on_hold', DAY)] })
    expect(cycleTime(p)).toBeNull()
  })
})

describe('isWin', () => {
  it('is true when an awarded event exists (even if later completed)', () => {
    const p = project({
      status: 'completed',
      projectHistory: [
        statusEv('delivered', 'awarded', 2 * DAY),
        statusEv('delivered', 'completed', 5 * DAY, 'awarded'),
      ],
    })
    expect(isWin(p)).toBe(true)
  })

  it('is true when a project closed straight to completed (no awarded step)', () => {
    const p = project({
      status: 'completed',
      projectHistory: [statusEv('delivered', 'completed', 3 * DAY)],
    })
    expect(isWin(p)).toBe(true)
  })

  it('is false for a lost project', () => {
    const p = project({
      status: 'lost',
      projectHistory: [statusEv('delivered', 'lost', 2 * DAY)],
    })
    expect(isWin(p)).toBe(false)
  })
})

describe('winRateSeries', () => {
  it('counts a win once and buckets by decision quarter', () => {
    const janAwarded = new Date(2026, 0, 15).getTime()
    const p1 = project({ id: 'a', projectHistory: [statusEv('d', 'awarded', janAwarded)] })
    const p2 = project({ id: 'b', projectHistory: [statusEv('d', 'lost', janAwarded)] })
    const series = winRateSeries([p1, p2])
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ quarter: '2026-Q1', awarded: 1, lost: 1, rate: 0.5 })
  })

  it('counts straight-to-completed as a win, dated by that event', () => {
    const feb = new Date(2026, 1, 10).getTime()
    const p = project({ id: 'c', projectHistory: [statusEv('d', 'completed', feb)] })
    expect(winRateSeries([p])[0]).toMatchObject({ quarter: '2026-Q1', awarded: 1, lost: 0, rate: 1 })
  })

  it('does not double-count awarded→completed; decision date = awarded quarter', () => {
    const q1 = new Date(2026, 0, 15).getTime()
    const q2 = new Date(2026, 3, 20).getTime()
    const p = project({
      id: 'd',
      projectHistory: [
        statusEv('d', 'awarded', q1),
        statusEv('d', 'completed', q2, 'awarded'),
      ],
    })
    const series = winRateSeries([p])
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ quarter: '2026-Q1', awarded: 1 })
  })
})

describe('v2 outcomeLog path (authored workflows)', () => {
  // executeOutcome doesn't append {from,to} history events — status changes are
  // reconstructed from outcomeLog + the pinned workflow.
  const pinnedWorkflow = {
    id: 'wf-authored',
    flowType: 'collaborative',
    entryStageId: 'intake',
    stages: [
      {
        id: 'intake',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'record',
            outcomes: [
              { id: 'o-won', label: 'Won', shape: 'close', terminalStatusId: 'completed' },
              { id: 'o-hold', label: 'Hold', shape: 'hold' },
            ],
          },
        ],
      },
      { id: 'build', order: 2, isTerminal: false, actions: [] },
      { id: 'done', order: 3, isTerminal: true, actions: [] },
    ],
  } as unknown as Project['pinnedWorkflow']

  it('derives a close outcome status from terminalStatusId', () => {
    const p = project({
      pinnedWorkflow,
      outcomeLog: [
        { actionId: 'record', outcomeId: 'o-won', shape: 'close', by: 'u1', at: ts(4 * DAY) },
      ],
    } as Partial<Project>)
    const changes = statusChangeEvents(p)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ to: 'completed', at: 4 * DAY })
    expect(isWin(p)).toBe(true)
  })

  it('derives a hold outcome status from the status input', () => {
    const p = project({
      pinnedWorkflow,
      outcomeLog: [
        {
          actionId: 'record',
          outcomeId: 'o-hold',
          shape: 'hold',
          by: 'u1',
          at: ts(2 * DAY),
          inputs: { status: 'on_hold' },
        },
        {
          actionId: 'record',
          outcomeId: 'o-hold',
          shape: 'hold',
          by: 'u1',
          at: ts(5 * DAY),
          inputs: { status: 'in_progress' },
        },
      ],
    } as Partial<Project>)
    const changes = statusChangeEvents(p)
    expect(changes.map((c) => c.to)).toEqual(['on_hold', 'in_progress'])
    expect(onHoldIntervals(changes, 9 * DAY)).toEqual([[2 * DAY, 5 * DAY]])
  })

  it('classifies authored stages structurally: entry & terminal wait, middle is active', () => {
    const p = project({
      pinnedWorkflow,
      status: 'completed',
      projectHistory: [
        stageEv('intake', 0), // entry → waiting
        stageEv('build', 2 * DAY), // middle → active
        stageEv('done', 6 * DAY), // terminal
      ],
      outcomeLog: [
        { actionId: 'record', outcomeId: 'o-won', shape: 'close', by: 'u1', at: ts(6 * DAY) },
      ],
    } as Partial<Project>)
    const { activeMs, totalMs } = flowEfficiency(p, 6 * DAY)
    expect(activeMs).toBe(4 * DAY) // build only
    expect(totalMs).toBe(6 * DAY) // intake 2d (waiting) + build 4d
  })
})

describe('userStats month scoping', () => {
  const auditEv = (actorId: string, at: number) =>
    ({ id: 'e', actorId, createdAt: ts(at) }) as unknown as AuditEvent

  const jan = new Date(2026, 0, 1).getTime()
  const may = new Date(2026, 4, 1).getTime()
  const users = [
    { uid: 'u1', createdAt: ts(jan) },
    { uid: 'u2', createdAt: ts(jan) },
    { uid: 'u3', createdAt: ts(may) }, // onboarded later
  ]
  const events = [
    auditEv('u1', new Date(2026, 2, 10).getTime()), // Mar
    auditEv('u1', new Date(2026, 2, 20).getTime()), // Mar, same actor → counts once
    auditEv('u2', new Date(2026, 3, 5).getTime()), // Apr
    auditEv('u3', new Date(2026, 5, 5).getTime()), // Jun
    auditEv('ghost', new Date(2026, 2, 11).getTime()), // no user doc → ignored
  ]

  it('counts only activity inside the selected month', () => {
    const mar = monthBounds('2026-03')
    expect(userStats(users, events, mar.startMs, mar.endMs).active).toBe(1)
    const apr = monthBounds('2026-04')
    expect(userStats(users, events, apr.startMs, apr.endMs).active).toBe(1)
    const feb = monthBounds('2026-02')
    expect(userStats(users, events, feb.startMs, feb.endMs).active).toBe(0)
  })

  it('measures against the headcount as it stood that month', () => {
    const mar = monthBounds('2026-03')
    expect(userStats(users, events, mar.startMs, mar.endMs).total).toBe(2) // u3 not yet onboarded
    const jun = monthBounds('2026-06')
    const j = userStats(users, events, jun.startMs, jun.endMs)
    expect(j.total).toBe(3)
    expect(j.active).toBe(1)
    expect(j.rate).toBeCloseTo(1 / 3)
  })

  it('defaults to an open-ended window and counts createdAt-less users as onboarded', () => {
    const legacy = [...users, { uid: 'u4' }]
    const s = userStats(legacy, events, jan)
    expect(s.total).toBe(4)
    expect(s.active).toBe(3) // u1, u2, u3 across the whole span
  })
})

describe('month picker range', () => {
  it('enumerates whole months from the window start through now', () => {
    const start = new Date(2026, 3, 1).getTime()
    const now = new Date(2026, 6, 20).getTime()
    expect(monthKeysInRange(start, now)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07'])
  })

  it('spans a year boundary', () => {
    const keys = monthKeysInRange(new Date(2025, 10, 1).getTime(), new Date(2026, 1, 3).getTime())
    expect(keys).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('monthBounds is half-open and matches the next month start', () => {
    expect(monthBounds('2026-02').endMs).toBe(monthBounds('2026-03').startMs)
    expect(monthBounds('2026-12').endMs).toBe(monthBounds('2027-01').startMs)
  })
})

describe('leading-empty trimming (recently launched portal)', () => {
  const auditEv = (actorId: string, at: number) =>
    ({ id: 'e', actorId, createdAt: ts(at) }) as unknown as AuditEvent

  it('activeUsersSeries starts at the first month with activity, keeps later zero months', () => {
    const jan1 = new Date(2026, 0, 1).getTime()
    const jun15 = new Date(2026, 5, 15).getTime()
    const jul2 = new Date(2026, 6, 2).getTime()
    const users = [{ uid: 'u1', createdAt: ts(jan1) }]
    const series = activeUsersSeries(users, [auditEv('u1', jun15)], jan1, jul2)
    // Jan–May trimmed; June (first activity) + July (zero, but post-launch) remain.
    expect(series.map((p) => p.month)).toEqual(['2026-06', '2026-07'])
    expect(series[0].active).toBe(1)
    expect(series[1].active).toBe(0)
  })

  it('throughputSeries drops leading quarters that have actors but no closings', () => {
    const q1Event = auditEv('u1', new Date(2026, 1, 10).getTime()) // 2026-Q1, dev-era activity
    const q2Close = project({
      projectHistory: [statusEv('delivered', 'lost', new Date(2026, 4, 10).getTime())],
    })
    const series = throughputSeries([q2Close], [q1Event])
    expect(series.map((p) => p.quarter)).toEqual(['2026-Q2'])
    expect(series[0].closed).toBe(1)
  })
})

describe('flowEfficiency', () => {
  it('counts active-stage dwell vs total, excluding on-hold', () => {
    // created@0 → in_execution@1d → (on_hold 3d..5d) → delivered@6d, closed(lost)@6d
    const p = project({
      createdAt: ts(0),
      status: 'lost',
      projectHistory: [
        stageEv('created', 0),
        stageEv('in_execution', 1 * DAY),
        statusEv('in_execution', 'on_hold', 3 * DAY, 'in_progress'),
        statusEv('in_execution', 'in_progress', 5 * DAY, 'on_hold'),
        stageEv('delivered', 6 * DAY),
        statusEv('delivered', 'lost', 6 * DAY, 'in_progress'),
      ],
    })
    const { activeMs, totalMs } = flowEfficiency(p, 6 * DAY)
    // Windows: created[0,1d]=1d (waiting), in_execution[1d,6d]=5d minus 2d hold=3d (active),
    // delivered[6d,6d]=0. active=3d, total=1d+3d=4d.
    expect(activeMs).toBe(3 * DAY)
    expect(totalMs).toBe(4 * DAY)
  })
})
