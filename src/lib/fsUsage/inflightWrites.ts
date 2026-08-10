/**
 * THIS TAB's unacknowledged Firestore writes — pure bookkeeping, no firebase
 * imports, no timers.
 *
 * Why this exists: the sync guard must never use waitForPendingWrites() as a
 * steady-state signal. With persistentMultipleTabManager, only the leader tab
 * owns the network; in secondary tabs (every ctrl+click) waitForPendingWrites
 * can hang forever even on a healthy connection — which showed users a
 * permanent "changes aren't reaching the server" overlay in any second tab.
 *
 * Write PROMISES, by contrast, settle correctly in the tab that issued them,
 * in every tab role: fsIntercept registers each write here when issued and
 * clears it when the promise settles (resolve OR reject — a rejection is an
 * answer, not a stall). "My oldest write has had no answer for 20s while the
 * connection listener says connected" is per-tab truth: the only tab that
 * blocks is the one actually losing work.
 */

let nextId = 0
const inflight = new Map<number, number>() // id → issuedAt (ms epoch)

export function writeStarted(nowMs: number = Date.now()): number {
  nextId += 1
  inflight.set(nextId, nowMs)
  return nextId
}

export function writeSettled(id: number): void {
  inflight.delete(id)
}

/** Issue time of the oldest still-unacknowledged write, or null when none. */
export function oldestInflightWriteMs(): number | null {
  let min: number | null = null
  for (const t of inflight.values()) if (min === null || t < min) min = t
  return min
}

export function inflightWriteCount(): number {
  return inflight.size
}

/** Test-only. */
export function __resetInflightForTests(): void {
  inflight.clear()
  nextId = 0
}
