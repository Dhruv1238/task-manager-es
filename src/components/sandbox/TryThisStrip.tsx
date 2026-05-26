/**
 * Rotating "Try this" prompts strip. Sandbox-only. Rendered on the roam-mode
 * home dashboard. Lightweight discovery surface for visitors who skipped the
 * tour. Dismissible globally — once dismissed it stays dismissed.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { tenantDoc } from '../../lib/firestore'
import type { SandboxMeta } from '../../types/sandbox'

const DISMISS_KEY = 'tryThisStrip'

interface Prompt {
  text: string
  to?: string
  event?: string
}

const PROMPTS: Prompt[] = [
  { text: 'Build a workflow from scratch', to: '/admin/workflows/new' },
  { text: 'Switch to a designer\'s view', event: 'sandbox:openPersonaSwitcher' },
  { text: 'Restart the 60-second tour', event: 'sandbox:startTour' },
]

export default function TryThisStrip() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) return
    getDoc(tenantDoc('_meta', 'main')).then((snap) => {
      if (!snap.exists()) {
        setDismissed(false)
        return
      }
      const meta = snap.data() as SandboxMeta
      setDismissed(Boolean(meta.dismissedHints?.[DISMISS_KEY]))
    })
  }, [user])

  async function dismiss() {
    setDismissed(true)
    if (!user) return
    await updateDoc(tenantDoc('_meta', 'main'), {
      [`dismissedHints.${DISMISS_KEY}`]: true,
      lastSeenAt: serverTimestamp(),
    })
  }

  if (dismissed !== false) return null

  return (
    <div className="mb-6 flex items-center gap-2 rounded-2xl border border-[var(--sandbox-accent,#a78bfa)]/30 bg-[var(--sandbox-accent,#a78bfa)]/8 px-4 py-3 text-sm">
      <span className="text-base" aria-hidden>💡</span>
      <span className="font-medium text-fg">Try this:</span>
      <ul className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-fg-muted">
        {PROMPTS.map((p, i) => (
          <li key={i} className="inline-flex items-center">
            {p.to ? (
              <Link to={p.to} className="hover:text-fg hover:underline">
                {p.text} →
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => p.event && window.dispatchEvent(new CustomEvent(p.event))}
                className="hover:text-fg hover:underline"
              >
                {p.text} →
              </button>
            )}
            {i < PROMPTS.length - 1 ? <span className="ml-3 text-fg-subtle">·</span> : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss try-this prompts"
        className="rounded p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
