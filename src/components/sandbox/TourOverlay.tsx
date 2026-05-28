/**
 * 60-second tour overlay — driver.js for the spotlight + popover visuals,
 * a thin orchestrator on top for the bits driver.js doesn't know about:
 * route navigation, persona switching, the branded cinematic curtain between
 * persona-switching steps, and writes to `_meta.tourProgress` for resumability.
 *
 * Why driver.js: the cutout/popover positioning math we used to maintain by
 * hand was the bug surface. driver.js is purpose-built for it, ~10KB, smooth
 * defaults, and handles every viewport edge case for us.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useAuth } from '../../contexts/AuthContext'
import { tenantCol, tenantDoc } from '../../lib/firestore'
import { sandboxAvatar } from '../../lib/sandboxAvatar'
import type { SandboxMeta } from '../../types/sandbox'
import {
  DIAGEO_PROJECT_PLACEHOLDER,
  SIXTY_SECOND_TOUR,
  SIXTY_SECOND_TOUR_ID,
} from '../../lib/tours/sixtySecondTour'
import type { TourStep } from '../../lib/tours/types'

const CURTAIN_DURATION_MS = 720
const ROUTE_SETTLE_DELAY_MS = 350
const TARGET_RETRY_LIMIT = 8
const TARGET_RETRY_INTERVAL_MS = 250

interface PersonaCurtainState {
  visible: boolean
  name: string
  role: string
  uid: string
}

export default function TourOverlay() {
  const { user, setActAs } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [meta, setMeta] = useState<SandboxMeta | null>(null)
  const [curtain, setCurtain] = useState<PersonaCurtainState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showWrapUp, setShowWrapUp] = useState(false)
  const driverRef = useRef<Driver | null>(null)
  const runningRef = useRef(false)
  const diageoProjectIdRef = useRef<string | null>(null)
  const personaListRef = useRef<Array<{ uid: string; displayName: string; globalRole: string }>>([])

  // Stream _meta — we need the tour-progress markers + the visitor's "have
  // you seen this already" gating flags.
  useEffect(() => {
    if (!user) return
    return onSnapshot(tenantDoc('_meta', 'main'), (snap) => {
      if (snap.exists()) setMeta(snap.data() as SandboxMeta)
    })
  }, [user])

  // Cache the persona roster for nice curtain copy + role chips.
  useEffect(() => {
    if (!user) return
    void getDocs(tenantCol('users')).then((snap) => {
      personaListRef.current = snap.docs.map((d) => {
        const data = d.data() as { uid?: string; displayName?: string; globalRole?: string }
        return {
          uid: data.uid ?? d.id,
          displayName: data.displayName ?? 'Persona',
          globalRole: data.globalRole ?? 'user',
        }
      })
    })
  }, [user])

  // Resolve the seeded Diageo project id (steps 2 + 5 navigate to it).
  const resolveDiageoProjectId = useCallback(async (): Promise<string | null> => {
    if (diageoProjectIdRef.current) return diageoProjectIdRef.current
    const snap = await getDocs(
      query(tenantCol('projects'), where('titleLower', '>=', 'diageo'), where('titleLower', '<=', 'diageo')),
    )
    const projectId = snap.docs[0]?.id ?? null
    diageoProjectIdRef.current = projectId
    return projectId
  }, [])

  // Wait for a target to appear in the DOM (UI may be lazy-mounting after a
  // route change). Returns the element or null if it never shows up.
  const waitForTarget = useCallback(async (selector: string): Promise<Element | null> => {
    for (let i = 0; i < TARGET_RETRY_LIMIT; i++) {
      const el = document.querySelector(selector)
      if (el) return el
      await new Promise((r) => setTimeout(r, TARGET_RETRY_INTERVAL_MS))
    }
    return null
  }, [])

  // Branded curtain — fades in, holds, fades out. Used between every
  // persona-switching step so the perspective change feels cinematic.
  const playPersonaCurtain = useCallback(async (personaUid: string) => {
    const persona = personaListRef.current.find((p) => p.uid === personaUid)
    if (!persona) return
    const next: PersonaCurtainState = {
      visible: true,
      name: persona.displayName,
      role: roleLabel(persona.globalRole),
      uid: personaUid,
    }
    setCurtain(next)
    await new Promise((r) => setTimeout(r, CURTAIN_DURATION_MS - 200))
    setCurtain((c) => (c ? { ...c, visible: false } : c))
    await new Promise((r) => setTimeout(r, 200))
    setCurtain(null)
  }, [])

  const writeProgress = useCallback(async (patch: Record<string, unknown>) => {
    if (!user) return
    try {
      await updateDoc(tenantDoc('_meta', 'main'), patch)
    } catch {
      // Best effort — tour state is mostly client-side anyway.
    }
  }, [user])

  // Resolve a step's targetRoute (substitute the Diageo placeholder if needed).
  const resolveRoute = useCallback(
    async (step: TourStep): Promise<string | null> => {
      if (!step.targetRoute) return null
      if (step.targetRoute.includes(DIAGEO_PROJECT_PLACEHOLDER)) {
        const id = await resolveDiageoProjectId()
        if (!id) return null
        return step.targetRoute.replace(DIAGEO_PROJECT_PLACEHOLDER, id)
      }
      return step.targetRoute
    },
    [resolveDiageoProjectId],
  )

  // The main tour engine. Drives one step at a time via driver.highlight(),
  // owning everything driver.js doesn't (navigation, persona switching, curtain).
  const runTour = useCallback(async () => {
    if (runningRef.current) return
    if (!user) return
    runningRef.current = true
    setShowWrapUp(false)

    const drv = driver({
      animate: true,
      smoothScroll: true,
      allowClose: true,
      overlayColor: 'rgba(8, 8, 14, 0.78)',
      popoverClass: 'sandbox-tour-popover',
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      onCloseClick: () => {
        drv.destroy()
        runningRef.current = false
        void writeProgress({
          'tourProgress.tourId': SIXTY_SECOND_TOUR_ID,
          'tourProgress.abandonedAt': serverTimestamp(),
        })
        setActAs(null)
      },
    })
    driverRef.current = drv

    await writeProgress({
      'tourProgress.tourId': SIXTY_SECOND_TOUR_ID,
      'tourProgress.startedAt': serverTimestamp(),
      'tourProgress.completedAt': null,
      'tourProgress.abandonedAt': null,
    })

    let lastPersona: string | 'visitor' | undefined
    try {
      for (let i = 0; i < SIXTY_SECOND_TOUR.length; i++) {
        const step = SIXTY_SECOND_TOUR[i]
        if (!step || !runningRef.current) break

        // Persona switch with cinematic curtain — only when persona changes.
        if (step.actAs && step.actAs !== lastPersona) {
          if (step.actAs === 'visitor') {
            setActAs(null)
          } else {
            await playPersonaCurtain(step.actAs)
            setActAs(step.actAs)
          }
          lastPersona = step.actAs
        }

        // Route navigation — and wait a beat for the next page to mount before
        // we ask driver.js to highlight anything inside it.
        const route = await resolveRoute(step)
        if (route && location.pathname !== route) {
          navigate(route)
          await new Promise((r) => setTimeout(r, ROUTE_SETTLE_DELAY_MS))
        }

        // Find the target. Bail with a soft toast if it never shows up.
        const targetEl = await waitForTarget(`[data-tour-id="${step.targetSelector}"]`)
        if (!runningRef.current) break

        if (i === SIXTY_SECOND_TOUR.length - 1) {
          // Final step is the wrap-up modal — rendered ourselves (driver.js
          // doesn't natively do a "no anchor, center stage" CTA card with
          // three branded buttons).
          drv.destroy()
          setShowWrapUp(true)
          await writeProgress({
            'tourProgress.tourId': SIXTY_SECOND_TOUR_ID,
            'tourProgress.completedAt': serverTimestamp(),
          })
          break
        }

        if (!targetEl) {
          // Target missing → end the tour cleanly.
          drv.destroy()
          setToast("Tour ended — we couldn't find the next step. Restart anytime.")
          setTimeout(() => setToast(null), 4000)
          await writeProgress({
            'tourProgress.tourId': SIXTY_SECOND_TOUR_ID,
            'tourProgress.abandonedAt': serverTimestamp(),
          })
          break
        }

        // Drive a single step. Resolves on (a) Next click, (b) Close click,
        // or (c) dwellMs timeout elapsing — whichever fires first. This is
        // the "tour walks itself" behaviour: visitor watches, doesn't have
        // to click Next six times; the Next button stays for skip-ahead.
        const advanced = await new Promise<boolean>((resolve) => {
          let settled = false
          const settle = (v: boolean) => {
            if (settled) return
            settled = true
            resolve(v)
          }

          drv.setConfig({
            ...drv.getConfig(),
            onCloseClick: () => settle(false),
            onPopoverRender: (popover) => {
              popover.title?.classList.add('sandbox-tour-title')
            },
          })

          drv.highlight({
            element: targetEl as HTMLElement,
            popover: {
              title: step.title,
              description: step.body,
              showButtons: ['next', 'close'],
              nextBtnText: step.primaryCta?.label ?? 'Next',
              onNextClick: () => settle(true),
              onCloseClick: () => settle(false),
            },
          })

          // Auto-advance after the configured dwell. Manual-advance steps
          // (e.g. the wrap-up) leave dwellMs unset — they wait for the click.
          if (!step.manualAdvance && step.dwellMs && step.dwellMs > 0) {
            window.setTimeout(() => settle(true), step.dwellMs)
          }

          // Persist progress on the step landing.
          void writeProgress({
            'tourProgress.tourId': SIXTY_SECOND_TOUR_ID,
            'tourProgress.currentStepId': step.id,
          })
        })

        if (!advanced) {
          drv.destroy()
          await writeProgress({
            'tourProgress.tourId': SIXTY_SECOND_TOUR_ID,
            'tourProgress.abandonedAt': serverTimestamp(),
          })
          break
        }
      }
    } finally {
      drv.destroy()
      driverRef.current = null
      runningRef.current = false
      setActAs(null)
    }
  }, [user, navigate, location.pathname, resolveRoute, playPersonaCurtain, waitForTarget, writeProgress, setActAs])

  // Manual restart trigger from the sandbox menu.
  useEffect(() => {
    function startTour() {
      if (!user) return
      void runTour()
    }
    window.addEventListener('sandbox:startTour', startTour)
    return () => window.removeEventListener('sandbox:startTour', startTour)
  }, [runTour, user])

  // Auto-start once: visitor is on Home, rich seed is done, no tour history.
  useEffect(() => {
    if (!meta || runningRef.current) return
    if (location.pathname !== '/') return
    if (!meta.richSeedCompleted) return
    if (meta.tourProgress?.completedAt || meta.tourProgress?.abandonedAt) return
    if (meta.entryMode) return
    void runTour()
  }, [meta, location.pathname, runTour])

  // Cleanup on unmount — defensive in case the visitor signs out mid-tour.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy()
      runningRef.current = false
    }
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {curtain ? <PersonaCurtain state={curtain} /> : null}
      {toast ? (
        <div
          role="status"
          className="fixed left-1/2 top-20 z-[80] -translate-x-1/2 rounded-full border border-line bg-card/95 px-4 py-2 text-sm text-fg shadow-lg backdrop-blur-md"
        >
          {toast}
        </div>
      ) : null}
      {showWrapUp ? <WrapUpModal onClose={() => setShowWrapUp(false)} navigate={navigate} /> : null}
    </>,
    document.body,
  )
}

// ─── Persona curtain ───────────────────────────────────────────────────────

function PersonaCurtain({ state }: { state: PersonaCurtainState }) {
  const avatar = sandboxAvatar(state.uid, state.name)
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-[90] flex items-center justify-center transition-opacity duration-300 ${
        state.visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(167, 139, 250, 0.22), rgba(8, 8, 14, 0.88))',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div className="flex items-center gap-4 rounded-2xl border border-[var(--sandbox-accent,#a78bfa)]/40 bg-card/95 px-5 py-4 shadow-2xl backdrop-blur-md">
        <span
          className="inline-flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: avatar.bg, color: avatar.fg }}
        >
          {avatar.initials}
        </span>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            Switching perspective
          </div>
          <div className="text-base font-semibold text-fg">{state.name}</div>
          <div className="text-xs text-fg-muted">{state.role}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Wrap-up modal ─────────────────────────────────────────────────────────

function WrapUpModal({
  onClose,
  navigate,
}: {
  onClose: () => void
  navigate: (to: string) => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tour complete"
      onClick={onClose}
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-line bg-elevated p-6 text-center shadow-2xl sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle transition hover:bg-fill-2 hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-fg">You just ran a full workflow end-to-end</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Build your own workflow, keep exploring, or set up a real walkthrough with us.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onClose()
              navigate('/admin/workflows/new')
            }}
            className="w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient"
          >
            Build your own workflow
          </button>
          <button
            type="button"
            onClick={() => {
              onClose()
              window.dispatchEvent(new CustomEvent('sandbox:openDeepIntent'))
            }}
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-fg-muted transition hover:bg-fill-2"
          >
            Book a 15-min walkthrough
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg px-4 py-2.5 text-sm text-fg-subtle transition hover:text-fg"
          >
            Free-roam
          </button>
        </div>
      </div>
    </div>
  )
}

function roleLabel(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super Admin'
    case 'admin':
      return 'Vertical Head'
    case 'horizontal_lead':
      return 'Horizontal Lead'
    default:
      return 'Team Member'
  }
}
