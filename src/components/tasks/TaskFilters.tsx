import { useEffect, useRef, useState } from 'react'
import type { Team, TaskPriority, TaskStatus, User } from '../../types/models'

export interface TaskFilterState {
  statuses: Set<TaskStatus>
  priorities: Set<TaskPriority>
  assigneeId: string | null
  teamId: string | null
}

export const EMPTY_FILTERS: TaskFilterState = {
  statuses: new Set(),
  priorities: new Set(),
  assigneeId: null,
  teamId: null,
}

export interface TaskFilterable {
  status: TaskStatus
  priority: TaskPriority
  effectiveAssigneeId: string | null
  teamId?: string | null
}

export function applyFilters(
  tasks: TaskFilterable[],
  filters: TaskFilterState,
): boolean[] {
  return tasks.map((t) => {
    if (filters.statuses.size > 0 && !filters.statuses.has(t.status)) return false
    if (filters.priorities.size > 0 && !filters.priorities.has(t.priority)) return false
    if (filters.assigneeId !== null && t.effectiveAssigneeId !== filters.assigneeId)
      return false
    if (filters.teamId !== null && (t.teamId ?? null) !== filters.teamId) return false
    return true
  })
}

const STATUS_PILLS: { value: TaskStatus; label: string; activeCls: string }[] = [
  { value: 'todo', label: 'Todo', activeCls: 'bg-white/10 text-white' },
  { value: 'in_progress', label: 'In Progress', activeCls: 'bg-blue-500/20 text-blue-200' },
  { value: 'in_review', label: 'In Review', activeCls: 'bg-purple-500/20 text-purple-200' },
  { value: 'done', label: 'Done', activeCls: 'bg-emerald-500/20 text-emerald-200' },
  { value: 'blocked', label: 'Blocked', activeCls: 'bg-red-500/20 text-red-200' },
]

const PRIORITY_PILLS: { value: TaskPriority; label: string; activeCls: string }[] = [
  { value: 'low', label: 'Low', activeCls: 'bg-white/10 text-white' },
  { value: 'medium', label: 'Medium', activeCls: 'bg-amber-500/15 text-amber-200' },
  { value: 'high', label: 'High', activeCls: 'bg-red-500/15 text-red-200' },
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
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white"
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
        className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/4 px-2.5 py-1 text-xs text-white/85 transition hover:bg-white/6"
      >
        {current ? (
          <>
            <Avatar user={current} size={16} />
            <span className="max-w-32 truncate">{current.displayName}</span>
          </>
        ) : (
          <span className="text-white/70">Anyone</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-56 overflow-hidden rounded-lg border border-white/10 bg-[#0e0e16] shadow-2xl">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
              value === null ? 'bg-white/5 text-white' : 'text-white/80 hover:bg-white/4'
            }`}
          >
            <span className="inline-block h-4 w-4" aria-hidden />
            <span className="flex-1">Anyone</span>
            {value === null && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-300">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <div className="max-h-56 overflow-y-auto border-t border-white/10">
            {members.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-white/40">
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
                      active ? 'bg-purple-500/10 text-white' : 'text-white/80 hover:bg-white/4'
                    }`}
                  >
                    <Avatar user={m} size={18} />
                    <span className="flex-1 truncate">{m.displayName}</span>
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-300">
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
        className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/4 px-2.5 py-1 text-xs text-white/85 transition hover:bg-white/6"
      >
        <span className="max-w-32 truncate">
          {current ? current.name : 'All teams'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-56 overflow-hidden rounded-lg border border-white/10 bg-[#0e0e16] shadow-2xl">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
              value === null ? 'bg-white/5 text-white' : 'text-white/80 hover:bg-white/4'
            }`}
          >
            <span className="flex-1">All teams</span>
            {value === null && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-300">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <div className="max-h-56 overflow-y-auto border-t border-white/10">
            {teams.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-white/40">
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
                      active ? 'bg-purple-500/10 text-white' : 'text-white/80 hover:bg-white/4'
                    }`}
                  >
                    <span className="flex-1 truncate">{t.name}</span>
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-300">
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
  teams?: Team[]
}

export default function TaskFilters({
  value,
  onChange,
  members,
  showStatus = true,
  teams,
}: Props) {
  const hasAny =
    value.statuses.size > 0 ||
    value.priorities.size > 0 ||
    value.assigneeId !== null ||
    value.teamId !== null

  const basePill = 'rounded-full border px-2.5 py-1 text-xs font-medium transition'

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {showStatus && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-white/40">Status</span>
          {STATUS_PILLS.map((p) => {
            const active = value.statuses.has(p.value)
            return (
              <button
                key={p.value}
                type="button"
                onClick={() =>
                  onChange({ ...value, statuses: toggle(value.statuses, p.value) })
                }
                className={
                  active
                    ? `${basePill} border-transparent ${p.activeCls}`
                    : `${basePill} border-white/10 bg-white/2 text-white/50 hover:bg-white/4`
                }
              >
                {p.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-white/40">Priority</span>
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
                  : `${basePill} border-white/10 bg-white/2 text-white/50 hover:bg-white/4`
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-white/40">Assignee</span>
        <AssigneeDropdown
          value={value.assigneeId}
          onChange={(next) => onChange({ ...value, assigneeId: next })}
          members={members}
        />
      </div>

      {teams && (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-white/40">Team</span>
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
          className="text-xs text-purple-300 transition hover:text-purple-200"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
