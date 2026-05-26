/**
 * Central state machine for sandbox lead capture progression. Subscribes to
 * engagement signals + action events and decides which of the five capture
 * stages to fire and when.
 *
 *   1. entry         — captured at SandboxLogin email submit (already done
 *                      by Phase A seed).
 *   2. firstAction   — first state-changing action OR 90s active time.
 *   3. engagement    — 5 min active OR tour completed OR authored workflow.
 *   4. deepIntent    — "Talk to us" click, attempted invite, etc.
 *   5. exitIntent    — mouseleave to chrome (desktop), visibility hidden+3min
 *                      (mobile), once per session.
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { getDoc, onSnapshot } from 'firebase/firestore'
import { tenantDoc } from '../../../lib/firestore'
import type { SandboxMeta } from '../../../types/sandbox'
import FirstActionCapture from './FirstActionCapture'
import EngagementCapture from './EngagementCapture'
import DeepIntentCapture from './DeepIntentCapture'
import ExitIntentCapture from './ExitIntentCapture'

type StageKey = 'firstAction' | 'engagement' | 'deepIntent' | 'exitIntent'
type ActiveStage = null | StageKey

const FIRST_ACTION_DWELL_S = 90
const ENGAGEMENT_DWELL_S = 5 * 60
const EXIT_INTENT_AFTER_S = 30

// In-memory guard window after a stage closes — bridges the race between
// the updateDoc(dismissal/capture) write and the resulting snapshot fan-out.
// The Firestore dismissal timestamp has a 5-min cooldown anyway; this is just
// here to ensure we don't re-fire while the local cache is briefly stale.
const RECENTLY_CLOSED_GUARD_MS = 60_000

export default function CaptureCoordinator() {
  const { user } = useAuth()
  const [meta, setMeta] = useState<SandboxMeta | null>(null)
  const [active, setActive] = useState<ActiveStage>(null)
  const [exitTriggered, setExitTriggered] = useState(false)

  // Tracks per-stage `last closed at` so the fire-logic doesn't immediately
  // re-trigger a stage that was just dismissed or submitted. Survives across
  // _meta snapshot fan-outs, doesn't survive a full page reload (intentional —
  // a fresh session can re-fire if Firestore cooldown has lapsed).
  const recentlyClosedRef = useRef<Partial<Record<StageKey, number>>>({})
  const wasRecentlyClosed = (stage: StageKey) =>
    Date.now() - (recentlyClosedRef.current[stage] ?? 0) < RECENTLY_CLOSED_GUARD_MS

  // Listen to _meta — the engagement counters and capture flags live there.
  useEffect(() => {
    if (!user) return
    return onSnapshot(tenantDoc('_meta', 'main'), (snap) => {
      if (snap.exists()) setMeta(snap.data() as SandboxMeta)
    })
  }, [user])

  // Tour-active short-circuit. The visitor is being walked through a guided
  // experience; auto-fired captures (firstAction / engagement / exitIntent)
  // would compete with the tour popover for attention. Only visitor-initiated
  // captures (deepIntent via custom event) are allowed during the tour.
  const tourActive = Boolean(
    meta?.tourProgress?.startedAt &&
      !meta.tourProgress.completedAt &&
      !meta.tourProgress.abandonedAt,
  )

  // Auto-fire firstAction / engagement when criteria met
  useEffect(() => {
    if (!meta || active || tourActive) return
    const sec = meta.engagement.totalActiveSeconds

    if (
      !meta.contactCapture.firstAction &&
      !wasRecentlyClosed('firstAction') &&
      (sec >= FIRST_ACTION_DWELL_S || meta.engagement.actionsCompleted.length > 0) &&
      !isWithinCooldown(meta.contactCapture.dismissals?.firstAction)
    ) {
      setActive('firstAction')
      return
    }
    if (
      !meta.contactCapture.engagement &&
      !wasRecentlyClosed('engagement') &&
      meta.contactCapture.firstAction &&
      (sec >= ENGAGEMENT_DWELL_S || Boolean(meta.tourProgress?.completedAt)) &&
      !isWithinCooldown(meta.contactCapture.dismissals?.engagement)
    ) {
      setActive('engagement')
      return
    }
  }, [meta, active, tourActive])

  // Exit intent: mouseleave through top of viewport (desktop) once per session.
  // Suppressed while the tour is running — the tour drives the mouse around
  // and mouseleave-through-top would fire spuriously.
  useEffect(() => {
    if (!meta || exitTriggered || tourActive) return
    if (meta.contactCapture.exitIntent) return
    if (meta.engagement.totalActiveSeconds < EXIT_INTENT_AFTER_S) return
    const onMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) {
        if (wasRecentlyClosed('exitIntent')) return
        setExitTriggered(true)
        setActive('exitIntent')
      }
    }
    document.addEventListener('mouseleave', onMouseLeave)
    return () => document.removeEventListener('mouseleave', onMouseLeave)
  }, [meta, exitTriggered, tourActive])

  // Listen for "open deep intent" custom events from elsewhere in the app
  // ("Talk to us" button, tour wrap-up CTA, etc.).
  useEffect(() => {
    const onOpenDeepIntent = () => {
      // Deep intent is visitor-initiated, so a recent close means the visitor
      // explicitly closed it — don't immediately re-open from a duplicate event.
      if (wasRecentlyClosed('deepIntent')) return
      setActive('deepIntent')
    }
    window.addEventListener('sandbox:openDeepIntent', onOpenDeepIntent)
    return () => window.removeEventListener('sandbox:openDeepIntent', onOpenDeepIntent)
  }, [])

  // Refresh meta after a capture closes (so the flags reflect what we just wrote).
  async function refreshMeta() {
    if (!user) return
    const snap = await getDoc(tenantDoc('_meta', 'main'))
    if (snap.exists()) setMeta(snap.data() as SandboxMeta)
  }

  // Single close handler: stamp the in-memory guard FIRST, then clear active +
  // refresh meta. The ordering matters — if the snapshot listener fires
  // mid-transition with stale data, the guard prevents re-firing.
  function closeStage(stage: StageKey) {
    return async () => {
      recentlyClosedRef.current[stage] = Date.now()
      setActive(null)
      await refreshMeta()
    }
  }

  if (!user || !meta) return null

  return (
    <>
      {active === 'firstAction' ? <FirstActionCapture onClose={closeStage('firstAction')} /> : null}
      {active === 'engagement' ? <EngagementCapture onClose={closeStage('engagement')} /> : null}
      {active === 'deepIntent' ? <DeepIntentCapture onClose={closeStage('deepIntent')} /> : null}
      {active === 'exitIntent' ? <ExitIntentCapture onClose={closeStage('exitIntent')} /> : null}
    </>
  )
}

function isWithinCooldown(ts: { toMillis?: () => number } | undefined): boolean {
  if (!ts) return false
  const fiveMinutes = 5 * 60 * 1000
  const t = ts.toMillis?.() ?? 0
  return Date.now() - t < fiveMinutes
}
