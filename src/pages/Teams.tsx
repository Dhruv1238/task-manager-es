import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAuth } from '../contexts/AuthContext'
import AdminActionBar from '../components/admin/AdminActionBar'
import type { Team, User } from '../types/models'

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 28 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white ring-2 ring-[#0b0b12]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      title={user.displayName}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

export default function Teams() {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { users } = useAllUsers()
  const { profile } = useAuth()
  const isAdmin = profile?.globalRole === 'admin'

  useEffect(() => {
    const q = query(collection(db, 'teams'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      (snap) => {
        setTeams(snap.docs.map((d) => ({ ...(d.data() as Team), id: d.id })))
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  const visibleTeams = useMemo(() => {
    if (isAdmin || !profile) return teams
    return teams.filter((t) => t.memberIds.includes(profile.uid) || t.leadId === profile.uid)
  }, [teams, profile, isAdmin])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return visibleTeams
    return visibleTeams.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        (t.description ?? '').toLowerCase().includes(s),
    )
  }, [visibleTeams, search])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Teams</h1>
          <p className="mt-1 text-sm text-white/50">
            {loading
              ? 'Loading…'
              : `${visibleTeams.length} team${visibleTeams.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <AdminActionBar />
      </div>

      <div className="mb-6 max-w-sm">
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
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/2 p-12 text-center text-white/40">
          Loading teams…
        </div>
      ) : visibleTeams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/1 p-12 text-center">
          <h2 className="text-lg font-medium text-white">
            {isAdmin ? 'No teams yet' : "You're not on any teams yet"}
          </h2>
          <p className="mt-2 text-sm text-white/50">
            {isAdmin ? (
              <>
                Click <span className="font-medium text-white/80">+ New Team</span> to spin one up.
              </>
            ) : (
              'An admin will add you to a team.'
            )}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/2 p-12 text-center text-white/40">
          No teams match your search.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => {
            const lead = userById.get(t.leadId)
            const otherMembers = t.memberIds
              .filter((uid) => uid !== t.leadId)
              .map((uid) => userById.get(uid))
              .filter(Boolean) as User[]
            const visibleMembers = otherMembers.slice(0, 4)
            const extra = Math.max(0, otherMembers.length - visibleMembers.length)

            return (
              <Link
                key={t.id}
                to={`/teams/${t.id}`}
                className="group flex flex-col rounded-2xl border border-white/10 bg-white/2 p-5 transition hover:border-white/20 hover:bg-white/4"
              >
                <h3 className="text-lg font-semibold text-white group-hover:text-white">
                  {t.name}
                </h3>
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-white/55">{t.description}</p>
                )}

                <div className="mt-4 flex items-center gap-2 text-xs text-white/60">
                  {lead ? (
                    <>
                      <Avatar user={lead} size={22} />
                      <span className="truncate">
                        <span className="text-white/80">{lead.displayName}</span>
                        <span className="ml-1 text-white/40">· Lead</span>
                      </span>
                    </>
                  ) : (
                    <span className="text-white/40">No lead</span>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
                  <div className="flex items-center">
                    {visibleMembers.length === 0 ? (
                      <span className="text-xs text-white/40">No other members</span>
                    ) : (
                      <div className="flex -space-x-2">
                        {visibleMembers.map((m) => (
                          <Avatar key={m.uid} user={m} size={24} />
                        ))}
                        {extra > 0 && (
                          <div
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/8 text-[10px] font-semibold text-white/70 ring-2 ring-[#0b0b12]"
                            aria-hidden
                          >
                            +{extra}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-white/50">
                    {t.memberIds.length} member{t.memberIds.length === 1 ? '' : 's'}
                    <span className="mx-2 text-white/20">·</span>
                    {t.projectIds?.length ?? 0} project
                    {(t.projectIds?.length ?? 0) === 1 ? '' : 's'}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
