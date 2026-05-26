/**
 * Sandbox-only shell. Wraps the production app in:
 *   - A tiny top-left "Sandbox" chip (fixed, no vertical space taken)
 *   - SandboxToastSink (surface for neutering wrappers)
 *   - Capture coordinator (lead capture progression)
 *   - Tour overlay
 *   - Engagement heartbeat (heartbeat starts on user auth)
 *
 * Mounted from App.tsx only in sandbox builds.
 */

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { setSandboxToastSink } from '../../lib/sandboxNeutering'
import { startEngagementTracking } from '../../lib/engagement'
import CrossEnvGuard from './CrossEnvGuard'

const CaptureCoordinator = lazy(() => import('./capture/CaptureCoordinator'))
const TourOverlay = lazy(() => import('./TourOverlay'))

interface ToastItem {
  id: number
  text: string
}

let nextId = 1

export default function SandboxShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    setSandboxToastSink({
      show: (text: string) => {
        const id = nextId++
        setToasts((prev) => [...prev, { id, text }])
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3800)
      },
    })
    return () => setSandboxToastSink(null)
  }, [])

  // Engagement heartbeat — only when authenticated.
  useEffect(() => {
    if (!user) return
    const stop = startEngagementTracking()
    return stop
  }, [user])

  return (
    <CrossEnvGuard>
      {/* Tiny "Sandbox" chip pinned to the top-left of the viewport — no
          vertical layout impact, no blur, no border. Just a 1.5px dot and a
          label so the visitor always knows where they are. */}
      <div
        className="pointer-events-none fixed left-3 top-2 z-[55] inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--sandbox-accent,#a78bfa)]"
        aria-label="Sandbox environment"
        title="You're in the sandbox"
      >
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--sandbox-accent,#a78bfa)]" aria-hidden />
        Sandbox
      </div>
      {children}

      {user ? (
        <Suspense fallback={null}>
          <CaptureCoordinator />
          <TourOverlay />
        </Suspense>
      ) : null}

      {/* Toast region for neutered ops */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-full border border-line bg-card/95 px-4 py-2 text-sm text-fg shadow-lg backdrop-blur-md"
            role="status"
          >
            {t.text}
          </div>
        ))}
      </div>
    </CrossEnvGuard>
  )
}
