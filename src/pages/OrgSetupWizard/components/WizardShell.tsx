import type { ReactNode } from 'react'
import KiethAI from './KiethAI'
import ProgressBar from './ProgressBar'

interface Props {
  // Headline shown above the wizard card (e.g. "Set up your organization").
  title: string
  step: number
  totalSteps: number
  children: ReactNode
}

// Full-bleed dark canvas matching the Login screen's aesthetic — ambient
// gradient orbs, subtle grid, centered conversational card with assistant
// orb hovering above.
export default function WizardShell({ title, step, totalSteps, children }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-fg">
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-135 w-135 rounded-full bg-orb-a blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-130 w-130 rounded-full bg-orb-b blur-3xl" />

      {/* Subtle grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-fg) 1px, transparent 1px), linear-gradient(90deg, var(--color-fg) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 85%)',
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
        {/* Floating orb above the card */}
        <div className="mb-4">
          <KiethAI size={140} />
        </div>

        <h1 className="mb-3 text-center text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          {title}
        </h1>

        {__IS_SANDBOX__ ? (
          <p className="mx-auto mb-6 max-w-md text-center text-xs text-fg-subtle">
            In a real deployment you'd configure this for your team. In the sandbox we've pre-filled an example — feel free to change anything.
          </p>
        ) : (
          <div className="mb-6" />
        )}

        <div className="w-full rounded-3xl border border-line bg-card/70 p-6 shadow-xl shadow-purple-900/10 backdrop-blur-sm sm:p-8">
          <div className="mb-6">
            <ProgressBar current={step} total={totalSteps} />
          </div>
          <div className="space-y-4">{children}</div>
        </div>
      </div>
    </div>
  )
}
