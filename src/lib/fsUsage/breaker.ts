/**
 * Firestore usage watchdog — trip logic. REPORT-ONLY by product decision:
 * a trip logs a console summary and writes one rate-limited report doc to
 * `clientOpsReports`; it never blocks or throws into app code.
 *
 * Layered rate limits so the watchdog can't become its own spike:
 *  1. Per-tab in-memory cooldown per collection key (sync, checked first).
 *  2. Per-tab session cap (MAX_REPORTS_PER_SESSION).
 *  3. Per-user cross-tab cooldown in localStorage ('fsUsage:v1:{uid}',
 *     chatSyncState conventions) — consumed inside report.ts once auth is
 *     known. Two tabs tripping in the same instant can race this and write
 *     two docs; acceptable, the in-memory gates bound the damage.
 *
 * report.ts is loaded ONLY via dynamic import at trip time — it is the sole
 * fsUsage module that touches Firestore, and by the time anything can trip,
 * firebase.ts/firestore.ts are long initialized (no static cycle).
 */
import { FS_USAGE } from './thresholds'
import type { OpSample, WindowCounts } from './core'

export type TripReason =
  // Snapshot-update DELIVERY storms — the sharpest "something is looping"
  // signal, and the one that catches a write-loop fanned out over a
  // collection listener (the Aug incident's shape).
  | 'collectionDeltas'
  | 'globalDeltas'
  | 'collectionSubs'
  | 'collectionWrites'
  | 'globalWrites'
  | 'collectionReads'
  | 'globalReads'

export interface TripInfo {
  sessionId: string
  collection: string
  reason: TripReason
  windowCounts: WindowCounts
  globalCounts: WindowCounts
  topCollections: Array<{ collection: string } & WindowCounts>
  samples: OpSample[]
}

// Per-tab state. Deliberately module-level and NOT persisted: a reload
// re-arms the breaker, which is what you want when investigating.
let nextAttemptByKey = new Map<string, number>()
let reportsThisSession = 0

export function tripBreaker(info: TripInfo, nowMs: number = Date.now()): void {
  try {
    const key = `${info.reason}:${info.collection}`
    const nextAllowed = nextAttemptByKey.get(key) ?? 0
    if (nowMs < nextAllowed) return
    // Optimistically claim the full cooldown; an unreported trip (no auth yet)
    // shortens it below so the report isn't lost forever.
    nextAttemptByKey.set(key, nowMs + FS_USAGE.REPORT_COOLDOWN_PER_COLLECTION_MS)

    // Always visible in the console, report or not.
    console.error(
      `[fsUsage] circuit breaker tripped — ${info.reason} on "${info.collection}": ` +
        `${info.windowCounts.reads} server reads, ${info.windowCounts.cacheReads} cache reads, ` +
        `${info.windowCounts.writes} writes, ${info.windowCounts.subs} subscribes, ` +
        `${info.windowCounts.deltas} snapshot deliveries in the last 60s.`,
    )
    if (typeof console.table === 'function') console.table(info.topCollections)

    // RESERVE the session slot synchronously. Incrementing only after the
    // await would let several trips on distinct keys race past the cap
    // together (the per-key cooldown can't gate them — different keys).
    // Anything that doesn't end in a written report gives the slot back.
    if (reportsThisSession >= FS_USAGE.MAX_REPORTS_PER_SESSION) return
    reportsThisSession += 1

    void import('./report')
      .then((m) => m.writeReport(info))
      .then((outcome) => {
        if (outcome === 'written') return
        reportsThisSession = Math.max(0, reportsThisSession - 1)
        // 'no-auth' (too early in boot) and 'failed' (e.g. rules not deployed
        // for clientOpsReports) are both retryable — re-arm sooner than the
        // full cooldown so the trip isn't silently lost. 'cooldown' means
        // another tab already reported it; leave the full claim in place.
        if (outcome === 'no-auth' || outcome === 'failed') {
          nextAttemptByKey.set(key, nowMs + FS_USAGE.RETRY_UNREPORTED_TRIP_MS)
        }
      })
      .catch(() => {
        reportsThisSession = Math.max(0, reportsThisSession - 1)
      })
  } catch {
    // The watchdog must never throw into the op that tripped it.
  }
}

// ── Cross-tab per-user cooldown store (called from report.ts) ──────────────

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

const STORE_PREFIX = 'fsUsage:v1:'

/**
 * Consume one report slot for (uid, collection). Returns false when a report
 * for this collection was already written inside the cooldown window (by any
 * tab of this user). Storage failures (quota, private mode) default to ALLOW —
 * the in-memory gates above already bound volume.
 */
export function consumeReportSlot(
  uid: string,
  collection: string,
  nowMs: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return true
  const key = STORE_PREFIX + uid
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}') as {
      reports?: Record<string, number>
    }
    const reports = parsed.reports ?? {}
    const last = reports[collection] ?? 0
    if (nowMs - last < FS_USAGE.REPORT_COOLDOWN_PER_COLLECTION_MS) return false
    reports[collection] = nowMs
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, reports }))
    return true
  } catch {
    return true
  }
}

/** Test-only: reset per-tab breaker state. */
export function __resetBreakerForTests(): void {
  nextAttemptByKey = new Map()
  reportsThisSession = 0
}
