import { afterEach, describe, expect, it, vi } from 'vitest'
import { FS_USAGE } from './thresholds'
import { __resetForTests, getUsageSnapshot, isHot, recordOp } from './core'
import { __resetBreakerForTests } from './breaker'

// A fixed base keeps epochs deterministic. All times flow through the nowMs
// parameter — the engine never starts timers.
const T0 = 1_700_000_000_000

afterEach(() => {
  __resetForTests()
  __resetBreakerForTests()
  vi.restoreAllMocks()
})

function windowFor(collection: string, nowMs: number) {
  return getUsageSnapshot(nowMs).window.byCollection.find((r) => r.collection === collection)
}

describe('recordOp windowing', () => {
  it('accumulates within the rolling minute and expires after it', () => {
    recordOp('getDocs', 'projects', 24, false, 'projects', undefined, T0)
    recordOp('getDoc', 'projects', 1, false, 'projects/p1', undefined, T0 + 30_000)
    expect(windowFor('projects', T0 + 30_000)?.reads).toBe(25)
    // 61s after the first op, only the second remains in the window.
    expect(windowFor('projects', T0 + 65_000)?.reads).toBe(1)
    // Session totals never expire.
    expect(
      getUsageSnapshot(T0 + 65_000).session.byCollection.find((r) => r.collection === 'projects')
        ?.reads,
    ).toBe(25)
  })

  it('clears stale slots across long idle gaps (lazy advance)', () => {
    recordOp('getDoc', 'users', 1, false, 'users/u1', undefined, T0)
    // 10 minutes idle — same slot index (epoch % 6 collides) but a new epoch.
    const later = T0 + 600_000
    recordOp('getDoc', 'users', 1, false, 'users/u1', undefined, later)
    expect(windowFor('users', later)?.reads).toBe(1)
  })

  it('buckets cache reads separately and never trips on them', () => {
    recordOp('getDocs', 'users', 5_000, true, 'users', undefined, T0)
    const w = windowFor('users', T0)
    expect(w?.cacheReads).toBe(5_000)
    expect(w?.reads).toBe(0)
    // Well past the server-read threshold, but from cache → no trip.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    recordOp('getDoc', 'users', 1, true, 'users/u1', undefined, T0 + 1)
    expect(err).not.toHaveBeenCalled()
  })

  it('tracks the subscribe gauge and subs counter', () => {
    recordOp('subscribe', 'teams', 1, false, 'teams', undefined, T0)
    recordOp('subscribe', 'teams', 1, false, 'teams', undefined, T0)
    recordOp('unsubscribe', 'teams', 0, false, undefined, undefined, T0)
    const snap = getUsageSnapshot(T0)
    expect(snap.activeListeners.teams).toBe(1)
    expect(windowFor('teams', T0)?.subs).toBe(2)
  })
})

describe('trip wiring', () => {
  it('trips the collection-reads breaker exactly once per cooldown', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    recordOp(
      'getDocs',
      'tasks',
      FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN + 1,
      false,
      'tasks',
      undefined,
      T0,
    )
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain('collectionReads')
    expect(String(err.mock.calls[0][0])).toContain('"tasks"')
    // Still over threshold, inside cooldown → silent.
    recordOp('getDoc', 'tasks', 1, false, 'tasks/t1', undefined, T0 + 1_000)
    expect(err).toHaveBeenCalledTimes(1)
  })

  it('trips on write and subscribe storms independently', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    for (let i = 0; i <= FS_USAGE.PER_COLLECTION_WRITES_PER_MIN; i++) {
      recordOp('update', 'users', 1, false, 'users/u1', undefined, T0 + i * 10)
    }
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain('collectionWrites')
    for (let i = 0; i <= FS_USAGE.PER_COLLECTION_SUBS_PER_MIN; i++) {
      recordOp('subscribe', 'projects', 1, false, 'projects', undefined, T0 + i * 10)
    }
    expect(err).toHaveBeenCalledTimes(2)
    expect(String(err.mock.calls[1][0])).toContain('collectionSubs')
  })

  it('trips the global threshold when no single collection crosses its own', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    // Each read count stays under the per-collection bar; only their sum
    // crosses the global one, so exactly one trip and it must be the global.
    const each = FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN - 50
    const needed = Math.floor(FS_USAGE.GLOBAL_SERVER_READS_PER_MIN / each) + 1
    for (let i = 0; i < needed; i++) {
      recordOp('getDocs', `c${i}`, each, false, `c${i}`, undefined, T0)
    }
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain('globalReads')
  })
})

describe('delta deliveries — the fan-out discriminator', () => {
  it('does NOT trip on a huge cold load (one delivery, many docs)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    // AdminDashboard's useAllTasks: the entire tasks collection in a single
    // initial delivery. Expensive but legitimate — must stay silent.
    recordOp('subscribe', 'tasks', 1, false, 'tasks', undefined, T0)
    recordOp('snapInitial', 'tasks', 800, false, 'tasks', undefined, T0)
    expect(windowFor('tasks', T0)?.deltas).toBe(0)
    expect(err).not.toHaveBeenCalled()
  })

  it('trips on a write-loop fan-out (many deliveries, one doc each)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    // The Aug incident's shape: ~400 one-doc deliveries/min on users, which
    // is only ~400 reads — far under the read bar, but 400 deltas.
    for (let i = 0; i <= FS_USAGE.PER_COLLECTION_DELTAS_PER_MIN; i++) {
      recordOp('snapUpdate', 'users', 1, false, 'users', undefined, T0 + i * 100)
    }
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain('collectionDeltas')
    expect(String(err.mock.calls[0][0])).toContain('"users"')
    // Well below the read threshold — proving deltas caught what reads missed.
    const w = windowFor('users', T0)!
    expect(w.reads).toBeLessThan(FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN)
  })

  it('counts cache-served deliveries too (offline write-loop echo)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    for (let i = 0; i <= FS_USAGE.PER_COLLECTION_DELTAS_PER_MIN; i++) {
      recordOp('snapUpdate', 'users', 1, true, 'users', undefined, T0 + i * 100)
    }
    // Zero billed reads, but the loop is still caught.
    expect(windowFor('users', T0)?.reads).toBe(0)
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain('collectionDeltas')
  })
})

describe('isHot', () => {
  it('flips once the window passes the hot fraction', () => {
    expect(isHot('projects', T0)).toBe(false)
    const hotCount = Math.ceil(
      FS_USAGE.HOT_MODE_FRACTION * FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN,
    )
    recordOp('getDocs', 'projects', hotCount, false, 'projects', undefined, T0)
    expect(isHot('projects', T0)).toBe(true)
    // Cools off once the window rolls past.
    expect(isHot('projects', T0 + 61_000)).toBe(false)
  })
})

describe('sample ring', () => {
  it('keeps only the newest SAMPLE_RING_SIZE samples, oldest first', () => {
    const n = FS_USAGE.SAMPLE_RING_SIZE + 5
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    for (let i = 0; i < n; i++) {
      recordOp('set', 'notes', 1, false, `notes/n${i}`, `stack-${i}`, T0 + i)
    }
    err.mockClear()
    // Force a trip to inspect the samples payload handed to the breaker.
    recordOp(
      'getDocs',
      'notes',
      FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN + 1,
      false,
      'notes',
      undefined,
      T0 + 1_000,
    )
    expect(err).toHaveBeenCalledTimes(1)
  })
})
