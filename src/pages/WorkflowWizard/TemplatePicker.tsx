import { useState } from 'react'
import { AssistantBubble, WizardFooter } from '../../components/wizard'
import { useOrgStructure } from '../../contexts/AppConfigContext'

export type TemplateChoice = 'blank' | 'basic' | 'collab-default' | 'sales-default'

interface Props {
  onContinue: (choice: TemplateChoice) => void
  onCancel: () => void
  // Onboarding mode swaps the Cancel button for "I'll do this later" and adds
  // a recap of the user's org choices above the cards.
  mode: 'standalone' | 'onboarding'
  onSkipWithBasic?: () => void
}

interface Card {
  value: TemplateChoice
  title: string
  subtitle: string
  detail: string
  aiRecommended?: boolean
}

const CARDS: Card[] = [
  {
    value: 'blank',
    title: 'Start blank',
    subtitle: 'Shape every detail yourself',
    detail: "Best when none of the templates fit. You'll name the workflow, define stages, and wire up actions from scratch.",
  },
  {
    value: 'basic',
    title: 'Simple Project',
    subtitle: 'Simple status flow',
    detail: '2 stages: In Progress → Completed. Best for one-owner projects with no hand-offs.',
    aiRecommended: true,
  },
  {
    value: 'collab-default',
    title: 'Collaborative Project',
    subtitle: 'Multi-team flow',
    detail: 'Hand-offs between teams — allocation, eligibility review, task setup, execution, validation, delivery.',
    aiRecommended: true,
  },
  {
    value: 'sales-default',
    title: 'Sales Pipeline',
    subtitle: 'Individual flow',
    detail: 'Each item owned by one person who moves it through stages — new lead, engaged, proposal, won/lost.',
    aiRecommended: true,
  },
]

// Phase 2c: entry point for the workflow wizard. Four cards in a 2×2 grid;
// "Start blank" is pre-selected with the (recommended) hint.
export default function TemplatePicker({
  onContinue,
  onCancel,
  mode,
  onSkipWithBasic,
}: Props) {
  const org = useOrgStructure()
  const [picked, setPicked] = useState<TemplateChoice>('blank')

  const recapItems: string[] = []
  if (mode === 'onboarding') {
    recapItems.push(`${org.leadRoleName || 'Project Lead'} running projects`)
    const roles: string[] = []
    if (org.teamRoles.hasCoordinator) roles.push('Coordinator')
    if (org.teamRoles.hasValidator) roles.push('Validator')
    if (org.teamRoles.hasSpecialist) roles.push('Specialist')
    if (roles.length) recapItems.push(`${roles.join(' · ')} teams`)
    if (org.workTypes.length)
      recapItems.push(`work types: ${org.workTypes.slice(0, 3).join(', ')}${org.workTypes.length > 3 ? '…' : ''}`)
  }

  return (
    <div className="space-y-6">
      <AssistantBubble>
        {mode === 'onboarding' ? (
          <>
            <p className="text-sm text-fg">
              Final step — let's shape how your work moves through stages.
            </p>
            {recapItems.length > 0 && (
              <p className="mt-2 text-xs text-fg-subtle">
                Your org: {recapItems.join(' · ')}.
              </p>
            )}
            <p className="mt-2 text-xs text-fg-subtle">
              Start from a template that's close to what you need — everything stays editable
              once it's loaded. Or build from scratch if you'd rather define every detail
              yourself.
            </p>
          </>
        ) : (
          <p className="text-sm text-fg">
            Pick a template that's close to your work — every stage, action, and label is
            editable once it loads, so you can fine-tune to fit. Or start blank if you'd
            rather shape every detail yourself.
          </p>
        )}
      </AssistantBubble>

      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const active = picked === card.value
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => setPicked(card.value)}
              className={`flex flex-col items-start gap-1 rounded-2xl border px-4 py-4 text-left transition ${
                active
                  ? 'border-brand-edge bg-brand-soft ring-2 ring-brand-ring'
                  : 'border-line bg-fill-1 hover:border-line-strong hover:bg-fill-2'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full border ${
                    active
                      ? 'border-brand-edge bg-brand-edge'
                      : 'border-line bg-transparent'
                  }`}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-fg">{card.title}</span>
                {card.aiRecommended && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-brand-edge/40 bg-brand-soft/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-strong"
                    title="Suggested based on common patterns for your org shape"
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M12 3 14 9l6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />
                    </svg>
                    AI recommended
                  </span>
                )}
              </div>
              <div className="text-xs font-medium text-fg-muted">{card.subtitle}</div>
              <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{card.detail}</p>
            </button>
          )
        })}
      </div>

      <WizardFooter
        onSkip={mode === 'onboarding' ? onSkipWithBasic : onCancel}
        skipLabel={mode === 'onboarding' ? "I'll do this later — use Simple Project" : 'Cancel'}
        onPrimary={() => onContinue(picked)}
        primaryLabel="Continue"
      />
    </div>
  )
}
