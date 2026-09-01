import { useEffect, useRef, useState } from 'react'
import type { Team, TaskKind, TaskPriority, TaskStatus, User } from '../../types/models'
import { bucketForActiveSet, taskStatusLabel, useTaskStatuses } from '../../lib/taskStatus'

export interface TaskFilterState {
  statuses: Set<TaskStatus>
  priorities: Set<TaskPriority>
  kinds: Set<TaskKind>
  assigneeId: string | null
  teamId: string | null
}

export const EMPTY_FILTERS: TaskFilterState = {
  statuses: new Set(),
  priorities: new Set(),
  kinds: new Set(),
  assigneeId: null,
  teamId: null,
}

export interface TaskFilterable {
  status: TaskStatus
  priority: TaskPriority
  kind?: TaskKind
  effectiveAssigneeId: string | null
  teamId?: string | null
}

// Pure function outside React, so the techTaskStatuses flag is threaded in as
// a parameter. Statuses match on the ACTIVE bucket, not the raw status: with
// the tech set off, the In Review pill must also match dev_done/in_uat/
// ready_for_prod tasks — they render under that column, and column and filter
// must agree.
export function applyFilters(
  tasks: TaskFilterable[],
  filters: TaskFilterState,
  techOn: boolean,
): boolean[] {
  // BOTH sides go through the bucket. Saved filters keep their raw ids across
  // flag flips (taskFilterStorage), so a filter stored as 'dev_done' has to
  // degrade to 'in_review' when the tech set is off — otherwise it matches
  // nothing and silently blanks the board with no active pill to explain it.
  const selected =
    filters.statuses.size > 0
      ? new Set(Array.from(filters.statuses, (s) => bucketForActiveSet(s, techOn)))
      : null

  return tasks.map((t) => {
    if (selected && !selected.has(bucketForActiveSet(t.status, techOn))) return false
    if (filters.priorities.size > 0 && !filters.priorities.has(t.priority)) return false
    // Kind filter: tasks with no kind read as 'task' (matches effectiveKind).
    if (filters.kinds.size > 0 && !filters.kinds.has(t.kind ?? 'task')) return false
    if (filters.assigneeId !== null && t.effectiveAssigneeId !== filters.assigneeId)
      return false
    if (filters.teamId !== null && (t.teamId ?? null) !== filters.teamId) return false
    return true
  })
}

// Active-pill classes only — label and order come from useTaskStatuses(). Kept
// as a local map (not derived from TASK_STATUS_META.pillCls) so the selected
// pill look stays exactly as before. Total over the union — compile-enforced.
const STATUS_ACTIVE_CLS: Record<TaskStatus, string> = {
  todo: 'bg-fill-4 text-fg',
  in_progress: 'bg-tone-info-bg text-tone-info-fg',
  blocked: 'bg-tone-danger-bg text-tone-danger-fg',
  dev_done: 'bg-tone-mint-bg text-tone-mint-fg',
  in_review: 'bg-brand-soft text-brand',
  in_uat: 'bg-tone-yellow-bg text-tone-yellow-fg',
  ready_for_prod: 'bg-tone-orange-bg text-tone-orange-fg',
  done: 'bg-tone-success-bg text-tone-success-fg',
  cancelled: 'bg-tone-pink-bg text-tone-pink-fg',
}

const PRIORITY_PILLS: { value: TaskPriority; label: string; activeCls: string }[] = [
  { value: 'low', label: 'Low', activeCls: 'bg-fill-4 text-fg' },
  { value: 'medium', label: 'Medium', activeCls: 'bg-tone-warn-bg text-tone-warn-fg' },
  { value: 'high', label: 'High', activeCls: 'bg-tone-danger-bg text-tone-danger-fg' },
]

const KIND_PILLS: { value: TaskKind; label: string; activeCls: string }[] = [
  { value: 'epic', label: 'Epic', activeCls: 'bg-brand-soft text-brand' },
  { value: 'story', label: 'Story', activeCls: 'bg-tone-info-bg text-tone-info-fg' },
  { value: 'task', label: 'Task', activeCls: 'bg-fill-4 text-fg' },
  { value: 'subtask', label: 'Subtask', activeCls: 'bg-fill-4 text-fg' },
]

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 18 }: { user: User; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden
    >
      {initialsFor(user)}
    </span>
  )
}

