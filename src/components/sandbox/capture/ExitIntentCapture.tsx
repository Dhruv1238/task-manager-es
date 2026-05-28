import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { serverTimestamp, updateDoc } from 'firebase/firestore'
import { tenantDoc } from '../../../lib/firestore'
import { captureStage } from '../../../lib/leadCapture'

export default function ExitIntentCapture({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
  }, [])

  // Optimistic close: dismiss the modal immediately so the visitor sees their
  // click respond, then write to Firestore in the background. Writes that fail
  // don't trap the visitor — the entry-stage lead doc already has their email,
  // and exitIntent is the lowest-stakes capture.
  function handleChoice(wantsRecap: boolean) {
    onClose()
    if (!user) return
    void (async () => {
      try {
        await updateDoc(tenantDoc('_meta', 'main'), {
          'visitor.wantsRecap': wantsRecap,
          'contactCapture.exitIntent': true,
          lastSeenAt: serverTimestamp(),
        })
        await captureStage({ uid: user.uid, stage: 'exitIntent', fields: { wantsRecap } })
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[sandbox] exit-intent write failed', err)
      }
    })()
  }

  const recapYes = () => handleChoice(true)
  const recapNo = () => handleChoice(false)

  return (
    <div
      role="dialog"
      aria-label="Heading out?"
      className={`fixed inset-x-0 top-20 z-[68] flex justify-center p-3 transition-all duration-240 ease-out ${
        mounted ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
      }`}
    >
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-line bg-card/95 px-5 py-4 shadow-lg backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-fg">Heading out? Want a recap email?</div>
          <div className="text-xs text-fg-subtle">A short summary of what you built + a few resources.</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={recapNo}
            className="rounded-lg px-3 py-1.5 text-sm text-fg-muted transition hover:bg-fill-2"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={recapYes}
            className="rounded-lg bg-brand-gradient px-3.5 py-1.5 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient"
          >
            Send me the recap
          </button>
        </div>
      </div>
    </div>
  )
}
