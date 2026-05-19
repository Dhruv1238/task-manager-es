import { useState } from 'react'
import AssistantBubble from './components/AssistantBubble'
import WizardFooter from './components/WizardFooter'

interface Props {
  initialValue: string
  onSubmit: (value: string) => void
  onSkip: () => void
}

const SUGGESTIONS = [
  'Account Manager',
  'Practice Lead',
  'Vertical Head',
  'Sales Manager',
  'Department Head',
]

const MAX_LEN = 50

// Step 1 — Leadership role name. Pre-filled with the current value so a
// reviewer's instinct is to read-and-confirm, not invent terminology.
export default function Step1LeadRole({ initialValue, onSubmit, onSkip }: Props) {
  const [value, setValue] = useState(initialValue || 'Project Lead')
  const trimmed = value.trim()
  const valid = trimmed.length > 0 && trimmed.length <= MAX_LEN

  return (
    <>
      <AssistantBubble
        text={
          <>
            Let's set up your organization. First — who runs projects at your company? Most
            companies have one person who owns each project end-to-end. What do you call them?
          </>
        }
      >
        <div className="space-y-3">
          <input
            type="text"
            value={value}
            maxLength={MAX_LEN}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Project Lead"
            autoFocus
            className="w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
          />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => {
              const selected = trimmed.toLowerCase() === s.toLowerCase()
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setValue(s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    selected
                      ? 'border-brand-edge bg-brand-soft text-brand'
                      : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-3'
                  }`}
                >
                  {s}
                </button>
              )
            })}
          </div>
          {!valid && trimmed.length === 0 && (
            <p className="text-xs text-tone-warn-fg/80">Pick a name or type your own.</p>
          )}
        </div>
      </AssistantBubble>

      <WizardFooter
        onSkip={onSkip}
        onPrimary={() => valid && onSubmit(trimmed)}
        primaryLabel="Continue"
        primaryDisabled={!valid}
      />
    </>
  )
}
