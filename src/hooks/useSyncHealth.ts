import { useEffect, useRef, useState } from 'react'
import { onSnapshot, waitForPendingWrites } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { tenantDoc } from '../lib/firestore'

/**
 * Connection/sync health for the SyncGuardOverlay. Three unhealthy states:
 *
 *  - 'offline'  — the Firestore client has lost its server connection,
 *    sustained past a grace period (blips: wifi AP handoffs, sleep/wake).
 *  - 'stalled'  — connected, but locally-queued writes haven't been acked for
 *    STALLED_AFTER_MS. Normal write RTT is <1s and nothing in this app does a
 *    legitimately slow Firestore write (file uploads go to the external asset
 *    service), so 20s of silence is unambiguous failure.
 *  - 'flushing' — at boot, a PREVIOUS session left queued writes behind. The
 *    direct fix for the project that synced four days late: the app holds
 *    until that queue drains instead of letting new work pile onto it.
 *
 * CONNECTION TRUTH comes from the SDK itself, not from navigator.onLine and
 * not from a synthetic ping. A dedicated one-doc listener (config/appConfig,
 * includeMetadataChanges) receives `fromCache: true` the moment the client
 * loses the backend and `fromCache: false` when it reconnects — the SDK's own
 * view of the exact channel the app's traffic rides on. navigator.onLine is
 * kept only as a fast accelerator where it's trustworthy: `false` means
 * offline now; `true` means nothing (Windows boxes with WSL2/Hyper-V/VPN
 * virtual adapters report online with the wifi off).
 *
 * WRITE-QUEUE truth rides on waitForPendingWrites(db): resolves when every
 * write pending AT CALL TIME is acked — immediately when the queue is empty.
 * Raced against a timer; the timer winning means writes are stuck. One probe
 * in flight at a time, polled only while the tab is visible. Its promise
 * REJECTS on auth change (sign-out cancels the wait) — treated as healthy.
 *
 * `enabled` gates everything (the syncGuard feature toggle, org-wide remote
 * kill switch): disabled → no listeners, no timers, always 'healthy'.
 */

export type SyncHealthStatus = 'healthy' | 'offline' | 'stalled' | 'flushing'

export const OFFLINE_GRACE_MS = 8_000
export const STALLED_AFTER_MS = 20_000
export const BOOT_FLUSH_PROBE_MS = 3_000
// How often to re-probe the pending-write queue while visible and connected.
const POLL_EVERY_MS = 15_000

export interface SyncHealth {
  status: SyncHealthStatus
  // When the current unhealthy status began (ms epoch); null while healthy.
  sinceMs: number | null
}

const HEALTHY: SyncHealth = { status: 'healthy', sinceMs: null }

