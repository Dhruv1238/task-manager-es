import { describe, it, expect } from 'vitest'
import type { Timestamp } from 'firebase/firestore'
import type { TimeEntry } from '../types/models'
import {
  dailyTotals,
  filterTimeEntries,
  groupTimeEntries,
  summarizeTimeEntries,
} from './timeReport'

// Minimal Timestamp stand-in — the pivot layer never reads createdAt.
const ts = { toMillis: () => 0 } as unknown as Timestamp

let seq = 0
function entry(over: Partial<TimeEntry>): TimeEntry {
  seq += 1
  return {
    id: `e${seq}`,
    uid: 'u1',
    userName: 'Ada',
    taskId: 't1',
    taskTitle: 'Build stand',
    projectId: 'p1',
    projectTitle: 'Expo 2026',
    teamId: 'team1',
    minutes: 60,
    dateKey: '2026-08-24',
    createdAt: ts,
    ...over,
  }
}

// Two people, two projects, three days.
const FIXTURE: TimeEntry[] = [
  entry({ uid: 'u1', userName: 'Ada', projectId: 'p1', projectTitle: 'Expo', minutes: 120, dateKey: '2026-08-24' }),
  entry({ uid: 'u1', userName: 'Ada', projectId: 'p2', projectTitle: 'Gala', minutes: 30, dateKey: '2026-08-24' }),
  entry({ uid: 'u1', userName: 'Ada', projectId: 'p1', projectTitle: 'Expo', minutes: 45, dateKey: '2026-08-23' }),
  entry({ uid: 'u2', userName: 'Bo', projectId: 'p1', projectTitle: 'Expo', minutes: 200, dateKey: '2026-08-22' }),
]

describe('filterTimeEntries', () => {
  it('passes everything through when no filter is set', () => {
    expect(filterTimeEntries(FIXTURE, {})).toBe(FIXTURE)
    expect(filterTimeEntries(FIXTURE, { uid: null, projectId: null })).toBe(FIXTURE)
  })

  it('narrows by person, project, and both together', () => {
    expect(filterTimeEntries(FIXTURE, { uid: 'u1' })).toHaveLength(3)
    expect(filterTimeEntries(FIXTURE, { projectId: 'p1' })).toHaveLength(3)
    expect(filterTimeEntries(FIXTURE, { uid: 'u1', projectId: 'p1' })).toHaveLength(2)
    expect(filterTimeEntries(FIXTURE, { uid: 'u2', projectId: 'p2' })).toHaveLength(0)
  })
})

describe('summarizeTimeEntries', () => {
  it('totals minutes and counts distinct people and days', () => {
    expect(summarizeTimeEntries(FIXTURE)).toEqual({
      minutes: 395,
      entryCount: 4,
      people: 2,
      days: 3,
    })
  })

  it('handles an empty window', () => {
    expect(summarizeTimeEntries([])).toEqual({ minutes: 0, entryCount: 0, people: 0, days: 0 })
  })
})

describe('groupTimeEntries', () => {
  it('groups per person, ranked by time spent', () => {
    const rows = groupTimeEntries(FIXTURE, 'user')
    expect(rows.map((r) => [r.label, r.minutes])).toEqual([
      ['Bo', 200],
      ['Ada', 195],
    ])
    expect(rows[0].uid).toBe('u2')
    expect(rows[1].entryCount).toBe(3)
    expect(rows[0].people).toBe(1)
  })

  it('groups per project across people', () => {
    const rows = groupTimeEntries(FIXTURE, 'project')
    expect(rows.map((r) => [r.label, r.minutes, r.people])).toEqual([
      ['Expo', 365, 2],
      ['Gala', 30, 1],
    ])
    expect(rows[0].projectId).toBe('p1')
  })

  it('groups per day, newest day first', () => {
    const rows = groupTimeEntries(FIXTURE, 'day')
    expect(rows.map((r) => [r.dateKey, r.minutes])).toEqual([
      ['2026-08-24', 150],
      ['2026-08-23', 45],
      ['2026-08-22', 200],
    ])
  })

  it('crosses person with project', () => {
    const rows = groupTimeEntries(FIXTURE, 'userProject')
    expect(rows.map((r) => [r.label, r.sublabel, r.minutes])).toEqual([
      ['Bo', 'Expo', 200],
      ['Ada', 'Expo', 165],
      ['Ada', 'Gala', 30],
    ])
    expect(rows[0].key).not.toBe(rows[1].key)
  })

  it('crosses person with day, newest day first then biggest contributor', () => {
    const rows = groupTimeEntries(FIXTURE, 'userDay')
    expect(rows.map((r) => [r.label, r.dateKey, r.minutes])).toEqual([
      ['Ada', '2026-08-24', 150],
      ['Ada', '2026-08-23', 45],
      ['Bo', '2026-08-22', 200],
    ])
  })

  it('carries the raw entries behind every total, newest work day first', () => {
    const ada = groupTimeEntries(FIXTURE, 'user').find((r) => r.uid === 'u1')!
    expect(ada.entries).toHaveLength(3)
    expect(ada.entries.reduce((s, e) => s + e.minutes, 0)).toBe(ada.minutes)
    expect(ada.entries.map((e) => e.dateKey)).toEqual([
      '2026-08-24',
      '2026-08-24',
      '2026-08-23',
    ])
  })

  it('returns no rows for an empty window', () => {
    expect(groupTimeEntries([], 'user')).toEqual([])
    expect(groupTimeEntries([], 'userDay')).toEqual([])
  })

  it('keeps a single entry intact in every mode', () => {
    const one = [entry({ minutes: 15 })]
    for (const mode of ['user', 'project', 'day', 'userProject', 'userDay'] as const) {
      const rows = groupTimeEntries(one, mode)
      expect(rows).toHaveLength(1)
      expect(rows[0].minutes).toBe(15)
      expect(rows[0].entryCount).toBe(1)
      expect(rows[0].entries).toHaveLength(1)
    }
  })

  it('falls back to a placeholder when a denormalized name is missing', () => {
    const rows = groupTimeEntries([entry({ userName: '  ', projectTitle: '' })], 'userProject')
    expect(rows[0].label).toBe('Unknown user')
    expect(rows[0].sublabel).toBe('Untitled project')
  })

  it('never loses minutes: every mode re-sums to the same total', () => {
    const total = summarizeTimeEntries(FIXTURE).minutes
    for (const mode of ['user', 'project', 'day', 'userProject', 'userDay'] as const) {
      const summed = groupTimeEntries(FIXTURE, mode).reduce((s, r) => s + r.minutes, 0)
      expect(summed).toBe(total)
    }
  })
})

describe('dailyTotals', () => {
  it('runs chronologically for the chart axis', () => {
    expect(dailyTotals(FIXTURE).map((d) => [d.dateKey, d.minutes])).toEqual([
      ['2026-08-22', 200],
      ['2026-08-23', 45],
      ['2026-08-24', 150],
    ])
  })

  it('omits untouched days rather than zero-filling', () => {
    const sparse = [entry({ dateKey: '2026-08-01' }), entry({ dateKey: '2026-08-20' })]
    expect(dailyTotals(sparse)).toHaveLength(2)
  })
})
