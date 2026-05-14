import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Avatar from '../ui/Avatar'
import MessageAttachments from './MessageAttachments'
import { fmtClock, fmtRelative } from '../../lib/formatTime'
import type { ChatMessage, User } from '../../types/models'

interface Props {
  message: ChatMessage
  author: User | undefined
  isOwn: boolean
  showAuthor: boolean
  onEdit?: (newText: string) => Promise<void>
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

export default function MessageRow({ message, author, isOwn, showAuthor, onEdit }: Props) {
  const name = author?.displayName ?? 'Unknown'
  const edited = Boolean(message.editedAt)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [editing])

  function startEdit() {
    setDraft(message.text)
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(message.text)
    setError(null)
  }

  async function commitEdit() {
    if (!onEdit) return
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Message cannot be empty.')
      return
    }
    if (trimmed === message.text) {
      cancelEdit()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onEdit(trimmed)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  function handleEditKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void commitEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  return (
    <div className={`group flex gap-3 ${showAuthor ? 'mt-4' : 'mt-1'}`}>
      <div className="w-8 shrink-0">
        {showAuthor ? (
          <Avatar user={author} size={32} />
        ) : (
          <span
            className="block text-right text-[10px] leading-8 text-fg-faint opacity-0 transition group-hover:opacity-100"
            aria-hidden
          >
            {fmtClock(message.createdAt)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showAuthor && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-fg">
              {isOwn ? `${name} (you)` : name}
            </span>
            <span
              className="text-[11px] text-fg-subtle"
              title={message.createdAt?.toDate().toLocaleString()}
            >
              {fmtRelative(message.createdAt)}
            </span>
            {edited && !editing && (
              <span
                className="text-[11px] text-fg-faint"
                title={message.editedAt?.toDate().toLocaleString()}
              >
                (edited)
              </span>
            )}
          </div>
        )}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="mt-0.5">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
                  }}
                  onKeyDown={handleEditKey}
                  disabled={saving}
                  rows={1}
                  className="w-full resize-none rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
                />
                <div className="mt-1 flex items-center justify-end gap-2">
                  <span className="mr-auto text-[11px] text-fg-faint">
                    Enter to save · Esc to cancel
                  </span>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:bg-fill-3 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void commitEdit()}
                    disabled={saving || !draft.trim()}
                    className="rounded-md bg-brand-gradient px-3 py-1 text-xs font-medium text-white shadow shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {error && (
                  <div
                    role="alert"
                    className="mt-1 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-2.5 py-1.5 text-[11px] text-tone-danger-fg"
                  >
                    {error}
                  </div>
                )}
              </div>
            ) : (
              <>
                {message.text && (
                  <p className={`mt-0.5 whitespace-pre-wrap break-words text-sm ${isOwn ? 'text-fg' : 'text-fg-strong'}`}>
                    {message.text}
                    {!showAuthor && edited && (
                      <span
                        className="ml-1 text-[11px] text-fg-faint"
                        title={message.editedAt?.toDate().toLocaleString()}
                      >
                        (edited)
                      </span>
                    )}
                  </p>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <MessageAttachments attachments={message.attachments} />
                )}
              </>
            )}
          </div>
          {!editing && isOwn && onEdit && (
            <button
              type="button"
              onClick={startEdit}
              aria-label="Edit message"
              title="Edit"
              className="ml-auto shrink-0 rounded-md p-1.5 text-fg-subtle opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 hover:bg-fill-2 hover:text-fg-strong focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <PencilIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
