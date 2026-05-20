import { useState } from 'react'
import { AssistantBubble, WizardFooter } from '../../components/wizard'
import type { FlowType } from '../../types/workflow'

interface Props {
  initialFlowType: FlowType
  onBack: () => void
  onContinue: (flowType: FlowType) => void
}

interface Choice {
  value: FlowType
  title: string
  blurb: string
}

const CHOICES: Choice[] = [
  {
    value: 'basic',
    title: 'Owner-driven',
    blurb: 'One person owns each project from start to finish. They add teams as needed.',
  },
  {
    value: 'collaborative',
    title: 'Multi-team collaborative',
    blurb: 'Multiple teams hand off work between stages — assignment, review, delivery.',
  },
  {
    value: 'individual',
    title: 'Individual pipeline',
    blurb:
      'Each item is owned by one person who moves it through defined stages — like a sales flow.',
  },
]

// Phase 2c step 2: flow type radio. Defaults to collaborative — the most
// common shape for the events vertical and the safest superset for misclicks.
export default function Step2FlowType({ initialFlowType, onBack, onContinue }: Props) {
  const [picked, setPicked] = useState<FlowType>(initialFlowType || 'collaborative')

  return (
    <div className="space-y-4">
      <AssistantBubble>
        <p className="text-sm text-fg">What shape is this work? Pick the closest match.</p>
        <p className="mt-2 text-xs text-fg-subtle">
          Don't worry if you're between two — you can change this later by editing the workflow.
        </p>
      </AssistantBubble>

      <div className="grid gap-3 sm:grid-cols-3">
        {CHOICES.map((c) => {
          const active = picked === c.value
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setPicked(c.value)}
              className={`rounded-2xl border px-4 py-4 text-left transition ${
                active
                  ? 'border-brand-edge bg-brand-soft ring-2 ring-brand-ring'
                  : 'border-line bg-fill-1 hover:border-line-strong hover:bg-fill-2'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full border ${
                    active ? 'border-brand-edge bg-brand-edge' : 'border-line'
                  }`}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-fg">{c.title}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{c.blurb}</p>
            </button>
          )
        })}
      </div>

      <WizardFooter
        onBack={onBack}
        onPrimary={() => onContinue(picked)}
        primaryLabel="Continue"
      />
    </div>
  )
}
