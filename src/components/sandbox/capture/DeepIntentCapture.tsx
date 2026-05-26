import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { serverTimestamp, updateDoc } from 'firebase/firestore'
import { tenantDoc } from '../../../lib/firestore'
import { captureStage } from '../../../lib/leadCapture'
import { loadSandboxConfig } from '../../../lib/sandboxConfig'

export default function DeepIntentCapture({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [intent, setIntent] = useState('')
  const [wantsCallback, setWantsCallback] = useState(false)
  const [calendlyUrl, setCalendlyUrl] = useState<string | null>(null)

  useEffect(() => {
    loadSandboxConfig().then((c) => setCalendlyUrl(c.calendlyUrl ?? null)).catch(() => {})
  }, [])

  // Document-level Escape — divs only catch keydown when focused, and we
  // want Escape to dismiss the modal no matter where focus is sitting.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Optimistic submit — close the modal + clear the form *immediately* so
  // the visitor's click responds, then fire the Firestore writes in the
  // background. Writes that fail aren't fatal; the entry-stage lead doc
  // already has the visitor's email, and worst case sales has a partial
  // record they can follow up on manually.
  function submit(navigateToCalendly: boolean) {
    const intentSnap = intent.trim()
    const wantsCb = wantsCallback
    // Reset local state so re-opening the modal shows a fresh form (the
    // component will unmount on onClose anyway, but this clears any latent
    // UI flash before unmount).
    setIntent('')
    setWantsCallback(false)
    if (navigateToCalendly && calendlyUrl) {
      window.open(calendlyUrl, '_blank', 'noopener,noreferrer')
    }
    onClose()
    if (!user) return
    void (async () => {
      try {
        await updateDoc(tenantDoc('_meta', 'main'), {
          'visitor.intent': intentSnap || null,
          'visitor.wantsCallback': wantsCb,
          'contactCapture.deepIntent': true,
          lastSeenAt: serverTimestamp(),
        })
        await captureStage({
          uid: user.uid,
          stage: 'deepIntent',
          fields: { intent: intentSnap, wantsCallback: wantsCb },
        })
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[sandbox] deep-intent write failed', err)
      }
    })()
  }

  // Backdrop click + Escape key dismiss. Calls onClose without writing any
  // capture fields — the visitor explicitly bailed, so don't mark deepIntent
  // as captured. The 5-min cooldown that other stages use doesn't apply here
  // because stage 4 is visitor-initiated (Talk to us / Invite / etc.), not
  // auto-fired — they can re-open it if they want.
  function dismissWithoutCapture() {
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Let's set up a real walkthrough"
      onClick={dismissWithoutCapture}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-line bg-elevated p-6 shadow-2xl sm:p-7"
      >
        <button
          type="button"
          onClick={dismissWithoutCapture}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle transition hover:bg-fill-2 hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <h2 className="pr-6 text-lg font-semibold text-fg">Let's set up a real walkthrough</h2>
        <p className="mt-2 text-sm text-fg-muted">
          You've seen the surface — we'd love to tailor a demo to what you're actually trying to build.
        </p>

        <label className="mt-5 block">
          <span className="block text-xs font-medium text-fg-subtle">
            What problem are you solving?
          </span>
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={3}
            placeholder="e.g. We need to coordinate 3 design teams on tender pitches..."
            className="mt-1 w-full resize-none rounded-lg border border-line bg-fill-3 px-3 py-2 text-sm text-fg outline-none focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
          />
        </label>

        <label className="mt-4 inline-flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={wantsCallback}
            onChange={(e) => setWantsCallback(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong text-[var(--sandbox-accent,#a78bfa)] focus:ring-brand-ring"
          />
          Want a callback in the next 48 hours?
        </label>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => submit(false)}
            className="rounded-lg px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-2"
          >
            Just keep me posted
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            className="rounded-lg bg-[var(--sandbox-accent,#a78bfa)] px-5 py-2 text-sm font-medium text-white transition hover:opacity-95"
          >
            {calendlyUrl ? 'Book a meeting now' : 'Send my intent'}
          </button>
        </div>
      </div>
    </div>
  )
}
