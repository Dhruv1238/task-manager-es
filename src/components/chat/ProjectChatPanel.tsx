import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectChat } from '../../contexts/ProjectChatContext'
import MessageList from './MessageList'
import MessageComposer from './MessageComposer'
import NewMessagesPill from './NewMessagesPill'

interface Props {
  projectTitle?: string
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

const NEAR_BOTTOM_PX = 80

export default function ProjectChatPanel({ projectTitle }: Props) {
  const {
    isPanelOpen,
    closePanel,
    messages,
    loading,
    currentUserId,
    send,
    edit,
  } = useProjectChat()

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const wasNearBottomRef = useRef<boolean>(true)
  const lastSeenMessageIdRef = useRef<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const [newMessageCount, setNewMessageCount] = useState(0)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Escape to close.
  useEffect(() => {
    if (!isPanelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isPanelOpen, closePanel])

  // Track whether the user is currently near the bottom of the scroll area.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const near = distance <= NEAR_BOTTOM_PX
    wasNearBottomRef.current = near
    if (near) setNewMessageCount(0)
  }, [])

  // On open, pin to bottom and reset the "seen" cursor. Reads `messages` via
  // a ref so this effect only re-fires when the panel toggles open, not on
  // every new message.
  useLayoutEffect(() => {
    if (!isPanelOpen) return
    const snap = messagesRef.current
    lastSeenMessageIdRef.current = snap[snap.length - 1]?.id ?? null
    wasNearBottomRef.current = true
    setNewMessageCount(0)
    // Defer to next frame so the layout settles before we measure scrollHeight.
    requestAnimationFrame(() => scrollToBottom(false))
  }, [isPanelOpen, scrollToBottom])

  // React to new messages: auto-scroll if user was at the bottom, otherwise
  // increment the "↓ N new messages" pill.
  useLayoutEffect(() => {
    if (!isPanelOpen) return
    const lastId = messages[messages.length - 1]?.id ?? null
    const prevSeen = lastSeenMessageIdRef.current
    if (lastId === prevSeen) return

    // Count messages added after the last seen one.
    let addedCount = 0
    if (prevSeen == null) {
      addedCount = messages.length
    } else {
      const prevIdx = messages.findIndex((m) => m.id === prevSeen)
      addedCount = prevIdx === -1 ? messages.length : messages.length - 1 - prevIdx
    }

    const isOwnLatest =
      currentUserId != null &&
      messages[messages.length - 1]?.authorId === currentUserId

    if (wasNearBottomRef.current || isOwnLatest) {
      lastSeenMessageIdRef.current = lastId
      requestAnimationFrame(() => scrollToBottom(true))
    } else if (addedCount > 0) {
      setNewMessageCount((c) => c + addedCount)
    }
  }, [isPanelOpen, messages, currentUserId, scrollToBottom])

  const handleJumpToLatest = useCallback(() => {
    const lastId = messages[messages.length - 1]?.id ?? null
    lastSeenMessageIdRef.current = lastId
    setNewMessageCount(0)
    scrollToBottom(true)
  }, [messages, scrollToBottom])

  if (!isPanelOpen) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Project chat"
      className="fixed inset-y-0 right-0 z-40 flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-fg">Project chat</h2>
          {projectTitle && (
            <p className="truncate text-xs text-fg-subtle">{projectTitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Close chat"
          className="-mr-1 rounded-md p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-strong"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-themed h-full overflow-y-auto"
        >
          {loading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-10 text-center text-sm text-fg-subtle">
              Loading messages…
            </div>
          ) : (
            <MessageList messages={messages} currentUserId={currentUserId} onEdit={edit} />
          )}
        </div>
        <NewMessagesPill count={newMessageCount} onJump={handleJumpToLatest} />
      </div>

      <MessageComposer onSend={send} />
    </div>,
    document.body,
  )
}
