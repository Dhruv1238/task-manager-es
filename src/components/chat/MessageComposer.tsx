import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { uploadAsset } from '../../lib/uploadAsset'
import FileBadge, { formatFileSize } from '../ui/FileBadge'
import type { ChatAttachment } from '../../types/models'

interface Props {
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>
  disabled?: boolean
}

function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function MessageComposer({ onSend, disabled }: Props) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  function resize(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function handleDraftChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value)
    resize(e.target)
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''
    setError(null)
    setUploading(true)
    try {
      const uploaded = await Promise.all(files.map((f) => uploadAsset(f, 'chat')))
      const next: ChatAttachment[] = uploaded.map((r) => ({
        url: r.url,
        name: r.fileName,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        key: r.key,
      }))
      setAttachments((prev) => [...prev, ...next])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSend() {
    const text = draft.trim()
    if (!text && attachments.length === 0) return
    if (submitting || uploading) return
    setError(null)
    setSubmitting(true)
    try {
      await onSend(text, attachments)
      setDraft('')
      setAttachments([])
      resize(textareaRef.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !submitting && !uploading

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div
              key={`${a.url}-${i}`}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-fill-2 py-1 pl-1 pr-2"
            >
              <FileBadge mimeType={a.contentType} fileName={a.name} size={24} />
              <span className="min-w-0 truncate text-xs text-fg-muted" title={a.name}>
                {a.name}
              </span>
              <span className="text-[10px] text-fg-subtle">{formatFileSize(a.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${a.name}`}
                className="ml-1 rounded p-0.5 text-fg-subtle transition hover:bg-fill-3 hover:text-fg-strong"
              >
                <XIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          aria-label="Attach files"
          title="Attach files"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-fill-2 text-fg-muted transition hover:bg-fill-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong"
              aria-label="Uploading"
            />
          ) : (
            <PaperclipIcon />
          )}
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Type a message…"
          disabled={disabled || submitting}
          className="flex-1 resize-none rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label="Send message"
          title="Send (Enter)"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-gradient text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon />
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
        >
          {error}
        </div>
      )}
    </div>
  )
}
