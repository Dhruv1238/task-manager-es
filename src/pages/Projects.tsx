import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAuth } from '../contexts/AuthContext'
import AdminActionBar from '../components/admin/AdminActionBar'
import { STAGE_TONE } from '../components/tender/stageStyle'
import ProjectStatusPill from '../components/tender/ProjectStatusPill'
import { STAGE_NAMES } from '../types/models'
import type { Project, Stage, User } from '../types/models'

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 22 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

function formatDeadline(ts: Timestamp | undefined): string {
  if (!ts) return 'No deadline'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function submissionDeadline(project: Project) {
  return project.submissionDate ?? project.deadline
}

function isOverdue(project: Project): boolean {
  const ts = submissionDeadline(project)
  if (!ts) return false
  if (project.status === 'awarded' || project.status === 'lost' || project.status === 'not_submitted') return false
  return ts.toDate().getTime() < Date.now()
}

function StagePill({ stage }: { stage: Stage }) {
  const tone = STAGE_TONE[stage] ?? STAGE_TONE[1]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={STAGE_NAMES[stage]}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {STAGE_NAMES[stage]}
    </span>
  )
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { users } = useAllUsers()
  const { profile } = useAuth()
  const isAdmin = profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin'

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      (snap) => {
        setProjects(snap.docs.map((d) => ({ ...(d.data() as Project), id: d.id })))
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

  const visibleProjects = useMemo(() => {
    if (isAdmin || !profile) return projects
    const myTeams = new Set(profile.teamIds ?? [])
    return projects.filter(
      (p) => p.ownerId === profile.uid || (p.teamIds ?? []).some((tid) => myTeams.has(tid)),
    )
  }, [projects, profile, isAdmin])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return visibleProjects
    return visibleProjects.filter(
      (p) =>
        p.title.toLowerCase().includes(s) ||
        (p.description ?? '').toLowerCase().includes(s),
    )
  }, [visibleProjects, search])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Projects</h1>
          <p className="mt-1 text-sm text-white/50">
            {loading
              ? 'Loading…'
              : `${visibleProjects.length} project${visibleProjects.length === 1 ? '' : 's'}`}
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
            placeholder="Search projects"
            className="w-full rounded-lg border border-white/10 bg-white/4 py-2.5 pl-9 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/2 p-12 text-center text-white/40">
          Loading projects…
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/1 p-12 text-center">
          <h2 className="text-lg font-medium text-white">
            {isAdmin ? 'No projects yet' : 'No projects to show'}
          </h2>
          <p className="mt-2 text-sm text-white/50">
            {isAdmin ? (
              <>
                Click <span className="font-medium text-white/80">+ New Project</span> to start one.
              </>
            ) : (
              'Projects you own, or projects where one of your teams is assigned, will show up here.'
            )}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/2 p-12 text-center text-white/40">
          No projects match your search.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const owner = userById.get(p.ownerId)
            const overdue = isOverdue(p)

            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="group flex flex-col rounded-2xl border border-white/10 bg-white/2 p-5 transition hover:border-white/20 hover:bg-white/4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 text-lg font-semibold text-white">{p.title}</h3>
                  <ProjectStatusPill status={p.status} size="sm" />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {p.stage && <StagePill stage={p.stage as Stage} />}
                  {(p.vhIterationCount ?? 0) > 0 && (
                    <span className="inline-flex items-center rounded-full border border-indigo-400/40 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
                      Iter {(p.vhIterationCount ?? 0) + 1}
                    </span>
                  )}
                </div>

                {p.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-white/55">{p.description}</p>
                )}

                <div className="mt-4 flex items-center gap-2 text-xs text-white/60">
                  {owner ? (
                    <>
                      <Avatar user={owner} size={22} />
                      <span className="truncate">
                        <span className="text-white/80">{owner.displayName}</span>
                        <span className="ml-1 text-white/40">· Owner</span>
                      </span>
                    </>
                  ) : (
                    <span className="text-white/40">No owner</span>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4 text-xs">
                  <span className={overdue ? 'text-red-300' : 'text-white/50'}>
                    {overdue ? 'Overdue · ' : ''}
                    {formatDeadline(submissionDeadline(p))}
                  </span>
                  <div className="flex items-center gap-3 text-white/50">
                    {p.attachments && p.attachments.length > 0 && (
                      <span
                        className="inline-flex items-center gap-1"
                        title={`${p.attachments.length} attachment${p.attachments.length === 1 ? '' : 's'}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                        {p.attachments.length}
                      </span>
                    )}
                    <span>
                      {p.teamIds?.length ?? 0} team
                      {(p.teamIds?.length ?? 0) === 1 ? '' : 's'}
                    </span>
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