import { useMemo, useRef, useState } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { useFeature } from '../../contexts/AppConfigContext'
import { useComments } from '../../hooks/useComments'
import { addComment } from '../../lib/firestore'
import MentionAutocomplete from './MentionAutocomplete'
import MentionText from './MentionText'
import type { Comment, User } from '../../types/models'

interface Props {
  taskId: string
  users: Map<string, User>
  projectId: string
  taskTitle: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A mention token survives only if '@DisplayName' appears followed by a word
// boundary — whitespace or end-of-string — so a name that is a prefix of
// another ("@Jon" inside "@Jonathan") is NOT falsely matched. insertMention
// always appends a trailing space, but the user may have deleted it, hence `$`.
function tokenSurvives(draft: string, displayName: string): boolean {
  return new RegExp(`@${escapeRegExp(displayName)}(\\s|$)`).test(draft)
}

// Scan back from the caret for an '@' at the start or after whitespace; the run
// up to the caret (no newline, ≤30 chars) is the mention query. null = closed.
function detectMention(text: string, caret: number): { start: number; query: string } | null {
  const at = text.lastIndexOf('@', caret - 1)
  if (at < 0) return null
  if (at > 0 && !/\s/.test(text[at - 1])) return null
  const between = text.slice(at + 1, caret)
  if (between.length > 30 || /\s/.test(between) || between.includes('@')) return null
  return { start: at, query: between.toLowerCase() }
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
  // Resolve mentioned uids → display names so their '@Name' tokens render as chips.
  const mentionNames = (comment.mentionedUids ?? [])
    .map((uid) => users.get(uid)?.displayName)
    .filter((n): n is string => !!n)
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
          <MentionText
            text={comment.content}
            names={mentionNames}
            chipClassName="rounded bg-brand-soft px-1 font-medium text-brand"
          />
        </p>
      </div>
    </div>
  )
}

export default function CommentsSection({ taskId, users, projectId, taskTitle }: Props) {
  const { user, profile } = useAuth()
  const mentionsOn = useFeature('notifications')
  const { comments, loading } = useComments(taskId)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Mention autocomplete state.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // uids inserted via the popup; the submit-time re-check drops any whose token
  // was subsequently deleted from the draft.
  const [mentioned, setMentioned] = useState<{ uid: string; displayName: string }[]>([])
  // Display names to chip-highlight in the live composer overlay.
  const mentionNames = useMemo(() => mentioned.map((m) => m.displayName), [mentioned])

  const suggestions = useMemo(() => {
    if (!mentionsOn || !mention) return []
    const q = mention.query
    return Array.from(users.values())
      .filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q),
      )
      .slice(0, 6)
  }, [mentionsOn, mention, users])

  function syncMention(value: string, caret: number) {
    if (!mentionsOn) return
    const next = detectMention(value, caret)
    setMention(next)
    setActiveIndex(0)
  }

  function insertMention(u: User) {
    if (!mention) return
    const ta = textareaRef.current
    const caret = ta ? ta.selectionStart : mention.start + 1 + mention.query.length
    const before = draft.slice(0, mention.start)
    const after = draft.slice(caret)
    const token = `@${u.displayName} `
    const nextValue = before + token + after
    setDraft(nextValue)
    setMentioned((prev) =>
      prev.some((m) => m.uid === u.uid) ? prev : [...prev, { uid: u.uid, displayName: u.displayName }],
    )
    setMention(null)
    // Restore caret just after the inserted token.
    const nextCaret = before.length + token.length
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus()
        ta.setSelectionRange(nextCaret, nextCaret)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertMention(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      // Close the popup WITHOUT bubbling to the TaskDetailModal's Escape handler.
      e.preventDefault()
      e.stopPropagation()
      setMention(null)
    }
  }

  async function handlePost() {
    if (!user || !profile) return
    const content = draft.trim()
    if (!content) return
    setError(null)
    setSubmitting(true)
    // Keep only mentions whose token still survives in the draft (boundary match
    // so a name that's a prefix of another isn't falsely retained).
    const mentionedUids = Array.from(
      new Set(mentioned.filter((m) => tokenSurvives(draft, m.displayName)).map((m) => m.uid)),
    )
    try {
      await addComment({
        taskId,
        authorId: user.uid,
        authorName: profile.displayName,
        content,
        ...(mentionsOn && mentionedUids.length
          ? { mentionedUids, projectId, taskTitle }
          : {}),
      })
      setDraft('')
      setMentioned([])
      setMention(null)
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
            <div className="relative rounded-lg border border-line bg-fill-2 transition focus-within:border-brand-edge focus-within:bg-fill-3 focus-within:ring-2 focus-within:ring-brand-ring">
              {/* Highlight overlay: mirrors the textarea's text metrics exactly and
                  draws a chip background behind each @mention token. Its own text is
                  transparent — the visible text comes from the textarea on top, so
                  the chip style MUST NOT change glyph metrics (no padding/weight),
                  or the highlight would drift out of alignment. */}
              <div
                ref={backdropRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap wrap-break-word px-3 py-2 text-sm text-transparent"
              >
                <MentionText
                  text={draft}
                  names={mentionNames}
                  chipClassName="rounded bg-brand-soft/70"
                />
                {'\n'}
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  syncMention(e.target.value, e.target.selectionStart)
                }}
                onClick={(e) => syncMention(draft, e.currentTarget.selectionStart)}
                onScroll={(e) => {
                  // Keep the highlight overlay aligned when the textarea scrolls.
                  if (backdropRef.current) {
                    backdropRef.current.scrollTop = e.currentTarget.scrollTop
                    backdropRef.current.scrollLeft = e.currentTarget.scrollLeft
                  }
                }}
                onKeyUp={(e) => {
                  // Track caret moves via arrow keys (not while the popup owns them).
                  if (!mention && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    syncMention(draft, e.currentTarget.selectionStart)
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="Write a comment… use @ to mention"
                rows={2}
                disabled={submitting}
                className="relative block w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none disabled:opacity-60"
              />
              {mention && (
                <MentionAutocomplete
                  users={suggestions}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                  onSelect={insertMention}
                />
              )}
            </div>
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