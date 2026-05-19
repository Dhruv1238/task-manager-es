import { useEffect, useState } from 'react'
import KiethAI from './components/KiethAI'

// Progressive-loading panel shown while the wizard's finish-batch writes.
// Matches the visual rhythm of screenshot 4. Sub-tasks tick from spinner →
// check as the underlying save progresses. We cap the floor at 1.2s so the
// transition reads as deliberate rather than a flash.
interface Props {
  steps: { key: string; label: string }[]
  // Index of the step currently in-flight (everything below is "pending",
  // everything above is "done"). Set to steps.length when all done.
  currentIndex: number
}

export default function Step6FinishingOverlay({ steps, currentIndex }: Props) {
  // Simple intra-step ticker so the spinner doesn't feel frozen on a fast network.
  const [ellipsis, setEllipsis] = useState('')
  useEffect(() => {
    const t = window.setInterval(() => {
      setEllipsis((s) => (s.length >= 3 ? '' : s + '.'))
    }, 350)
    return () => window.clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <KiethAI size={140} />
      <div className="text-center">
        <h2 className="text-xl font-semibold text-fg">Setting up your workspace</h2>
        <p className="mt-1.5 text-sm text-fg-subtle">
          We're tailoring everything using the answers you just shared.
        </p>
      </div>

      <ul className="w-full max-w-sm space-y-2">
        {steps.map((s, idx) => {
          const done = idx < currentIndex
          const active = idx === currentIndex
          return (
            <li
              key={s.key}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition ${
                done
                  ? 'border-tone-success-bd bg-tone-success-bg/40 text-tone-success-fg'
                  : active
                    ? 'border-brand-edge bg-brand-soft/40 text-fg'
                    : 'border-line bg-fill-2 text-fg-subtle'
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {done ? (
                  <svg viewBox="0 0 16 16" fill="none" className="h-5 w-5" aria-hidden>
                    <path
                      d="M3.5 8.5L6.5 11.5L12.5 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : active ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-edge border-t-transparent" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-line-strong" />
                )}
              </span>
              <span>
                {s.label}
                {active && ellipsis}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
