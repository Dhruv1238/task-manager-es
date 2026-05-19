import { useState } from 'react'
import AssistantBubble from './components/AssistantBubble'
import UserBubble from './components/UserBubble'
import WizardFooter from './components/WizardFooter'

interface TeamRoles {
  hasCoordinator: boolean
  hasValidator: boolean
  hasSpecialist: boolean
}

interface Props {
  leadRoleName: string
  initialRoles: TeamRoles
  onSubmit: (roles: TeamRoles) => void
  onBack: () => void
  onSkip: () => void
}

interface RoleCard {
  key: keyof TeamRoles
  title: string
  description: string
}

const ROLE_CARDS: RoleCard[] = [
  {
    key: 'hasCoordinator',
    title: 'A team that handles client communication and coordination',
    description:
      "Sometimes called Client Servicing, Account Management, or Project Coordination. They're the bridge between your clients and your internal teams.",
  },
  {
    key: 'hasValidator',
    title: 'A team that reviews work before it goes to the client',
    description:
      'Sometimes called Quality Check, Strategy Review, or Editorial. They make sure deliverables are right before they ship.',
  },
  {
    key: 'hasSpecialist',
    title: 'Specialist teams that produce the actual work',
    description:
      'Like Design, Video Editing, Copy, or whatever your craft teams are called. Tick this if you have one or more.',
  },
]

// Step 2 — Team types. Three toggle cards, none pre-selected. All-empty is
// a valid answer (a single-rep sales org would pick this).
export default function Step2TeamTypes({
  leadRoleName,
  initialRoles,
  onSubmit,
  onBack,
  onSkip,
}: Props) {
  const [roles, setRoles] = useState<TeamRoles>(initialRoles)

  function toggle(key: keyof TeamRoles) {
    setRoles((r) => ({ ...r, [key]: !r[key] }))
  }

  return (
    <>
      <UserBubble text={leadRoleName} />

      <AssistantBubble
        text={
          <>
            Now your teams. Different companies are organized differently — tick the kinds of
            teams you have. Skip the ones you don't.
          </>
        }
      >
        <div className="space-y-2.5">
          {ROLE_CARDS.map((card) => {
            const checked = roles[card.key]
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => toggle(card.key)}
                aria-pressed={checked}
                className={`group flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                  checked
                    ? 'border-brand-edge bg-brand-soft/40'
                    : 'border-line bg-fill-2 hover:bg-fill-3'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                    checked
                      ? 'border-brand-edge bg-brand-gradient text-white'
                      : 'border-line-strong bg-canvas'
                  }`}
                >
                  {checked && (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    >
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{card.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-subtle">
                    {card.description}
                  </span>
                </span>
              </button>
            )
          })}
          <p className="pt-1 text-xs text-fg-subtle">
            Not sure? You can skip this and set it up later.
          </p>
        </div>
      </AssistantBubble>

      <WizardFooter
        onBack={onBack}
        onSkip={onSkip}
        onPrimary={() => onSubmit(roles)}
        primaryLabel="Continue"
      />
    </>
  )
}
