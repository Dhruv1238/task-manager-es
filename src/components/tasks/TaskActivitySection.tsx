import { useState } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { useTaskAuditEvents } from '../../hooks/useTaskAuditEvents'
import { formatDuration } from '../../lib/duration'
import type { AuditEvent } from '../../types/models'

function fmtWhen(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtMillis(v: unknown): string {
  return typeof v === 'number' ? new Date(v).toLocaleDateString() : 'none'
}

function fmtMinutes(v: unknown): string {
  return typeof v === 'number' ? formatDuration(v) : 'time'
}

// Turn an audit event into a human sentence (subject is the actor, rendered
// separately). Payload keys are `unknown` — read defensively. Unknown/future
// actions fall back to the raw action string so the timeline never goes blank.
function describeAuditEvent(e: AuditEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>
  switch (e.action) {
    case 'task.created':
    case 'subtask.created':
      return 'created this task'
    case 'task.duplicated':
      return 'created this task by duplication'
    case 'task.status_changed':
      return `changed status ${String(p.from ?? '?')} → ${String(p.to ?? '?')}`
    case 'task.assignee_changed':
      if (p.toAssigneeId == null) return 'unassigned the task'
      return typeof p.toAssigneeName === 'string' && p.toAssigneeName
        ? `assigned the task to ${p.toAssigneeName}`
        : 'changed the assignee'
    case 'task.submitted_for_review':
      return 'submitted the task for review'
    case 'task.review_approved':
      return 'approved the review'
    case 'task.review_rejected':
      return 'sent the task back from review'
    case 'task.attachment_added':
      return 'added an attachment'
    case 'task.attachment_removed':
      return 'removed an attachment'
    case 'task.linked':
      return 'linked another task'
    case 'task.unlinked':
      return 'unlinked a task'
    case 'task.time_logged':
      return `logged ${fmtMinutes(p.minutes)}${p.dateKey ? ` for ${String(p.dateKey)}` : ''}`
    case 'task.time_updated':
      return `changed a time entry ${fmtMinutes(p.fromMinutes)} → ${fmtMinutes(p.toMinutes)}`
    case 'task.time_deleted':
      return `removed a time entry (${fmtMinutes(p.minutes)})`
    case 'task.updated': {
      const parts: string[] = []
      if (p.titleChanged) parts.push('renamed it')
      if (p.dueDate && typeof p.dueDate === 'object') {
        const d = p.dueDate as { from?: unknown; to?: unknown }
        parts.push(`due date ${fmtMillis(d.from)} → ${fmtMillis(d.to)}`)
      }
      return parts.length ? `edited the task (${parts.join(', ')})` : 'edited the task'
    }
    default:
      return e.action
  }
}

// Per-task Activity timeline: a lazy, read-on-demand view over the existing
// auditEvents trail (zero new writes). Fetches only on first expand.
//
// Known gaps (by design): a subtask's creation (`subtask.created`) is keyed to
// the CHILD's id, so a parent task's timeline won't list "subtask added";
// `task.unlinked` / `task.submitted_for_review` write standalone audit docs but
// still match by targetId, so they appear normally.
export default function TaskActivitySection({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false)
  const { events, loading, error } = useTaskAuditEvents(taskId, open)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-fg-subtle transition hover:text-fg"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Activity
      </button>

      {open && (
        <div className="rounded-xl border border-line bg-card p-4">
          {error ? (
            <div className="text-sm text-tone-danger-fg">
              Couldn&rsquo;t load activity.
              <div className="mt-1 text-xs text-tone-danger-fg/70">{error}</div>
            </div>
          ) : loading ? (
            <div className="text-center text-xs text-fg-subtle">Loading activity…</div>
          ) : events.length === 0 ? (
            <div className="text-center text-sm text-fg-subtle">No activity recorded yet.</div>
          ) : (
            <ul className="space-y-2.5">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                  <span className="font-medium text-fg">{e.actorName}</span>
                  <span className="text-fg-muted">{describeAuditEvent(e)}</span>
                  <span className="text-xs text-fg-faint">· {fmtWhen(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
