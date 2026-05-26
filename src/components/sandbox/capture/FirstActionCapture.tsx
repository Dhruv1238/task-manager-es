import { useEffect, useState } from 'react'
import CaptureSlideIn from './CaptureSlideIn'
import { useAuth } from '../../../contexts/AuthContext'
import { getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { tenantDoc } from '../../../lib/firestore'
import { captureStage } from '../../../lib/leadCapture'
import type { SandboxMeta } from '../../../types/sandbox'

export default function FirstActionCapture({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  // Captured at sign-up (Google displayName or the optional email-path Name
  // field). When present, hide the Name input so we only ask for Company.
  const [existingName, setExistingName] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void getDoc(tenantDoc('_meta', 'main')).then((snap) => {
      if (!snap.exists()) return
      const meta = snap.data() as SandboxMeta
      const n = meta.visitor?.name?.trim()
      if (n) setExistingName(n)
    })
  }, [user])

  // Optimistic close — snapshot inputs, close the slide-in immediately, then
  // fire writes in the background. A hung Firestore write must not leave the
  // visitor staring at an unresponsive modal.
  function submit() {
    const nameSnap = name.trim()
    const companySnap = company.trim()
    const existingNameSnap = existingName
    setName('')
    setCompany('')
    onClose()
    if (!user) return
    void (async () => {
      try {
        const finalName = (existingNameSnap ?? nameSnap) || null
        const finalCompany = companySnap || null
        const updates: Record<string, unknown> = {
          'visitor.company': finalCompany,
          'contactCapture.firstAction': true,
          lastSeenAt: serverTimestamp(),
        }
        if (!existingNameSnap && nameSnap) {
          updates['visitor.name'] = nameSnap
        }
        await updateDoc(tenantDoc('_meta', 'main'), updates)
        await captureStage({
          uid: user.uid,
          stage: 'firstAction',
          fields: {
            ...(finalName ? { name: finalName } : {}),
            ...(finalCompany ? { company: finalCompany } : {}),
          },
        })
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[sandbox] first-action write failed', err)
      }
    })()
  }

  function dismiss() {
    onClose()
    if (!user) return
    void updateDoc(tenantDoc('_meta', 'main'), {
      'contactCapture.dismissals.firstAction': serverTimestamp(),
    }).catch((err) => {
      if (typeof console !== 'undefined') console.warn('[sandbox] first-action dismiss write failed', err)
    })
  }

  const title = existingName ? `👋 Quick one, ${existingName.split(/\s+/)[0]}` : '👋 Quick one'
  const blurb = existingName
    ? "You're getting the hang of this. What company are you with?"
    : "You're getting the hang of this. Mind sharing who you are?"

  const canSubmit = existingName ? company.trim().length > 0 : (name.trim() || company.trim())

  return (
    <CaptureSlideIn title={title} onClose={dismiss}>
      <p className="text-sm text-fg-muted">{blurb}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="mt-4 space-y-3"
      >
        {existingName ? null : (
          <label className="block">
            <span className="block text-xs font-medium text-fg-subtle">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-fill-2 px-3 text-sm text-fg outline-none focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
            />
          </label>
        )}
        <label className="block">
          <span className="block text-xs font-medium text-fg-subtle">Company</span>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-fill-2 px-3 text-sm text-fg outline-none focus:border-brand-edge focus:ring-2 focus:ring-brand-ring"
          />
        </label>
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-fg-subtle transition hover:text-fg-muted"
          >
            Skip for now
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--sandbox-accent,#a78bfa)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </form>
    </CaptureSlideIn>
  )
}
