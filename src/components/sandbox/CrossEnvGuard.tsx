/**
 * Cross-env paranoia gate. Sandbox-only. Reads /sandboxConfig/main at mount;
 * if the doc is missing or `isSandbox !== true`, refuses to render the rest
 * of the app and shows an explicit misconfiguration screen.
 *
 * Mounted high in the sandbox shell. The check is fast — single doc read,
 * happens in parallel with the first paint.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { loadSandboxConfig } from '../../lib/sandboxConfig'

type GuardState = 'checking' | 'ok' | 'misconfigured'

export default function CrossEnvGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GuardState>('checking')

  useEffect(() => {
    let cancelled = false
    loadSandboxConfig()
      .then(() => {
        if (!cancelled) setState('ok')
      })
      .catch(() => {
        if (!cancelled) setState('misconfigured')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'misconfigured') {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-canvas p-6">
        <div className="max-w-md rounded-2xl border border-tone-danger-bd bg-card p-8 text-center shadow-xl">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-tone-danger-bg">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-tone-danger-fg" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-fg">Sandbox misconfiguration</h1>
          <p className="mt-2 text-sm text-fg-muted">
            This build expected to connect to the sandbox Firebase project, but found a different environment.
          </p>
          <p className="mt-3 text-xs text-fg-subtle">
            If you're a developer: check VITE_FIREBASE_PROJECT_ID in .env.sandbox and confirm /sandboxConfig/main exists with isSandbox: true.
          </p>
        </div>
      </div>
    )
  }

  // While checking, render children optimistically — the boot screen + login
  // are safe to show even before the guard finishes (no harm if it ultimately
  // succeeds, and the misconfiguration screen takes over if it fails).
  return <>{children}</>
}
