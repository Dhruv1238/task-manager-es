/**
 * Firestore usage watchdog — counting engine. Pure bookkeeping: no firebase
 * imports, no timers, no I/O. All state initializes lazily on the first
 * recordOp so importing this module (which every 'firebase/firestore' import
 * now transitively does via the fsIntercept alias) has ZERO side effects —
 * a hard requirement for vitest, where the alias is active too.
 *
 * Windowing: per-collection ring of 6 × 10s slots, each stamped with its
 * wall-clock epoch (floor(now / SLOT_MS)). Slots are advanced lazily inside
 * recordOp — a slot whose epoch is stale is zeroed before use, and window
 * sums only include slots within the last 6 epochs. Idle gaps therefore cost
 * nothing and need no timers.
 *
 * Clock is a parameter (nowMs) so tests drive it deterministically.
 */
import { FS_USAGE } from './thresholds'
import { tripBreaker, type TripReason } from './breaker'

export type FsVerb =
  | 'getDoc'
  | 'getDocs'
  | 'getCount'
  | 'snapInitial'
  | 'snapUpdate'
  | 'subscribe'
  | 'unsubscribe'
  | 'set'
  | 'update'
  | 'delete'
  | 'add'
  | 'batchWrite'
  | 'txnRead'
  | 'txnWrite'

export interface WindowCounts {
  reads: number
  cacheReads: number
  writes: number
  subs: number
  // Snapshot UPDATE DELIVERIES (events, not documents). One cold-load
  // delivery of 5,000 docs counts 1 here; 400 one-doc fan-out deliveries
  // count 400. That's what separates an expensive page from a leak.
  deltas: number
}

export interface OpSample {
  op: FsVerb
  path: string
  tMs: number
  stack?: string
}

const SLOTS = FS_USAGE.WINDOW_MS / FS_USAGE.SLOT_MS // 6

interface Ring {
  epochs: number[]
  reads: number[]
  cacheReads: number[]
  writes: number[]
  subs: number[]
  deltas: number[]
}

interface CollectionState {
  ring: Ring
  session: WindowCounts
  samples: OpSample[] // ring buffer, newest at end
  sampleCursor: number
  activeListeners: number
}

interface UsageState {
  sessionId: string
  startedAtMs: number
  byCollection: Map<string, CollectionState>
  global: Ring
  globalSession: WindowCounts
}

let state: UsageState | null = null

function newRing(): Ring {
  return {
    epochs: new Array<number>(SLOTS).fill(-1),
    reads: new Array<number>(SLOTS).fill(0),
    cacheReads: new Array<number>(SLOTS).fill(0),
    writes: new Array<number>(SLOTS).fill(0),
    subs: new Array<number>(SLOTS).fill(0),
    deltas: new Array<number>(SLOTS).fill(0),
  }
}

