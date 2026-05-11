import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAuth } from '../contexts/AuthContext'
import { usePaginatedQuery } from '../hooks/usePaginatedQuery'
import AdminActionBar from '../components/admin/AdminActionBar'
import SearchInput from '../components/ui/SearchInput'
import Dropdown, { type DropdownOption } from '../components/ui/Dropdown'
import { STAGE_TONE, displayedPhase } from '../components/tender/stageStyle'
import ProjectStatusPill from '../components/tender/ProjectStatusPill'
import { STATUS_DISPLAY, STATUS_OPTIONS, isProjectClosed } from '../lib/projectStatus'
import type { Project, ProjectStatus, User } from '../types/models'

const PAGE_SIZE = 24

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
  // Skip the submission-deadline overdue flag once the tender has a final outcome,
  // and also once awarded — at that point the deadline is no longer a submission gate.
  if (isProjectClosed(project.status) || project.status === 'awarded') return false
  return ts.toDate().getTime() < Date.now()
}

function StagePill({ project }: { project: Project }) {
  const phase = displayedPhase(project)
  const tone = STAGE_TONE[phase.toneStage] ?? STAGE_TONE[1]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={phase.label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {phase.shortLabel}
    </span>
  )
}

export default function Projects() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const { users } = useAllUsers()
  const { profile } = useAuth()
  const isAdmin = profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin'

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 600)
    return () => clearTimeout(t)
  }, [search])

  // `array-contains-any` is capped at 30 disjuncts; slice defensively so an
  // exceptionally over-teamed user doesn't break the query outright.
  const accessKeys = useMemo(() => {
    if (!profile) return []
    return [profile.uid, ...(profile.teamIds ?? [])].slice(0, 30)
  }, [profile])

  const buildQuery = useCallback(
    (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!profile) return null
      const projectsRef = collection(db, 'projects')
      const constraints = []
      if (!isAdmin) {
        if (accessKeys.length === 0) return null
        constraints.push(where('accessKeys', 'array-contains-any', accessKeys))
      }
      if (statusFilter !== 'all') {
        constraints.push(where('status', '==', statusFilter))
      }
      if (debouncedSearch) {
        constraints.push(where('titleLower', '>=', debouncedSearch))
        constraints.push(where('titleLower', '<=', debouncedSearch + ''))
        constraints.push(orderBy('titleLower'))
      } else {
        constraints.push(orderBy('createdAt', sortDir))
      }
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(PAGE_SIZE))
      return query(projectsRef, ...constraints)
    },
    [accessKeys, debouncedSearch, isAdmin, profile, sortDir, statusFilter],
  )

  const { items, loading, loadingMore, hasMore, loadMore, error } = usePaginatedQuery<Project>(
    buildQuery,
    PAGE_SIZE,
    [
      isAdmin,
      debouncedSearch,
      statusFilter,
      sortDir,
      profile?.uid,
      (profile?.teamIds ?? []).join('|'),
    ],
    (snap) => ({ ...(snap.data() as Project), id: snap.id }),
  )

  const statusOptions: DropdownOption[] = useMemo(
    () => [
      { value: 'all', label: 'All statuses' },
      ...STATUS_OPTIONS.map((s) => ({
        value: s,
        label: STATUS_DISPLAY[s].label,
        leading: (
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DISPLAY[s].dot}`} aria-hidden />
        ),
      })),
    ],
    [],
  )

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Projects</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-white/50">
            {loading && items.length === 0 ? (
              'Loading…'
            ) : (
              <>
                <span>
                  Showing {items.length} project{items.length === 1 ? '' : 's'}
                  {hasMore ? '+' : ''}
                </span>
                {loading && (
                  <span
                    className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/20 border-t-white/70"
                    aria-label="Refreshing"
                  />
                )}
              </>
            )}
          </p>
        </div>
        <AdminActionBar />
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects"
          infoText="Matches project names that start with what you type. Search is case-insensitive."
          className="sm:max-w-sm sm:flex-1"
        />
        <Dropdown
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as ProjectStatus | 'all')}
          options={statusOptions}
          className="sm:w-44"
        />
        <Dropdown
          value={sortDir}
          onChange={(v) => setSortDir(v as 'desc' | 'asc')}
          options={[
            { value: 'desc', label: 'Newest first' },
            { value: 'asc', label: 'Oldest first' },
          ]}
          disabled={!!debouncedSearch}
          disabledTooltip="Alphabetical order while searching"
          className="sm:w-44"
        />
      </div>

      {loading && items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/2 p-12 text-center text-white/40">
          Loading projects…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-12 text-center text-red-200/80">
          Couldn't load projects. {error.message}
        </div>
      ) : items.length === 0 ? (
        debouncedSearch ? (
          <div className="rounded-2xl border border-white/10 bg-white/2 p-12 text-center text-white/40">
            No projects match your search.
          </div>
        ) : (
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
        )
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
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
                    <div className="shrink-0">
                      <ProjectStatusPill status={p.status} size="sm" />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.stage && <StagePill project={p} />}
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

          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/4 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/90" />
                    Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
