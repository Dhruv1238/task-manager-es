import { useState } from 'react'
import { AssistantBubble, WizardFooter } from '../../components/wizard'

interface Props {
  initialName: string
  initialDescription: string
  onBack: () => void
  onContinue: (name: string, description: string) => void
}

// Phase 2c step 1: name + optional description. No lead-role-name question
// here — that's inherited from the org wizard's leadRoleName.
export default function Step1Name({
  initialName,
  initialDescription,
  onBack,
  onContinue,
}: Props) {
  const [name, setName] = useState(initialName || 'Untitled Workflow')
  const [description, setDescription] = useState(initialDescription)

  const canContinue = !!name.trim()
  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <div className="space-y-4">
      <AssistantBubble>
        <p className="text-sm text-fg">Let's create a new workflow. What's it called?</p>
      </AssistantBubble>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="wf-name" className="text-sm font-medium text-fg-muted">
            Name
          </label>
          <input
            id="wf-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="wf-description" className="text-sm font-medium text-fg-muted">
            Description <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <textarea
            id="wf-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What kind of work does this workflow track?"
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>
      </div>

      <WizardFooter
        onBack={onBack}
        onPrimary={() => onContinue(name.trim(), description.trim())}
        primaryLabel="Continue"
        primaryDisabled={!canContinue}
      />
    </div>
  )
}
