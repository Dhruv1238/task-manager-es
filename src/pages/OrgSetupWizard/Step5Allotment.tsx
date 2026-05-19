import AssistantBubble from './components/AssistantBubble'
import UserBubble from './components/UserBubble'
import WizardFooter from './components/WizardFooter'

interface Props {
  summary: string
  onSubmit: () => void
  onBack: () => void
  onSkip: () => void
}

interface AllotmentOption {
  key: 'manual' | 'pool' | 'auto'
  title: string
  description: string
  available: boolean
}

const OPTIONS: AllotmentOption[] = [
  {
    key: 'manual',
    title: 'Manual',
    description: 'Someone picks the lead when creating each project.',
    available: true,
  },
  {
    key: 'pool',
    title: 'Pool',
    description: 'Projects sit in a queue; leads pick what they want.',
    available: false,
  },
  {
    key: 'auto',
    title: 'Auto',
    description: 'Rules decide automatically based on workload, expertise, or territory.',
    available: false,
  },
]

// Step 5 — Allotment. Manual is the only selectable option in phase 1.
// Pool and Auto render with "Coming soon" pills to signal the roadmap.
export default function Step5Allotment({ summary, onSubmit, onBack, onSkip }: Props) {
  return (
    <>
      <UserBubble text={summary} />

      <AssistantBubble
        text={<>Last question. When a new project is created, how does it get assigned to a project lead?</>}
      >
        <div className="space-y-2.5">
          {OPTIONS.map((opt) => {
            const selected = opt.key === 'manual'
            return (
              <div
                key={opt.key}
                aria-disabled={!opt.available}
                className={`flex items-start gap-3 rounded-xl border p-4 transition ${
                  selected
                    ? 'border-brand-edge bg-brand-soft/40'
                    : opt.available
                      ? 'border-line bg-fill-2'
                      : 'cursor-not-allowed border-line bg-fill-2/60 opacity-60'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    selected
                      ? 'border-brand-edge bg-brand-gradient'
                      : 'border-line-strong bg-canvas'
                  }`}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-white" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">{opt.title}</span>
                    {!opt.available && (
                      <span className="rounded-full bg-fill-3 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-fg-subtle">
                    {opt.description}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </AssistantBubble>

      <WizardFooter
        onBack={onBack}
        onSkip={onSkip}
        onPrimary={onSubmit}
        primaryLabel="Continue"
      />
    </>
  )
}
