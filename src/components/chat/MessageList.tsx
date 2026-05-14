import { useMemo, type ReactNode } from 'react'
import MessageRow from './MessageRow'
import { useAllUsers } from '../../hooks/useAllUsers'
import type { ChatMessage, User } from '../../types/models'

interface Props {
  messages: ChatMessage[]
  currentUserId: string | null
  onEdit?: (messageId: string, newText: string) => Promise<void>
}

// Group consecutive messages from the same author within a 5-minute window so
// only the first row in the group renders the avatar + author header — same
// pattern as Slack/Discord. Keeps the panel scannable without packing too much
// metadata per message.
const GROUP_WINDOW_MS = 5 * 60 * 1000

function sameGroup(a: ChatMessage, b: ChatMessage): boolean {
  if (a.authorId !== b.authorId) return false
  const ta = a.createdAt?.toMillis?.() ?? 0
  const tb = b.createdAt?.toMillis?.() ?? 0
  return Math.abs(tb - ta) <= GROUP_WINDOW_MS
}

function dayKey(ts: ChatMessage['createdAt']): string {
  const d = ts?.toDate?.() ?? new Date(0)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function fmtDayLabel(ts: ChatMessage['createdAt']): string {
  const d = ts?.toDate?.() ?? new Date()
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function MessageList({ messages, currentUserId, onEdit }: Props) {
  const { users } = useAllUsers()
  const usersById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-fg-subtle">
        No messages yet. Start the conversation.
      </div>
    )
  }

  const elements: ReactNode[] = []
  let prevDay: string | null = null

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    const day = dayKey(msg.createdAt)
    if (day !== prevDay) {
      elements.push(
        <div
          key={`day-${day}-${i}`}
          className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-faint"
        >
          <span className="h-px flex-1 bg-line-subtle" aria-hidden />
          <span>{fmtDayLabel(msg.createdAt)}</span>
          <span className="h-px flex-1 bg-line-subtle" aria-hidden />
        </div>,
      )
      prevDay = day
    }

    const prev = i > 0 ? messages[i - 1] : null
    const showAuthor = !prev || day !== dayKey(prev.createdAt) || !sameGroup(prev, msg)
    const isOwn = msg.authorId === currentUserId

    elements.push(
      <MessageRow
        key={msg.id}
        message={msg}
        author={usersById.get(msg.authorId)}
        isOwn={isOwn}
        showAuthor={showAuthor}
        onEdit={isOwn && onEdit ? (newText) => onEdit(msg.id, newText) : undefined}
      />,
    )
  }

  return <div className="px-4 pb-2 pt-1">{elements}</div>
}
