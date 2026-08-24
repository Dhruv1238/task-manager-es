import { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from '../ui/Avatar'
import type { Task, Team, User } from '../../types/models'
import { getEffectiveAssignee } from '../../lib/effectiveAssignee'

interface Props {
  task: Task
  users: Map<string, User>
  teams: Map<string, Team>
  onChange: (next: { assigneeId: string | null; assigneeName: string | null }) => void | Promise<void>
  // Read-only mode renders the same chip without the menu affordance — the
  // meta row looks identical for viewers who can't reassign.
  disabled?: boolean
}

/**
 * Inline assignee chip + reassign menu for the task-detail meta row — the
 * StatusMenu pattern applied to people. Works for every task kind (epic,
 * story, task, subtask): they share the doc shape, so one menu covers all.
 *
 * Eligible assignees = the task's team lead + members (the same scoping
 * NewTaskModal and AddSubtaskForm use), plus the current assignee even if
 * they've since left the team (so the menu never hides who it's assigned to).
 * "Unassigned" is a real option: a team-level task with no explicit assignee
 * is implicitly owned by the team lead (getEffectiveAssignee).
 */
export default function AssigneeMenu({ task, users, teams, onChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  const team = teams.get(task.teamId)
  const effective = getEffectiveAssignee(task, users, teams)

  const candidates = useMemo(() => {
    const ids = new Set<string>()
    if (team) {
      if (team.leadId) ids.add(team.leadId)
      for (const uid of team.memberIds ?? []) ids.add(uid)
    }
    // Keep the current assignee listed even if no longer on the team.
    if (task.assigneeId) ids.add(task.assigneeId)
    return Array.from(ids)
      .map((uid) => users.get(uid))
      .filter((u): u is User => Boolean(u))
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
  }, [team, task.assigneeId, users])

  async function select(next: User | null) {
    const nextId = next?.uid ?? null
    if (nextId === task.assigneeId) {
      setOpen(false)
      return
    }
    setOpen(false)
    setBusy(true)
    try {
      await onChange({ assigneeId: nextId, assigneeName: next?.displayName ?? null })
    } finally {
      setBusy(false)
    }
  }

  const chip = effective ? (
    <>
      <Avatar user={effective.user} size={20} />
      <span>
        {effective.user.displayName}
        {effective.implicit && <span className="ml-1 text-fg-subtle">· Lead</span>}
      </span>
    </>
  ) : (
    <span className="text-fg-faint">Unassigned</span>
  )

  if (disabled) {
    return <span className="inline-flex items-center gap-1.5 text-fg-muted">{chip}</span>
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !busy && setOpen((o) => !o)}
        disabled={busy}
        title="Change assignee"
        className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-1.5 py-0.5 text-fg-muted transition hover:border-line hover:bg-fill-2"
      >
        {busy ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          chip
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 max-h-72 w-60 overflow-y-auto rounded-lg border border-line bg-elevated shadow-2xl">
          <button
            type="button"
            onClick={() => select(null)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
              !task.assigneeId ? 'bg-fill-2' : 'hover:bg-fill-2'
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-fg-faint">
              —
            </span>
            <span className="flex-1 text-fg-strong">
              Unassigned
              {team && users.get(team.leadId) && (
                <span className="ml-1 text-fg-subtle">· {users.get(team.leadId)!.displayName} leads</span>
              )}
            </span>
            {!task.assigneeId && <Check />}
          </button>
          {candidates.map((u) => {
            const active = u.uid === task.assigneeId
            return (
              <button
                key={u.uid}
                type="button"
                onClick={() => select(u)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  active ? 'bg-fill-2' : 'hover:bg-fill-2'
                }`}
              >
                <Avatar user={u} size={20} />
                <span className="flex-1 truncate text-fg-strong">
                  {u.displayName}
                  {team?.leadId === u.uid && <span className="ml-1 text-fg-subtle">· Lead</span>}
                </span>
                {active && <Check />}
              </button>
            )
          })}
          {candidates.length === 0 && (
            <div className="px-3 py-2 text-xs text-fg-subtle">No team members to assign.</div>
          )}
        </div>
      )}
    </div>
  )
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-brand" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
