import { useState } from 'react'
import CaptureSlideIn from './CaptureSlideIn'
import { useAuth } from '../../../contexts/AuthContext'
import { serverTimestamp, updateDoc } from 'firebase/firestore'
import { tenantDoc } from '../../../lib/firestore'
import { captureStage } from '../../../lib/leadCapture'

const ROLES = [
  'Founder / CEO',
  'Operations / Project Mgmt',
  'Sales / Client Servicing',
  'Designer / Creative',
  'Engineering / Product',
  'Other',
]

export default function EngagementCapture({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [role, setRole] = useState('')

  // Optimistic close — snapshot inputs, dismiss immediately, then fire the
  // Firestore writes in the background. A hung write must not leave the
  // visitor staring at an unresponsive modal.
  function submit() {
    if (!role) return
    const roleSnap = role
    setRole('')
    onClose()
    if (!user) return
    void (async () => {
      try {
        await updateDoc(tenantDoc('_meta', 'main'), {
          'visitor.role': roleSnap,
          'contactCapture.engagement': true,
          lastSeenAt: serverTimestamp(),
        })
        await captureStage({ uid: user.uid, stage: 'engagement', fields: { role: roleSnap } })
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[sandbox] engagement write failed', err)
      }
    })()
  }

  function dismiss() {
    onClose()
    if (!user) return
    void updateDoc(tenantDoc('_meta', 'main'), {
      'contactCapture.dismissals.engagement': serverTimestamp(),
    }).catch((err) => {
      if (typeof console !== 'undefined') console.warn('[sandbox] engagement dismiss write failed', err)
    })
  }

  return (
    <CaptureSlideIn title="What's your role?" onClose={dismiss}>
      <p className="text-sm text-fg-muted">
        You've been exploring for a bit. Helps us tailor what we show you.
      </p>
      <div className="mt-4 space-y-1.5">
        {ROLES.map((r) => (
          <label
            key={r}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
              role === r ? 'border-[var(--sandbox-accent,#a78bfa)] bg-[var(--sandbox-accent,#a78bfa)]/10' : 'border-line bg-fill-2 hover:bg-fill-3'
            }`}
          >
            <input
              type="radio"
              name="role"
              value={r}
              checked={role === r}
              onChange={() => setRole(r)}
              className="sr-only"
            />
            <span
              className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                role === r ? 'border-[var(--sandbox-accent,#a78bfa)] bg-[var(--sandbox-accent,#a78bfa)]' : 'border-line-strong'
              }`}
              aria-hidden
            />
            <span>{r}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-fg-subtle transition hover:text-fg-muted"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!role}
          className="rounded-lg bg-[var(--sandbox-accent,#a78bfa)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </CaptureSlideIn>
  )
}
