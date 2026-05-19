import type { ReactNode } from 'react'

interface Props {
  text: ReactNode
}

// Right-aligned reply bubble showing the user's answer to a previous step.
// Matches the purple gradient chip from the supplied screenshots.
export default function UserBubble({ text }: Props) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 sm:text-base">
        {text}
      </div>
    </div>
  )
}
