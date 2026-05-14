import type { Timestamp } from 'firebase/firestore'

interface Props {
  // Latest chat activity on the project (`projects/{id}.chatLastMessageAt`).
  chatLastMessageAt: Timestamp | undefined
  // The user's last read timestamp for this project
  // (`users/{uid}.chatLastReadAt[projectId]`).
  lastReadAt: Timestamp | undefined
  className?: string
}

function ChatBubbleIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

// Project-list unread chat indicator. Both inputs are already in memory when
// the card renders (project doc + profile), so this costs zero extra reads.
// Renders nothing when the user has caught up or chat has never been used on
// the project.
export default function UnreadChatBadge({
  chatLastMessageAt,
  lastReadAt,
  className,
}: Props) {
  if (!chatLastMessageAt) return null
  const lastMs = chatLastMessageAt.toMillis?.() ?? 0
  const readMs = lastReadAt?.toMillis?.() ?? 0
  if (lastMs <= readMs) return null

  return (
    <span
      role="status"
      aria-label="New chat messages"
      title="New chat messages on this project"
      className={`inline-flex items-center gap-1 rounded-full border border-brand-edge bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand ${
        className ?? ''
      }`}
    >
      <ChatBubbleIcon />
      <span>New</span>
    </span>
  )
}