export function useSyncHealth(enabled: boolean): SyncHealth {
  const [health, setHealth] = useState<SyncHealth>(HEALTHY)

  // One mutable bag per mount; the effect below is the only writer.
  const refs = useRef<{
    graceTimer: ReturnType<typeof setTimeout> | null
    probing: boolean
    // Current SDK connection view: last metadata event said fromCache=false.
    connected: boolean
    // Saw at least one server-served snapshot this session — separates "lost
    // the connection" from "still making the first one".
    everConnected: boolean
    // What a timed-out probe reported — lets label refreshes flip
    // offline ⇄ stalled/flushing as the connection state changes mid-outage.
    lastFailStatus: 'stalled' | 'flushing'
    disposed: boolean
  }>({
    graceTimer: null,
    probing: false,
    connected: false,
    everConnected: false,
    lastFailStatus: 'stalled',
    disposed: false,
  })

  useEffect(() => {
    if (!enabled) return
    const r = refs.current
    r.disposed = false

    const set = (status: SyncHealthStatus) =>
      setHealth((prev) =>
        prev.status === status ? prev : { status, sinceMs: status === 'healthy' ? null : Date.now() },
      )

    // Disconnected → wait out the grace period; still disconnected → overlay.
    const startGrace = (graceMs: number) => {
      if (r.graceTimer) return
      r.graceTimer = setTimeout(() => {
        r.graceTimer = null
        if (!r.disposed && !r.connected) set('offline')
      }, graceMs)
    }
    const cancelGrace = () => {
      if (r.graceTimer) {
        clearTimeout(r.graceTimer)
        r.graceTimer = null
      }
    }

    // Re-derive the overlay label from current facts. Called on connection
    // transitions and poll ticks while a probe is stuck in flight.
    const refreshLabel = () => {
      if (r.disposed) return
      if (!r.connected) return // grace timer / offline state owns this side
      if (r.probing) set(r.lastFailStatus)
      else set('healthy')
    }

    // ── Connection listener — the SDK's own view ────────────────────────────
    // A one-doc listener with metadata changes: fromCache flips true when the
    // client loses the backend, false when it reconnects. The doc may not
    // exist (fresh tenant) — metadata still behaves identically. Deliveries
    // happen only on transitions, so this is near-zero standing traffic.
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = onSnapshot(
        tenantDoc('config', 'appConfig'),
        { includeMetadataChanges: true },
        (snap) => {
          if (r.disposed) return
          const connected = !snap.metadata.fromCache
          if (connected === r.connected && r.everConnected) return
          r.connected = connected
          if (connected) {
            r.everConnected = true
            cancelGrace()
            refreshLabel()
          } else if (r.everConnected) {
            // Lost an established connection — give blips their grace.
            startGrace(OFFLINE_GRACE_MS)
          }
        },
        () => {
          // Listener error (e.g. signed out mid-session) — don't block on it.
        },
      )
    } catch {
      // tenantDoc can throw pre-auth in sandbox builds; run without the
      // listener there — probes + browser events still cover writes.
    }

    // Never connected at all (cold start with no network): the initial cache
    // deliveries never flip `connected`, so no "transition" fires. Allow a
    // generous first-connect window, then call it offline.
    startGrace(STALLED_AFTER_MS)

    // ── Browser events: accelerator only where trustworthy ─────────────────
    // `offline` is reliable when it fires — skip waiting for the SDK to
    // notice. There is deliberately NO `online` handler: navigator saying
    // online proves nothing; the listener's next server snapshot is what
    // flips `connected` and clears the overlay.
    const onOffline = () => {
      r.connected = false
      startGrace(OFFLINE_GRACE_MS)
    }

    // ── Pending-write probe ─────────────────────────────────────────────────
    async function probe(timeoutMs: number, failStatus: 'stalled' | 'flushing') {
      if (r.probing || r.disposed) return
      r.probing = true
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        if (r.disposed) return
        r.lastFailStatus = failStatus
        // Disconnected → the offline path owns the overlay; connected with a
        // stuck queue → this is genuinely a write stall.
        if (r.connected) set(failStatus)
        else startGrace(OFFLINE_GRACE_MS)
      }, timeoutMs)
      try {
        await waitForPendingWrites(db)
      } catch {
        // Rejected (auth changed) — the queue's fate is moot; don't block.
      } finally {
        clearTimeout(timer)
        r.probing = false
        if (!r.disposed && timedOut) refreshLabel()
      }
    }

    // ── Boot: hold the app until a previous session's queue drains ─────────
    void probe(BOOT_FLUSH_PROBE_MS, 'flushing')

    // ── Steady state: poll while the tab is visible ─────────────────────────
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible' || r.disposed) return
      if (r.probing) {
        // Probe stuck in flight → keep the overlay's label honest.
        refreshLabel()
      } else if (r.connected) {
        void probe(STALLED_AFTER_MS, 'stalled')
      }
    }, POLL_EVERY_MS)

    window.addEventListener('offline', onOffline)

    return () => {
      r.disposed = true
      cancelGrace()
      clearInterval(interval)
      unsubscribe?.()
      window.removeEventListener('offline', onOffline)
    }
  }, [enabled])

  // Derived, not reset-in-effect: toggling the feature off mid-overlay
  // reports healthy immediately without an extra state write.
  return enabled ? health : HEALTHY
}
