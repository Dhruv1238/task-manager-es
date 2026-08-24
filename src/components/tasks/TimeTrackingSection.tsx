import { useMemo, useState } from 'react'
import { Check, Clock, Pencil, Trash2, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useTaskTimeEntries } from '../../hooks/useTaskTimeEntries'
import { deleteTimeEntry, logTaskTime, updateTimeEntry } from '../../lib/firestore'
import {
  composeMinutes,
  formatDateKey,
  formatDuration,
  splitMinutes,
  todayDateKey,
} from '../../lib/duration'
import Avatar from '../ui/Avatar'
import type { Task, TimeEntry, User } from '../../types/models'

const inputCls =
  'rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

const errorCls =
  'mt-2 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg'

/**
 * Per-task time log (features.timeTracking).
 *
 * The heading total comes from `task.timeSpentMinutes` — the counter the write
 * batch increments — so it costs no reads and updates the instant a log commits,
 * before the entry listener has even delivered the new doc.
 *
 * `canLog` is the feature flag. When it is off but the task already has logged
 * time, the caller still renders this section read-only: flags gate creation
 * affordances, never data visibility.
 */
export default function TimeTrackingSection({
  task,
  canLog,
  users,
}: {
  task: Task
  canLog: boolean
  users: Map<string, User>
}) {
  const { user, profile } = useAuth()
  const { isSuperAdmin } = usePermissions(task.projectId, task.teamId)
  const { entries, loading, error: loadError } = useTaskTimeEntries(task.id)

  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [dateKey, setDateKey] = useState(todayDateKey)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  // Newest work day first; the listener already orders by createdAt desc, which
  // decides ties within a day.
  const ordered = useMemo(
    () => entries.slice().sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [entries],
  )

  const total = task.timeSpentMinutes ?? 0
  const draftMinutes = composeMinutes(Number(hours || 0), Number(minutes || 0))

  async function handleLog() {
    if (!user || !profile || submitting) return
    if (draftMinutes < 1) {
      setError('Enter how long you worked — at least one minute.')
      return
    }
    if (!dateKey) {
      setError('Pick the day this time was spent.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await logTaskTime({
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.projectId,
        projectTitle: task.projectTitle ?? '',
        teamId: task.teamId,
        uid: user.uid,
        userName: profile.displayName,
        minutes: draftMinutes,
        dateKey,
        note,
      })
      // Keep the date — people usually log several entries for the same day.
      setHours('')
      setMinutes('')
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log time.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(entry: TimeEntry) {
    if (rowBusy) return
    setRowBusy(true)
    setRowError(null)
    try {
      await deleteTimeEntry({
        entryId: entry.id,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.projectId,
        teamId: task.teamId,
        actorId: user?.uid ?? '',
        actorName: profile?.displayName ?? '',
      })
      setConfirmingId(null)
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to remove that entry.')
    } finally {
      setRowBusy(false)
    }
  }

  return (
    <div>
      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-subtle">
        Time{' '}
        <span className="text-fg-muted">
          {total > 0 ? `· ${formatDuration(total)} logged` : `(${entries.length})`}
        </span>
      </h3>

      {loading ? (
        <div className="rounded-xl border border-line bg-card p-4 text-center text-xs text-fg-subtle">
          Loading…
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">
          {loadError}
        </div>
      ) : ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-sm text-fg-subtle">
          No time logged on this task yet.
        </div>
      ) : (
        <ul className="divide-y divide-line/60 rounded-xl border border-line bg-card">
          {ordered.map((entry) =>
            editingId === entry.id ? (
              <EditRow
                key={entry.id}
                entry={entry}
                task={task}
                actorId={user?.uid ?? ''}
                actorName={profile?.displayName ?? ''}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <Avatar
                  user={users.get(entry.uid)}
                  name={entry.userName}
                  size={28}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-medium text-fg">
                      {users.get(entry.uid)?.displayName || entry.userName || 'Unknown user'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm tabular-nums text-fg-strong">
                      <Clock size={12} aria-hidden />
                      {formatDuration(entry.minutes)}
                    </span>
                    <span className="text-xs text-fg-subtle">{formatDateKey(entry.dateKey)}</span>
                    {entry.updatedAt && (
                      <span className="text-[10px] uppercase tracking-wide text-fg-faint">
                        edited
                      </span>
                    )}
                  </div>
                  {entry.note && (
                    <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-fg-muted">
                      {entry.note}
                    </p>
                  )}
                </div>
                {canLog && (entry.uid === user?.uid || isSuperAdmin) && (
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmingId === entry.id ? (
                      <>
                        <span className="text-xs text-fg-subtle">Remove?</span>
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          disabled={rowBusy}
                          aria-label="Confirm remove"
                          className="rounded-md p-1 text-tone-danger-fg transition hover:bg-tone-danger-bg disabled:opacity-50"
                        >
                          <Check size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={rowBusy}
                          aria-label="Keep entry"
                          className="rounded-md p-1 text-fg-subtle transition hover:text-fg disabled:opacity-50"
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(entry.id)
                            setConfirmingId(null)
                            setRowError(null)
                          }}
                          aria-label="Edit entry"
                          className="rounded-md p-1 text-fg-faint transition hover:text-fg"
                        >
                          <Pencil size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingId(entry.id)
                            setRowError(null)
                          }}
                          aria-label="Remove entry"
                          className="rounded-md p-1 text-fg-faint transition hover:text-tone-danger-fg"
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {rowError && (
        <div role="alert" className={errorCls}>
          {rowError}
        </div>
      )}

      {canLog && user && profile && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void handleLog()
          }}
          className="mt-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={1}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0"
                aria-label="Hours worked"
                disabled={submitting}
                className={`${inputCls} w-16 text-right tabular-nums`}
              />
              <span className="text-xs text-fg-subtle">h</span>
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="0"
                aria-label="Minutes worked"
                disabled={submitting}
                className={`${inputCls} w-16 text-right tabular-nums`}
              />
              <span className="text-xs text-fg-subtle">m</span>
              {/* Echo the composed total. Minutes over 59 are accepted and roll
                  into hours (typing 90 means 1h 30m), so show what will land. */}
              {draftMinutes >= 60 && (
                <span className="ml-0.5 whitespace-nowrap text-xs text-fg-muted tabular-nums">
                  = {formatDuration(draftMinutes)}
                </span>
              )}
            </div>
            <input
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
              aria-label="Day the time was spent"
              disabled={submitting}
              className={`${inputCls} scheme-dark`}
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you work on? (optional)"
              aria-label="Note"
              maxLength={500}
              disabled={submitting}
              className={`${inputCls} min-w-48 flex-1`}
            />
            <button
              type="submit"
              disabled={draftMinutes < 1 || submitting}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-xs font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Logging…' : 'Log time'}
            </button>
          </div>
          {error && (
            <div role="alert" className={errorCls}>
              {error}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

/**
 * In-place editor for one entry. Prefilled from the stored total, and passes the
 * previous minutes back so the write can apply an exact counter delta.
 */
function EditRow({
  entry,
  task,
  actorId,
  actorName,
  onDone,
}: {
  entry: TimeEntry
  task: Task
  actorId: string
  actorName: string
  onDone: () => void
}) {
  const initial = splitMinutes(entry.minutes)
  const [hours, setHours] = useState(String(initial.hours))
  const [minutes, setMinutes] = useState(String(initial.minutes))
  const [dateKey, setDateKey] = useState(entry.dateKey)
  const [note, setNote] = useState(entry.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextMinutes = composeMinutes(Number(hours || 0), Number(minutes || 0))

  async function save() {
    if (saving) return
    if (nextMinutes < 1) {
      setError('Enter at least one minute, or remove the entry instead.')
      return
    }
    if (!dateKey) {
      setError('Pick the day this time was spent.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateTimeEntry({
        entryId: entry.id,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.projectId,
        teamId: task.teamId,
        minutes: nextMinutes,
        dateKey,
        note,
        actorId,
        actorName,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save that entry.')
      setSaving(false)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-label="Hours worked"
            disabled={saving}
            className={`${inputCls} w-16 text-right tabular-nums`}
          />
          <span className="text-xs text-fg-subtle">h</span>
          <input
            type="number"
            min={0}
            max={59}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="Minutes worked"
            disabled={saving}
            className={`${inputCls} w-16 text-right tabular-nums`}
          />
          <span className="text-xs text-fg-subtle">m</span>
        </div>
        <input
          type="date"
          value={dateKey}
          onChange={(e) => setDateKey(e.target.value)}
          aria-label="Day the time was spent"
          disabled={saving}
          className={`${inputCls} scheme-dark`}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you work on? (optional)"
          aria-label="Note"
          maxLength={500}
          disabled={saving}
          className={`${inputCls} min-w-48 flex-1`}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={nextMinutes < 1 || saving}
          className="rounded-lg bg-brand-gradient px-3 py-2 text-xs font-medium text-white transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-muted transition hover:border-brand-edge hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div role="alert" className={errorCls}>
          {error}
        </div>
      )}
    </li>
  )
}
