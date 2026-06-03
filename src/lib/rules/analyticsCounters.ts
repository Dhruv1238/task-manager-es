/**
 * Phase 3 analytics counters — query-ready denormalisation.
 *
 * Firestore has no GROUP BY, so dashboards (a later phase) read pre-aggregated
 * counters. These are maintained inside the SAME writeBatch that performs an
 * action so they can never drift. Shared by performAction (legacy path) and
 * executeOutcome (v2 path) — one implementation, one source of truth.
 */

import { increment, serverTimestamp, Timestamp, type WriteBatch } from 'firebase/firestore'
import { tenantDoc } from '../firestore'

// Adjust the tenant-level status tally at /config/analytics inside the caller's
// batch. No-op when the status didn't change. set+merge with a nested map so the
// increments compose without clobbering sibling counters.
export function bumpStatusTally(
  batch: WriteBatch,
  oldStatus: string | undefined | null,
  newStatus: string | undefined | null,
): void {
  if (!newStatus || oldStatus === newStatus) return
  const tally: Record<string, unknown> = { [newStatus]: increment(1) }
  if (oldStatus) tally[oldStatus] = increment(-1)
  batch.set(
    tenantDoc('config', 'analytics'),
    { statusTally: tally, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// Patch fragment that stamps the per-project stage-entry time. Dot-path key, so
// it must be applied via batch.update (not set) — both performAction and
// executeOutcome use update. Timestamp.now() (not serverTimestamp) because the
// value lives inside a map field.
export function stageEnteredPatch(stageId: string): Record<string, unknown> {
  return { [`stageEnteredAt.${stageId}`]: Timestamp.now() }
}
