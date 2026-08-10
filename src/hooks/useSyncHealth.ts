import { useEffect, useRef, useState } from 'react'
import { onSnapshot, waitForPendingWrites } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { tenantDoc } from '../lib/firestore'
import { oldestInflightWriteMs } from '../lib/fsUsage/inflightWrites'

/**
 * Connection/sync health for the SyncGuardOverlay. Three unhealthy states:
 *
 *  - 'offline'  — the Firestore client has lost its server connection,
 *    sustained past a grace period (blips: wifi AP handoffs, sleep/wake).
 *  - 'stalled'  — connected, but a write THIS TAB issued has gone unacked for
 *    STALLED_AFTER_MS of CONNECTED time. Normal write RTT is <1s and nothing
 *    in this app does a legitimately slow Firestore write, so 20s of
 *    connected silence is unambiguous failure.
 *  - 'flushing' — at boot, a PREVIOUS session left queued writes behind. The
 *    direct fix for the project that synced four days late: the app holds
 *    until that queue drains instead of letting new work pile onto it.
 *
 * CONNECTION TRUTH is the SDK's own view: a one-doc listener
 * (config/appConfig, includeMetadataChanges) delivers `fromCache: true` when
 * the client loses the backend and `fromCache: false` on reconnect; it
 * propagates correctly to secondary tabs. The listener is the ONLY writer of
 * `connected` — browser `offline` events merely start the grace timer (the
 * event can be spurious on machines with virtual adapters, and a spurious
 * event must not wedge the state; the SDK confirms or denies within the
 * grace). If the connection signal dies (signed out, listener error), we
 * stop gating on it rather than trusting a frozen value.
 *
 * STALL TRUTH is this tab's own write promises (fsUsage/inflightWrites, fed
 * by fsIntercept), deliberately NOT waitForPendingWrites polling: with
 * persistentMultipleTabManager only the leader tab owns the network, and in
 * secondary tabs (every ctrl+click) waitForPendingWrites can hang forever on
 * a healthy connection — the permanent false "stalled" overlay this design
 * replaced. Write promises settle correctly in the issuing tab in every role.
 *
 * waitForPendingWrites is used exactly once — the BOOT flushing gate — and
 * only when no sibling tab is detected (BroadcastChannel; ANY sibling
 * message counts as presence, arriving before OR after the gate arms — a
 * frozen sibling's late pong must still close it). A solo tab is the leader,
 * where the API is reliable, and the genuine refresh-after-outage scenario
 * is solo by nature. The stand-down cap burns CONNECTED time only and never
 * fires while own writes are visibly stuck — an offline reload keeps its
 * backlog guarded for as long as the outage lasts.
 *
 * `enabled` gates everything (the syncGuard feature toggle, org-wide remote
 * kill switch): disabled → no listeners, no timers, always 'healthy'.
 */

export type SyncHealthStatus = 'healthy' | 'offline' | 'stalled' | 'flushing'

export const OFFLINE_GRACE_MS = 8_000
export const STALLED_AFTER_MS = 20_000
export const BOOT_FLUSH_PROBE_MS = 3_000
// Stand-down cap for the boot gate, counted in CONNECTED time: past this,
// an unresolved pending-writes barrier with a healthy connection and no
// stuck own-writes is presumed to be the multi-tab hang, not a real queue.
export const BOOT_GATE_MAX_MS = 45_000
const BOOT_GATE_RECHECK_MS = 5_000
// How long a fresh tab waits for a sibling tab to answer the presence ping.
const PRESENCE_WAIT_MS = 350
// Steady-state re-check cadence (pure in-memory checks — cheap).
const TICK_EVERY_MS = 5_000

export interface SyncHealth {
  status: SyncHealthStatus
  // When the current unhealthy status began (ms epoch); null while healthy.
  sinceMs: number | null
}

const HEALTHY: SyncHealth = { status: 'healthy', sinceMs: null }
const CHANNEL = 'taskflow:syncguard:v1'

