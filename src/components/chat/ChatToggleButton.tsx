import { useProjectChat } from '../../contexts/ProjectChatContext'

function ChatBubbleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function ChatToggleButton() {
  const { isPanelOpen, unreadCount, togglePanel } = useProjectChat()
  const label = isPanelOpen ? 'Close chat' : 'Open project chat'

  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-label={label}
      title={label}
      className="fixed bottom-6 right-6 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full border border-line bg-brand-gradient text-white shadow-2xl shadow-purple-900/40 transition hover-brand-gradient focus:outline-none focus:ring-2 focus:ring-brand-ring"
    >
      {isPanelOpen ? <CloseIcon /> : <ChatBubbleIcon />}
      {!isPanelOpen && unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`}
          className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-canvas bg-tone-danger-fg px-1 text-[10px] font-bold text-white"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
