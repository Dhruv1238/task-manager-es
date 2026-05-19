import { useState } from 'react'
import { WORK_TYPE_SUGGESTIONS } from '../../types/models'
import AssistantBubble from './components/AssistantBubble'
import UserBubble from './components/UserBubble'
import WizardFooter from './components/WizardFooter'

interface Props {
  initialWorkTypes: string[]
  summary: string // user reply bubble text from prior steps
  onSubmit: (workTypes: string[]) => void
  onBack: () => void
  onSkip: () => void
}

const MAX_CHIP_LEN = 30

// Step 3 — Work types. Only rendered when step 2's specialist toggle is on.
// Free-form chip add/remove backed by WORK_TYPE_SUGGESTIONS primer chips.
export default function Step3WorkTypes({
  initialWorkTypes,
  summary,
  onSubmit,
  onBack,
  onSkip,
}: Props) {
  const [workTypes, setWorkTypes] = useState<string[]>(initialWorkTypes)
  const [draft, setDraft] = useState('')

  function add(value: string) {
    const v = value.trim()
    if (!v || v.length > MAX_CHIP_LEN) return
    if (workTypes.some((w) => w.toLowerCase() === v.toLowerCase())) return
    setWorkTypes((arr) => [...arr, v])
    setDraft('')
  }

  function remove(value: string) {
    setWorkTypes((arr) => arr.filter((w) => w !== value))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && workTypes.length > 0) {
      setWorkTypes((arr) => arr.slice(0, -1))
    }
  }

  const valid = workTypes.length > 0

  return (
    <>
      <UserBubble text={summary} />

      <AssistantBubble
        text={<>What kinds of work do your specialist teams handle? Add as many as fit.</>}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-fill-2 p-2.5 focus-within:border-brand-edge focus-within:ring-2 focus-within:ring-brand-ring">
            {workTypes.map((w) => (
              <span
                key={w}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand"
              >
                {w}
                <button
                  type="button"
                  onClick={() => remove(w)}
                  aria-label={`Remove ${w}`}
                  className="text-brand/70 transition hover:text-brand"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={workTypes.length === 0 ? 'Type a work type and press Enter…' : 'Add another…'}
              className="min-w-[12ch] flex-1 bg-transparent px-1 py-1 text-sm text-fg placeholder:text-fg-faint outline-none"
              maxLength={MAX_CHIP_LEN}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {WORK_TYPE_SUGGESTIONS.filter(
              (s) => !workTypes.some((w) => w.toLowerCase() === s.toLowerCase()),
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="rounded-full border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-3"
              >
                + {s}
              </button>
            ))}
          </div>

          {!valid && (
            <p className="text-xs text-tone-warn-fg/80">
              Add at least one work type to continue.
            </p>
          )}
        </div>
      </AssistantBubble>

      <WizardFooter
        onBack={onBack}
        onSkip={onSkip}
        onPrimary={() => valid && onSubmit(workTypes)}
        primaryLabel="Continue"
        primaryDisabled={!valid}
      />
    </>
  )
}