function ensureState(): UsageState {
  if (state) return state
  state = {
    sessionId:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}`,
    startedAtMs: Date.now(),
    byCollection: new Map(),
    global: newRing(),
    globalSession: { reads: 0, cacheReads: 0, writes: 0, subs: 0, deltas: 0 },
  }
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__fsUsage = () => getUsageSnapshot()
  }
  return state
}

function ensureCollection(s: UsageState, key: string): CollectionState {
  let c = s.byCollection.get(key)
  if (!c) {
    c = {
      ring: newRing(),
      session: { reads: 0, cacheReads: 0, writes: 0, subs: 0, deltas: 0 },
      samples: [],
      sampleCursor: 0,
      activeListeners: 0,
    }
    s.byCollection.set(key, c)
  }
  return c
}

// Zero the slot if it belongs to an older epoch, then return its index.
function slotFor(ring: Ring, epoch: number): number {
  const i = epoch % SLOTS
  if (ring.epochs[i] !== epoch) {
    ring.epochs[i] = epoch
    ring.reads[i] = 0
    ring.cacheReads[i] = 0
    ring.writes[i] = 0
    ring.subs[i] = 0
    ring.deltas[i] = 0
  }
  return i
}

// Sum a ring's counters across slots still inside the rolling window.
function windowSum(ring: Ring, epoch: number): WindowCounts {
  const out = { reads: 0, cacheReads: 0, writes: 0, subs: 0, deltas: 0 }
  for (let i = 0; i < SLOTS; i++) {
    if (ring.epochs[i] > epoch - SLOTS && ring.epochs[i] <= epoch) {
      out.reads += ring.reads[i]
      out.cacheReads += ring.cacheReads[i]
      out.writes += ring.writes[i]
      out.subs += ring.subs[i]
      out.deltas += ring.deltas[i]
    }
  }
  return out
}

type CounterKey = 'reads' | 'cacheReads' | 'writes' | 'subs'

function counterFor(verb: FsVerb, fromCache: boolean): CounterKey | null {
  switch (verb) {
    case 'getDoc':
    case 'getDocs':
    case 'getCount':
    case 'snapInitial':
    case 'snapUpdate':
    case 'txnRead':
      return fromCache ? 'cacheReads' : 'reads'
    case 'set':
    case 'update':
    case 'delete':
    case 'add':
    case 'batchWrite':
    case 'txnWrite':
      return 'writes'
    case 'subscribe':
      return 'subs'
    case 'unsubscribe':
      return null // gauge-only
  }
}

/**
 * The hot path. Flat args, no object allocation on the common branch.
 * `stack` is optional — the interceptor decides sampling policy at the edge
 * (see stackSampler) and passes the SUBSCRIBE-time stack for deliveries.
 */
export function recordOp(
  verb: FsVerb,
  collection: string,
  count: number,
  fromCache = false,
  path?: string,
  stack?: string,
  nowMs: number = Date.now(),
): void {
  const s = ensureState()
  const c = ensureCollection(s, collection)

  if (verb === 'unsubscribe') {
    c.activeListeners = Math.max(0, c.activeListeners - 1)
    return
  }
  if (verb === 'subscribe') c.activeListeners += 1

  // counterFor can only return null for 'unsubscribe', which returned above.
  const key = counterFor(verb, fromCache)!
  const epoch = Math.floor(nowMs / FS_USAGE.SLOT_MS)
  if (count > 0) {
    const gi = slotFor(s.global, epoch)
    s.global[key][gi] += count
    s.globalSession[key] += count
    const ci = slotFor(c.ring, epoch)
    c.ring[key][ci] += count
    c.session[key] += count
  }

  // Delivery count, independent of how many documents the delivery carried.
  // Counted for cache-served deliveries too: a write loop echoes back as
  // local pending snapshots BEFORE any server ack (and exclusively so while
  // offline), which is precisely when we most want to catch it.
  if (verb === 'snapUpdate') {
    const gi = slotFor(s.global, epoch)
    s.global.deltas[gi] += 1
    s.globalSession.deltas += 1
    const ci = slotFor(c.ring, epoch)
    c.ring.deltas[ci] += 1
    c.session.deltas += 1
  }

  // Sample ring (fixed size, overwrite oldest).
  if (stack || path) {
    const sample: OpSample = { op: verb, path: path ?? collection, tMs: nowMs, stack }
    if (c.samples.length < FS_USAGE.SAMPLE_RING_SIZE) {
      c.samples.push(sample)
    } else {
      c.samples[c.sampleCursor] = sample
      c.sampleCursor = (c.sampleCursor + 1) % FS_USAGE.SAMPLE_RING_SIZE
    }
  }

  // Threshold check — only the touched collection + global (≤ 12 slot adds).
  const cw = windowSum(c.ring, epoch)
  const gw = windowSum(s.global, epoch)
  // Ordered most-diagnostic first: deltas and subs name a churn bug directly,
  // whereas a raw read/write count can also just be an expensive page.
  const reason: TripReason | null =
    cw.deltas > FS_USAGE.PER_COLLECTION_DELTAS_PER_MIN
      ? 'collectionDeltas'
      : cw.subs > FS_USAGE.PER_COLLECTION_SUBS_PER_MIN
        ? 'collectionSubs'
        : cw.writes > FS_USAGE.PER_COLLECTION_WRITES_PER_MIN
          ? 'collectionWrites'
          : cw.reads > FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN
            ? 'collectionReads'
            : gw.deltas > FS_USAGE.GLOBAL_DELTAS_PER_MIN
              ? 'globalDeltas'
              : gw.writes > FS_USAGE.GLOBAL_WRITES_PER_MIN
                ? 'globalWrites'
                : gw.reads > FS_USAGE.GLOBAL_SERVER_READS_PER_MIN
                  ? 'globalReads'
                  : null
  if (reason) {
    tripBreaker(
      {
        sessionId: s.sessionId,
        collection,
        reason,
        windowCounts: cw,
        globalCounts: gw,
        topCollections: topCollections(s, epoch, 8),
        samples: sampleSnapshot(c),
      },
      nowMs,
    )
  }
}

/** True when the collection is past HOT_MODE_FRACTION of its read threshold —
 * the interceptor uses this to escalate read-stack sampling to every op. */
export function isHot(collection: string, nowMs: number = Date.now()): boolean {
  if (!state) return false
  const c = state.byCollection.get(collection)
  if (!c) return false
  const epoch = Math.floor(nowMs / FS_USAGE.SLOT_MS)
  return (
    windowSum(c.ring, epoch).reads >=
    FS_USAGE.HOT_MODE_FRACTION * FS_USAGE.PER_COLLECTION_SERVER_READS_PER_MIN
  )
}

function sampleSnapshot(c: CollectionState): OpSample[] {
  // Ring order → chronological (oldest first).
  return [...c.samples.slice(c.sampleCursor), ...c.samples.slice(0, c.sampleCursor)]
}

function topCollections(
  s: UsageState,
  epoch: number,
  n: number,
): Array<{ collection: string } & WindowCounts> {
  const rows: Array<{ collection: string } & WindowCounts> = []
  for (const [key, c] of s.byCollection) {
    rows.push({ collection: key, ...windowSum(c.ring, epoch) })
  }
  rows.sort((a, b) => b.reads - a.reads || b.writes - a.writes)
  return rows.slice(0, n)
}

export interface UsageSnapshot {
  sessionId: string
  startedAtMs: number
  window: {
    global: WindowCounts
    byCollection: Array<{ collection: string } & WindowCounts>
  }
  session: {
    global: WindowCounts
    byCollection: Array<{ collection: string } & WindowCounts>
  }
  activeListeners: Record<string, number>
}

/** Live table for `window.__fsUsage()` and (later) the /admin/usage page. */
export function getUsageSnapshot(nowMs: number = Date.now()): UsageSnapshot {
  const s = ensureState()
  const epoch = Math.floor(nowMs / FS_USAGE.SLOT_MS)
  const sessionRows: Array<{ collection: string } & WindowCounts> = []
  const listeners: Record<string, number> = {}
  for (const [key, c] of s.byCollection) {
    sessionRows.push({ collection: key, ...c.session })
    if (c.activeListeners > 0) listeners[key] = c.activeListeners
  }
  sessionRows.sort((a, b) => b.reads - a.reads)
  return {
    sessionId: s.sessionId,
    startedAtMs: s.startedAtMs,
    window: {
      global: windowSum(s.global, epoch),
      byCollection: topCollections(s, epoch, Number.POSITIVE_INFINITY),
    },
    session: { global: { ...s.globalSession }, byCollection: sessionRows },
    activeListeners: listeners,
  }
}

/** Test-only: drop all state so each test starts cold. */
export function __resetForTests(): void {
  state = null
}