function AssigneeDropdown({
  value,
  onChange,
  members,
}: {
  value: string | null
  onChange: (next: string | null) => void
  members: User[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = value ? members.find((m) => m.uid === value) : null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs text-fg-strong transition hover:bg-fill-3"
      >
        {current ? (
          <>
            <Avatar user={current} size={16} />
            <span className="max-w-32 truncate">{current.displayName}</span>
          </>
        ) : (
          <span className="text-fg-muted">Anyone</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-56 overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
              value === null ? 'bg-fill-2 text-fg' : 'text-fg-muted hover:bg-fill-2'
            }`}
          >
            <span className="inline-block h-4 w-4" aria-hidden />
            <span className="flex-1">Anyone</span>
            {value === null && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <div className="max-h-56 overflow-y-auto border-t border-line">
            {members.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-fg-subtle">
                No members to filter by.
              </div>
            ) : (
              members.map((m) => {
                const active = value === m.uid
                return (
                  <button
                    key={m.uid}
                    type="button"
                    onClick={() => {
                      onChange(m.uid)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                      active ? 'bg-brand-soft text-fg' : 'text-fg-muted hover:bg-fill-2'
                    }`}
                  >
                    <Avatar user={m} size={18} />
                    <span className="flex-1 truncate">{m.displayName}</span>
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TeamDropdown({
  value,
  onChange,
  teams,
}: {
  value: string | null
  onChange: (next: string | null) => void
  teams: Team[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = value ? teams.find((t) => t.id === value) : null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs text-fg-strong transition hover:bg-fill-3"
      >
        <span className="max-w-32 truncate">
          {current ? current.name : 'All teams'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-56 overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
              value === null ? 'bg-fill-2 text-fg' : 'text-fg-muted hover:bg-fill-2'
            }`}
          >
            <span className="flex-1">All teams</span>
            {value === null && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <div className="max-h-56 overflow-y-auto border-t border-line">
            {teams.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-fg-subtle">
                No teams on this project.
              </div>
            ) : (
              teams.map((t) => {
                const active = value === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onChange(t.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                      active ? 'bg-brand-soft text-fg' : 'text-fg-muted hover:bg-fill-2'
                    }`}
                  >
                    <span className="flex-1 truncate">{t.name}</span>
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  value: TaskFilterState
  onChange: (next: TaskFilterState) => void
  members: User[]
  showStatus?: boolean
  showKind?: boolean
  teams?: Team[]
}

export default function TaskFilters({
  value,
  onChange,
  members,
  showStatus = true,
  showKind = false,
  teams,
}: Props) {
  const { statuses } = useTaskStatuses()
  const hasAny =
    value.statuses.size > 0 ||
    value.priorities.size > 0 ||
    value.kinds.size > 0 ||
    value.assigneeId !== null ||
    value.teamId !== null

  const basePill = 'rounded-full border px-2.5 py-1 text-xs font-medium transition'

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {showStatus && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-fg-subtle">Status</span>
          {statuses.map((s) => {
            const active = value.statuses.has(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() =>
                  onChange({ ...value, statuses: toggle(value.statuses, s) })
                }
                className={
                  active
                    ? `${basePill} border-transparent ${STATUS_ACTIVE_CLS[s]}`
                    : `${basePill} border-line bg-fill-1 text-fg-subtle hover:bg-fill-2`
                }
              >
                {taskStatusLabel(s)}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-fg-subtle">Priority</span>
        {PRIORITY_PILLS.map((p) => {
          const active = value.priorities.has(p.value)
          return (
            <button
              key={p.value}
              type="button"
              onClick={() =>
                onChange({ ...value, priorities: toggle(value.priorities, p.value) })
              }
              className={
                active
                  ? `${basePill} border-transparent ${p.activeCls}`
                  : `${basePill} border-line bg-fill-1 text-fg-subtle hover:bg-fill-2`
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {showKind && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-fg-subtle">Type</span>
          {KIND_PILLS.map((p) => {
            const active = value.kinds.has(p.value)
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange({ ...value, kinds: toggle(value.kinds, p.value) })}
                className={
                  active
                    ? `${basePill} border-transparent ${p.activeCls}`
                    : `${basePill} border-line bg-fill-1 text-fg-subtle hover:bg-fill-2`
                }
              >
                {p.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-fg-subtle">Assignee</span>
        <AssigneeDropdown
          value={value.assigneeId}
          onChange={(next) => onChange({ ...value, assigneeId: next })}
          members={members}
        />
      </div>

      {teams && (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-fg-subtle">Team</span>
          <TeamDropdown
            value={value.teamId}
            onChange={(next) => onChange({ ...value, teamId: next })}
            teams={teams}
          />
        </div>
      )}

      {hasAny && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-xs text-brand transition hover:text-brand"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
