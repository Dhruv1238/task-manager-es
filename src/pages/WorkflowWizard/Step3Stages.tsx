import { useState } from 'react'
import { AssistantBubble, WizardFooter } from '../../components/wizard'

interface Props {
  initialStageNames: string[]
  onBack: () => void
  onContinue: (stageNames: string[]) => void
}

const MIN_STAGES = 2
const MAX_STAGES = 15

// Phase 2c step 3: stage list builder. Notably absent: a "lead role name"
// question — that inherits from orgStructure.leadRoleName so we don't ask
// twice. The last entry is always the terminal stage (visualized with a flag).
export default function Step3Stages({ initialStageNames, onBack, onContinue }: Props) {
  const [names, setNames] = useState<string[]>(
    initialStageNames.length >= MIN_STAGES
      ? initialStageNames
      : ['In Progress', 'Completed'],
  )

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  function updateName(idx: number, next: string) {
    setNames(names.map((n, j) => (j === idx ? next : n)))
  }

  function addStage() {
    if (names.length >= MAX_STAGES) return
    setNames([...names.slice(0, names.length - 1), 'New stage', names[names.length - 1]])
  }

  function removeStage(idx: number) {
    if (names.length <= MIN_STAGES) return
    setNames(names.filter((_, j) => j !== idx))
  }

  const canContinue = names.length >= MIN_STAGES && names.every((n) => n.trim())

  return (
    <div className="space-y-4">
      <AssistantBubble>
        <p className="text-sm text-fg">
          What stages do projects move through? Add 2–15 in order — you'll define the details
          (actions, who can click them) next.
        </p>
      </AssistantBubble>

      <ul className="space-y-2">
        {names.map((n, idx) => {
          const isLast = idx === names.length - 1
          return (
            <li key={idx} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-fg-subtle">{idx + 1}.</span>
              <input
                type="text"
                value={n}
                onChange={(e) => updateName(idx, e.target.value)}
                className={inputCls}
              />
              {isLast && (
                <span
                  title="The last stage is the final stage — projects here are considered complete."
                  className="inline-flex h-7 items-center rounded-full bg-fill-3 px-2 text-[10px] uppercase tracking-wider text-fg-subtle"
                >
                  Final
                </span>
              )}
              <button
                type="button"
                onClick={() => removeStage(idx)}
                disabled={names.length <= MIN_STAGES}
                aria-label="Remove stage"
                className="rounded-md px-2 py-1 text-sm text-fg-subtle transition hover:bg-fill-2 hover:text-tone-danger-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-subtle"
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={addStage}
        disabled={names.length >= MAX_STAGES}
        className="text-xs font-medium text-brand-link hover:underline disabled:opacity-40 disabled:hover:no-underline"
      >
        + Add stage
      </button>

      <WizardFooter
        onBack={onBack}
        onPrimary={() =>
          onContinue(names.map((n) => n.trim()).filter(Boolean))
        }
        primaryLabel="Finish skeleton → Editor"
        primaryDisabled={!canContinue}
      />
    </div>
  )
}
