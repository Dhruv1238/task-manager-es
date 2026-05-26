/**
 * Reusable slide-in card for capture stages 2 + 3. Glass-card, anchored bottom-
 * right desktop, full-width bottom sheet on mobile. Sandbox-accent left border
 * ties it into the sandbox brand.
 */

import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /**
   * After this many ms of inattention, collapse the card to a minimized pill.
   * Default 12s.
   */
  autoMinimizeMs?: number
}

export default function CaptureSlideIn({ title, onClose, children, autoMinimizeMs = 12_000 }: Props) {
  const [minimized, setMinimized] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Mount animation
    requestAnimationFrame(() => setMounted(true))
  }, [])

  useEffect(() => {
    if (minimized) return
    const t = setTimeout(() => setMinimized(true), autoMinimizeMs)
    return () => clearTimeout(t)
  }, [minimized, autoMinimizeMs])

  if (minimized) {
    // Two affordances on the minimized pill: click the label to re-expand,
    // click the × to dismiss entirely (calls onClose so the parent writes
    // a cooldown timestamp and the coordinator clears `active`).
    return (
      <div className="fixed bottom-4 right-4 z-[65] inline-flex items-stretch overflow-hidden rounded-full border border-[var(--sandbox-accent,#a78bfa)]/40 bg-card/95 shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="px-4 py-2 text-sm transition hover:bg-fill-2"
          aria-label={`Re-open: ${title}`}
        >
          👋 One small ask.
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="border-l border-line px-2.5 text-fg-subtle transition hover:bg-fill-2 hover:text-fg"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-label={title}
      className={`fixed z-[65] transition-all duration-240 ease-out ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      } bottom-0 right-0 w-full sm:bottom-4 sm:right-4 sm:w-[min(92vw,360px)]`}
    >
      <div className="overflow-hidden rounded-t-2xl border border-line border-l-[3px] border-l-[var(--sandbox-accent,#a78bfa)] bg-card/95 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-md p-1.5 text-fg-subtle transition hover:bg-fill-2 hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-5 pb-5 pt-3">{children}</div>
      </div>
    </div>
  )
}
