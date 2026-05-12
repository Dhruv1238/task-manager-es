import { useState } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { useComments } from '../../hooks/useComments'
import { addComment } from '../../lib/firestore'
import type { Comment, User } from '../../types/models'

interface Props {
  taskId: string
  users: Map<string, User>
}

function initialsFor(name: string, email?: string): string {
  const src = name || email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ name, email, size = 28 }: { name: string; email?: string; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initialsFor(name, email)}
    </div>
  )
}

function formatWhen(ts: Timestamp | undefined): string {
  if (!ts) return 'just now'
  const d = ts.toDate()
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function CommentItem({ comment, users }: { comment: Comment; users: Map<string, User> }) {
  const author = users.get(comment.authorId)
  return (
    <div className="flex gap-3">
      <Avatar
        name={comment.authorName || author?.displayName || ''}
        email={author?.email}
        size={32}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-fg">
            {comment.authorName || author?.displayName || 'Unknown'}
          </span>
          <span className="text-xs text-fg-subtle">{formatWhen(comment.createdAt)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-strong">
          {comment.content}
        </p>
      </div>
    </div>
  )
}

export default function CommentsSection({ taskId, users }: Props) {
  const { user, profile } = useAuth()
  const { comments, loading } = useComments(taskId)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePost() {
    if (!user || !profile) return
    const content = draft.trim()
    if (!content) return
    setError(null)
    setSubmitting(true)
    try {
      await addComment({
        taskId,
        authorId: user.uid,
        authorName: profile.displayName,
        content,
      })
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-subtle">
        Comments <span className="text-fg-muted">({comments.length})</span>
      </h3>

      {loading ? (
        <div className="rounded-xl border border-line bg-card p-4 text-center text-xs text-fg-subtle">
          Loading…
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-sm text-fg-subtle">
          No comments yet. Be the first to share context.
        </div>
      ) : (
        <div className="space-y-5">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} users={users} />
          ))}
        </div>
      )}

      {user && profile && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void handlePost()
          }}
          className="mt-6 flex gap-3"
        >
          <Avatar name={profile.displayName} email={profile.email} size={32} />
          <div className="flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              disabled={submitting}
              className="w-full resize-none rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
            />
            {error && (
              <div
                role="alert"
                className="mt-2 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
              >
                {error}
              </div>
            )}
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!draft.trim() || submitting}
                className="rounded-lg bg-brand-gradient px-4 py-1.5 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Posting…' : 'Comment'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}