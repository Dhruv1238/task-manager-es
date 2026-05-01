import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import { useAllTeams } from '../../hooks/useAllTeams'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAuth } from '../../contexts/AuthContext'
import { setProjectTeams } from '../../lib/firestore'
import NewTeamModal from './NewTeamModal'
import type { Team } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  currentTeamIds: string[]
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

function CheckIcon({ checked }: { checked: boolean }) {
  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
        checked
          ? 'border-purple-400/70 bg-linear-to-br from-purple-500 to-fuchsia-500'
          : 'border-white/20 bg-white/4'
      }`}
      aria-hidden
    >
      {checked && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  )
}

export default function ManageTeamsModal({
  open,
  onClose,
  projectId,
  currentTeamIds,
}: Props) {
  const { teams } = useAllTeams()
  const { users } = useAllUsers()
  const { profile } = useAuth()
  const isAdmin = profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin'

  const [selected, setSelected] = useState<Set<string>>(new Set(currentTeamIds))
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTeamOpen, setNewTeamOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setSelected(new Set(currentTeamIds))
      setSearch('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, currentTeamIds])

  const userById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.uid, u.displayName)
    return m
  }, [users])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return teams
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        (t.description ?? '').toLowerCase().includes(s),
    )
  }, [teams, search])

  function toggle(teamId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  function handleCreatedInline(teamId: string) {
    setSelected((prev) => new Set(prev).add(teamId))
  }

  const previousSet = useMemo(() => new Set(currentTeamIds), [currentTeamIds])
  const hasChanges = useMemo(() => {
    if (selected.size !== previousSet.size) return true
    for (const id of selected) if (!previousSet.has(id)) return true
    return false
  }, [selected, previousSet])

  async function handleSave() {
    setError(null)
    setSubmitting(true)
    try {
      await setProjectTeams({
        projectId,
        previousTeamIds: currentTeamIds,
        newTeamIds: Array.from(selected),
      })
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Manage teams"
        description="Pick which global teams work on this project."
        size="lg"
        closeOnBackdrop={!submitting}
      >
        <div className="space-y-4">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search teams"
              className="w-full rounded-lg border border-white/10 bg-white/4 py-2.5 pl-9 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/2">
            <div className="max-h-72 overflow-y-auto">
              {teams.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-white/40">
                  No teams exist yet.
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-white/40">
                  No teams match your search.
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {filtered.map((t: Team) => {
                    const isSelected = selected.has(t.id)
                    const leadName = userById.get(t.leadId) ?? '—'
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => toggle(t.id)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                            isSelected ? 'bg-purple-500/10' : 'hover:bg-white/4'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white">{t.name}</div>
                            {t.description && (
                              <div className="mt-0.5 line-clamp-1 text-xs text-white/50">
                                {t.description}
                              </div>
                            )}
                            <div className="mt-1 text-xs text-white/40">
                              Lead: {leadName} ·{' '}
                              {t.memberIds.length} member
                              {t.memberIds.length === 1 ? '' : 's'}
                            </div>
                          </div>
                          <CheckIcon checked={isSelected} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setNewTeamOpen(true)}
                className="flex w-full items-center gap-2 border-t border-white/10 bg-white/2 px-4 py-3 text-sm font-medium text-purple-300 transition hover:bg-white/4 hover:text-purple-200"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create new team
              </button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 text-xs text-white/50">
            <span>
              {selected.size} team{selected.size === 1 ? '' : 's'} selected
            </span>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting || !hasChanges}
              className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Saving…
                </span>
              ) : (
                'Save changes'
              )}
            </button>
          </div>
        </div>
      </Modal>

      <NewTeamModal
        open={newTeamOpen}
        onClose={() => setNewTeamOpen(false)}
        onCreated={handleCreatedInline}
      />
    </>
  )
}