export function useSyncHealth(enabled: boolean): SyncHealth {
  const [health, setHealth] = useState<SyncHealth>(HEALTHY)

  // One mutable bag per mount; the effect below is the only writer.
  const refs = useRef<{
    graceTimer: ReturnType<typeof setTimeout> | null
    connected: boolean
    everConnected: boolean
    // When the CURRENT connection was established — the stall clock and the
    // boot-gate cap both count connected time only.
    connectedSinceMs: number
    // The connection listener is gone (signed out / listener error): stop
    // gating on `connected`, it can no longer change.
    connSignalDead: boolean
    bootGate: 'pending' | 'active' | 'done'
    bootStartedMs: number
    disposed: boolean
  }>({
    graceTimer: null,
    connected: false,
    everConnected: false,
    connectedSinceMs: 0,
    connSignalDead: false,
    bootGate: 'pending',
    bootStartedMs: 0,
    disposed: false,
  })

  useEffect(() => {
    if (!enabled) return
    const r = refs.current
    r.disposed = false
    r.connSignalDead = false
    r.bootGate = 'pending'
    r.bootStartedMs = Date.now()

    const set = (status: SyncHealthStatus) =>
      setHealth((prev) =>
        prev.status === status ? prev : { status, sinceMs: status === 'healthy' ? null : Date.now() },
      )

    // Disconnected → wait out the grace period; still disconnected → overlay.
    const startGrace = (graceMs: number) => {
      if (r.graceTimer) return
      r.graceTimer = setTimeout(() => {
        r.graceTimer = null
        if (!r.disposed && !r.connected && !r.connSignalDead) set('offline')
      }, graceMs)
    }
    const cancelGrace = () => {
      if (r.graceTimer) {
        clearTimeout(r.graceTimer)
        r.graceTimer = null
      }
    }

    // "Connected as far as anything can tell": the SDK says so, or the SDK's
    // voice is gone and we must not block on a frozen `false`.
    const connOk = () => r.connected || r.connSignalDead

    // Re-derive the label from current facts, priority: offline → flushing →
    // stalled → healthy. Called on connection transitions and every tick.
    const refreshLabel = () => {
      if (r.disposed) return
      if (!connOk()) return // the grace timer owns the transition into 'offline'
      if (r.bootGate === 'active') {
        // Give a fast flush its window before surfacing the overlay.
        if (Date.now() - r.bootStartedMs > PRESENCE_WAIT_MS + BOOT_FLUSH_PROBE_MS) set('flushing')
        return
      }
      const oldest = oldestInflightWriteMs()
      // Count only CONNECTED time toward the stall verdict — a backlog queued
      // during an outage gets a fresh 20s to drain after reconnect.
      const stalledSince = oldest === null ? null : Math.max(oldest, r.connectedSinceMs)
      if (stalledSince !== null && Date.now() - stalledSince > STALLED_AFTER_MS) set('stalled')
      else set('healthy')
    }

    // ── Connection listener — the SDK's own view, sole writer of `connected` ─
    let unsubscribe: (() => void) | null = null
    const connSignalLost = () => {
      r.connSignalDead = true
      cancelGrace()
      refreshLabel()
    }
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
            r.connectedSinceMs = Date.now()
            cancelGrace()
            refreshLabel()
          } else if (r.everConnected) {
            startGrace(OFFLINE_GRACE_MS)
          }
        },
        // Listener death (e.g. signed out mid-session): `connected` can never
        // change again — stop gating on it instead of trusting a frozen value.
        connSignalLost,
      )
    } catch {
      // tenantDoc can throw pre-auth in sandbox builds.
      connSignalLost()
    }

    // Never connected at all (cold start with no network): initial cache
    // deliveries never flip `connected`, so no transition fires. Allow a
    // generous first-connect window, then call it offline.
    startGrace(STALLED_AFTER_MS)

    // Browser `offline` is an ACCELERATOR only: it starts the grace, and the
    // grace callback re-checks `connected` — which only the SDK drives. A
    // spurious event (virtual-adapter machines) therefore can't wedge state:
    // if the SDK stays connected, the grace fires as a no-op.
    const onOffline = () => startGrace(OFFLINE_GRACE_MS)
    window.addEventListener('offline', onOffline)

    // ── Boot flushing gate — solo tabs only ─────────────────────────────────
    // ANY sibling message is presence evidence — an incoming 'ping' proves a
    // sibling just as a 'pong' does, and late evidence (sibling frozen by tab
    // throttling, main thread busy past PRESENCE_WAIT_MS) must close an
    // already-armed gate, not be discarded.
    let probeTimer: ReturnType<typeof setTimeout> | null = null
    let capTimer: ReturnType<typeof setTimeout> | null = null
    let gateOpen = false

    const closeBootGate = () => {
      if (!gateOpen) return
      gateOpen = false
      if (probeTimer) {
        clearTimeout(probeTimer)
        probeTimer = null
      }
      if (capTimer) {
        clearTimeout(capTimer)
        capTimer = null
      }
      if (r.bootGate === 'active') {
        r.bootGate = 'done'
        refreshLabel()
      }
    }

    const sawSibling = () => {
      if (r.bootGate === 'pending') r.bootGate = 'done'
      else if (r.bootGate === 'active') closeBootGate()
    }

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (e) => {
        if (e.data === 'ping') channel?.postMessage('pong')
        if (e.data === 'ping' || e.data === 'pong') sawSibling()
      }
      channel.postMessage('ping')
    } catch {
      channel = null // no BroadcastChannel → behave as solo (safe direction)
    }

    const bootTimer = setTimeout(() => {
      if (r.disposed || r.bootGate !== 'pending') return
      // No sibling answered — solo tab (the leader): waitForPendingWrites is
      // trustworthy here, and this is the real refresh-after-outage shape.
      r.bootGate = 'active'
      gateOpen = true

      // Only surfaces as an overlay if the flush outlives the probe window.
      probeTimer = setTimeout(() => {
        if (!r.disposed && r.bootGate === 'active') refreshLabel()
      }, BOOT_FLUSH_PROBE_MS)

      // Stand-down cap: presumes the multi-tab hang ONLY when its documented
      // conditions hold — connected for the full budget, and no own writes
      // visibly stuck. Anything else (offline mid-gate, genuine slow drain
      // with our own writes queued behind it) re-checks instead of dropping
      // the guard; the real drain always exits via the .finally below.
      const armCap = (delayMs: number) => {
        capTimer = setTimeout(() => {
          capTimer = null
          if (!gateOpen || r.disposed) return
          const connectedForMs = connOk()
            ? Date.now() - Math.max(r.bootStartedMs, r.connSignalDead ? 0 : r.connectedSinceMs)
            : 0
          if (connectedForMs >= BOOT_GATE_MAX_MS && oldestInflightWriteMs() === null) {
            console.warn(
              '[syncGuard] boot flush gate stood down after %ds connected — pending-writes barrier never resolved; treating as the known multi-tab hang.',
              Math.round(connectedForMs / 1000),
            )
            closeBootGate()
          } else {
            armCap(BOOT_GATE_RECHECK_MS)
          }
        }, delayMs)
      }
      armCap(BOOT_GATE_MAX_MS)

      waitForPendingWrites(db)
        .catch(() => {})
        .finally(() => {
          closeBootGate()
        })
    }, PRESENCE_WAIT_MS)

    // ── Steady state: cheap in-memory tick while the tab is visible ─────────
    const interval = setInterval(() => {
      if (r.disposed || document.visibilityState !== 'visible') return
      refreshLabel()
    }, TICK_EVERY_MS)

    return () => {
      r.disposed = true
      gateOpen = false
      cancelGrace()
      clearTimeout(bootTimer)
      if (probeTimer) clearTimeout(probeTimer)
      if (capTimer) clearTimeout(capTimer)
      clearInterval(interval)
      unsubscribe?.()
      channel?.close()
      window.removeEventListener('offline', onOffline)
      // Fresh start on re-enable (and React 18 no-ops this after unmount).
      setHealth(HEALTHY)
    }
  }, [enabled])

  // Derived, not reset-in-effect: toggling the feature off mid-overlay
  // reports healthy immediately without an extra state write.
  return enabled ? health : HEALTHY
}
