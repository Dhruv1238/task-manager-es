/**
 * One-shot coachmark hint. Renders once per (hintId, visitor) pair — dismissals
 * persist to _meta.dismissedHints. Sandbox-only.
 *
 * Used in roam mode to surface single-line discovery prompts when a visitor
 * first lands on a screen they haven't seen.
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { tenantDoc } from '../../lib/firestore'
import { getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import type { SandboxMeta } from '../../types/sandbox'

interface Props {
  id: string                 // unique identifier persisted in _meta.dismissedHints
  body: string
  position?: 'top' | 'bottom'
}

export default function HintBubble({ id, body, position = 'top' }: Props) {
  const { user } = useAuth()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getDoc(tenantDoc('_meta', 'main')).then((snap) => {
      if (cancelled) return
      if (!snap.exists()) return
      const meta = snap.data() as SandboxMeta
      if (meta.dismissedHints?.[id]) return
      setShow(true)
    })
    return () => {
      cancelled = true
    }
  }, [user, id])

  async function dismiss() {
    setShow(false)
    if (!user) return
    await updateDoc(tenantDoc('_meta', 'main'), {
      [`dismissedHints.${id}`]: true,
      lastSeenAt: serverTimestamp(),
    })
  }

  if (!show) return null

  return (
    <div
      role="status"
      className={`pointer-events-auto fixed left-1/2 z-[55] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--sandbox-accent,#a78bfa)]/40 bg-card/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur-md ${
        position === 'top' ? 'top-24' : 'bottom-6'
      }`}
    >
      <span className="text-lg" aria-hidden>💡</span>
      <span className="text-fg-muted">{body}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mr-1 rounded p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
