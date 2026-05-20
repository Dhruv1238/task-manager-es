import type { ReactNode } from 'react'
import KiethAI from './KiethAI'

interface Props {
  // Question / prompt the assistant is asking. Plain text or markup.
  // Optional so callers can pass content via `children` for richer markup
  // (Phase 2c's workflow wizard uses children-only for multi-paragraph copy).
  text?: ReactNode
  // Input controls for the user's answer to this question. Rendered inside
  // the bubble below the prompt so the conversational flow stays cohesive.
  // When `text` is omitted, the bubble shows children directly.
  children?: ReactNode
  // Hides the orb avatar — used when stacking multiple assistant bubbles
  // close together and only the first needs the avatar.
  hideAvatar?: boolean
}

export default function AssistantBubble({ text, children, hideAvatar = false }: Props) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-14 shrink-0">
        {hideAvatar ? <div className="h-14 w-14" /> : <KiethAI size={56} />}
      </div>
      <div className="flex-1 space-y-3">
        {text !== undefined ? (
          <>
            <div className="rounded-2xl rounded-tl-md border border-line bg-card px-5 py-4 text-sm text-fg shadow-sm shadow-purple-900/5 sm:text-base">
              {text}
            </div>
            {children}
          </>
        ) : (
          <div className="rounded-2xl rounded-tl-md border border-line bg-card px-5 py-4 text-sm text-fg shadow-sm shadow-purple-900/5 sm:text-base">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
