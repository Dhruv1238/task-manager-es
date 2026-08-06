import { afterEach, describe, expect, it, vi } from 'vitest'
import { FS_USAGE } from './thresholds'
import { __resetBreakerForTests, consumeReportSlot, tripBreaker, type TripInfo } from './breaker'

const T0 = 1_700_000_000_000

function info(partial?: Partial<TripInfo>): TripInfo {
  return {
    sessionId: 'test-session',
    collection: 'tasks',
    reason: 'collectionReads',
    windowCounts: { reads: 2_000, cacheReads: 0, writes: 0, subs: 0, deltas: 0 },
    globalCounts: { reads: 2_000, cacheReads: 0, writes: 0, subs: 0, deltas: 0 },
    topCollections: [{ collection: 'tasks', reads: 2_000, cacheReads: 0, writes: 0, subs: 0, deltas: 0 }],
    samples: [],
    ...partial,
  }
}

afterEach(() => {
  __resetBreakerForTests()
  vi.restoreAllMocks()
})

describe('tripBreaker in-memory gating', () => {
  it('logs on first trip, suppresses within the per-tab cooldown', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    tripBreaker(info(), T0)
    tripBreaker(info(), T0 + 1_000)
    tripBreaker(info(), T0 + FS_USAGE.REPORT_COOLDOWN_PER_COLLECTION_MS - 1)
    expect(err).toHaveBeenCalledTimes(1)
    tripBreaker(info(), T0 + FS_USAGE.REPORT_COOLDOWN_PER_COLLECTION_MS + 1)
    expect(err).toHaveBeenCalledTimes(2)
  })

  it('gates per (reason, collection) key independently', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    tripBreaker(info(), T0)
    tripBreaker(info({ collection: 'users' }), T0)
    tripBreaker(info({ reason: 'collectionWrites' }), T0)
    expect(err).toHaveBeenCalledTimes(3)
  })

  it('never throws even if console.table is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const orig = console.table
    // @ts-expect-error deliberately removing it
    console.table = undefined
    try {
      expect(() => tripBreaker(info(), T0)).not.toThrow()
    } finally {
      console.table = orig
    }
  })
})

describe('consumeReportSlot (cross-tab localStorage cooldown)', () => {
  function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
    const m = new Map<string, string>()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
    }
  }

  it('allows the first report, blocks repeats inside the cooldown', () => {
    const store = memStorage()
    expect(consumeReportSlot('u1', 'tasks', T0, store)).toBe(true)
    expect(consumeReportSlot('u1', 'tasks', T0 + 1_000, store)).toBe(false)
    expect(
      consumeReportSlot('u1', 'tasks', T0 + FS_USAGE.REPORT_COOLDOWN_PER_COLLECTION_MS + 1, store),
    ).toBe(true)
  })

  it('separates collections and users', () => {
    const store = memStorage()
    expect(consumeReportSlot('u1', 'tasks', T0, store)).toBe(true)
    expect(consumeReportSlot('u1', 'users', T0, store)).toBe(true)
    expect(consumeReportSlot('u2', 'tasks', T0, store)).toBe(true)
  })

  it('defaults to allow on storage failure or absence', () => {
    expect(consumeReportSlot('u1', 'tasks', T0, null)).toBe(true)
    const broken = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(consumeReportSlot('u1', 'tasks', T0, broken)).toBe(true)
  })

  it('survives corrupt JSON in the store', () => {
    const store = memStorage()
    store.setItem('fsUsage:v1:u1', '{not json')
    expect(consumeReportSlot('u1', 'tasks', T0, store)).toBe(true)
  })
})
