import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAuth } from '../contexts/AuthContext'
import {
  useActiveWorkflows,
  useCreateProjectLabel,
  useProjectWorkflow,
  useWorkflow,
} from '../contexts/AppConfigContext'
import { usePaginatedQuery } from '../hooks/usePaginatedQuery'
import AdminActionBar from '../components/admin/AdminActionBar'
import SearchInput from '../components/ui/SearchInput'
import Dropdown, { type DropdownOption } from '../components/ui/Dropdown'
import ProjectStatusPill from '../components/workflow/ProjectStatusPill'
import UnreadChatBadge from '../components/projects/UnreadChatBadge'
import ProjectsTable from '../components/projects/ProjectsTable'
import StagePill from '../components/projects/StagePill'
import WorkflowBadge from '../components/projects/WorkflowBadge'
import {
  formatDeadline,
  isOverdue,
  submissionDeadline,
} from '../components/projects/projectListUtils'
import { useChatEnabled } from '../contexts/AppConfigContext'
import { STATUS_DISPLAY, STATUS_OPTIONS } from '../lib/projectStatus'
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
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

type ViewMode = 'grid' | 'table'
const VIEW_MODE_KEY = 'projects:viewMode'

function readStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'table'
  const v = window.localStorage.getItem(VIEW_MODE_KEY)
  if (v === 'table' || v === 'grid') return v
  return 'table'
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center rounded-lg border border-line bg-fill-2 p-0.5"
    >
      {(
        [
          { v: 'grid', label: 'Grid view', icon: <GridIcon /> },
          { v: 'table', label: 'Table view', icon: <TableIcon /> },
        ] as const
      ).map((opt) => {
        const active = value === opt.v
        return (
          <button
            key={opt.v}
            type="button"
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => onChange(opt.v)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-fill-4 text-fg shadow-sm'
                : 'text-fg-subtle hover:text-fg-muted'
            }`}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.v === 'grid' ? 'Grid' : 'Table'}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function Projects() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [viewMode, setViewMode] = useState<ViewMode>(() => readStoredViewMode())

  // URL-bound filters (Phase 2b). `?workflows=collab-default,sales-default`
  // tracks the workflow multi-select; `?stage=in_execution` tracks the
  // workflow-scoped stage filter. State survives navigation and refresh.
  const [searchParams, setSearchParams] = useSearchParams()
  const { workflows: activeWorkflows } = useActiveWorkflows()

  const selectedWorkflowIds = useMemo<string[]>(() => {
    const raw = searchParams.get('workflows')
    if (!raw) return activeWorkflows.map((w) => w.id)
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
    // Drop any ids that aren't in the active set so a stale URL doesn't
    // produce a query that returns zero results forever.
    return ids.filter((id) => activeWorkflows.some((w) => w.id === id))
  }, [searchParams, activeWorkflows])

  const allSelected = selectedWorkflowIds.length === activeWorkflows.length
  const singleSelectedWorkflowId =
    selectedWorkflowIds.length === 1 ? selectedWorkflowIds[0] : null
  const singleSelectedWorkflow = useWorkflow(singleSelectedWorkflowId)
  const stageFilter = searchParams.get('stage') ?? 'all'

  function setSelectedWorkflowIds(next: string[]) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next.length === 0 || next.length === activeWorkflows.length) {
          params.delete('workflows')
        } else {
          params.set('workflows', next.join(','))
        }
        // Stage filter only valid when exactly one workflow selected.
        if (next.length !== 1) params.delete('stage')
        return params
      },
      { replace: true },
    )
  }

  function setStageFilter(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'all') params.delete('stage')
        else params.set('stage', next)
        return params
      },
      { replace: true },
    )
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])
  const { users } = useAllUsers()
  const { profile } = useAuth()
  const chatEnabled = useChatEnabled()
  const createLabel = useCreateProjectLabel()
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
      const projectsRef = tenantCol('projects')
      const constraints = []
      if (!isAdmin) {
        if (accessKeys.length === 0) return null
        constraints.push(where('accessKeys', 'array-contains-any', accessKeys))
      }
      if (statusFilter !== 'all') {
        constraints.push(where('status', '==', statusFilter))
      }
      // Workflow filter — server-side when narrowed, no filter when "all".
      if (!allSelected && selectedWorkflowIds.length > 0) {
        if (selectedWorkflowIds.length === 1) {
          constraints.push(where('workflowId', '==', selectedWorkflowIds[0]))
          if (stageFilter !== 'all') {
            constraints.push(where('currentStageId', '==', stageFilter))
          }
        } else {
          // Firestore `in` caps at 30; ten active workflows is the soft cap
          // by design so this is fine.
          constraints.push(where('workflowId', 'in', selectedWorkflowIds.slice(0, 30)))
        }
      }
      if (debouncedSearch) {
        constraints.push(where('titleLower', '>=', debouncedSearch))
        constraints.push(where('titleLower', '<=', debouncedSearch + ''))
        constraints.push(orderBy('titleLower'))
      } else {
        constraints.push(orderBy('createdAt', sortDir))
      }
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(PAGE_SIZE))
      return query(projectsRef, ...constraints)
    },
    [
      accessKeys,
      allSelected,
      debouncedSearch,
      isAdmin,
      profile,
      selectedWorkflowIds,
      sortDir,
      stageFilter,
      statusFilter,
    ],
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
      selectedWorkflowIds.join('|'),
      stageFilter,
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

  // Workflow filter dropdown options. The first option toggles between "All
  // workflows" and the narrowed set; subsequent options each toggle one
  // workflow on/off.
  const workflowFilterLabel = useMemo(() => {
    if (allSelected) return 'All workflows'
    if (selectedWorkflowIds.length === 1) {
      const wf = activeWorkflows.find((w) => w.id === selectedWorkflowIds[0])
      return wf?.displayName ?? 'Workflow'
    }
    return `${selectedWorkflowIds.length} workflows`
  }, [allSelected, selectedWorkflowIds, activeWorkflows])

  const workflowOptions: DropdownOption[] = useMemo(
    () => [
      { value: 'all', label: 'All workflows' },
      ...activeWorkflows.map((wf) => ({
        value: wf.id,
        label: wf.displayName,
      })),
    ],
    [activeWorkflows],
  )

  function handleWorkflowOptionPick(value: string) {
    if (value === 'all') {
      setSelectedWorkflowIds(activeWorkflows.map((w) => w.id))
      return
    }
    // Single-select dropdown: picking a workflow switches to just that one.
    // To broaden back to multiple, pick "All workflows" and start over.
    setSelectedWorkflowIds([value])
  }

  // Stage filter options derived from the single selected workflow. Disabled
  // tooltip when a different number of workflows is selected.
  const stageOptions: DropdownOption[] = useMemo(() => {
    if (!singleSelectedWorkflow) return [{ value: 'all', label: 'All stages' }]
    return [
      { value: 'all', label: 'All stages' },
      ...[...singleSelectedWorkflow.stages]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ value: s.id, label: s.displayName })),
    ]
  }, [singleSelectedWorkflow])

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">Projects</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-fg-subtle">
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
                    className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong"
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
        {activeWorkflows.length > 1 && (
          <Dropdown
            value={singleSelectedWorkflowId ?? 'all'}
            displayValue={workflowFilterLabel}
            onChange={handleWorkflowOptionPick}
            options={workflowOptions}
            className="sm:w-44"
          />
        )}
        <Dropdown
          value={stageFilter}
          onChange={setStageFilter}
          options={stageOptions}
          disabled={!singleSelectedWorkflow}
          disabledTooltip="Select a single workflow to filter by stage"
          className="sm:w-44"
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
        <div className="sm:ml-auto">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card p-12 text-center text-fg-subtle">
          Loading projects…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-tone-danger-bd bg-tone-danger-bg p-12 text-center text-tone-danger-fg/80">
          Couldn't load projects. {error.message}
        </div>
      ) : items.length === 0 ? (
        debouncedSearch ? (
          <div className="rounded-2xl border border-line bg-card p-12 text-center text-fg-subtle">
            No projects match your search.
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
            <h2 className="text-lg font-medium text-fg">
              {isAdmin ? 'No projects yet' : 'No projects to show'}
            </h2>
            <p className="mt-2 text-sm text-fg-subtle">
              {isAdmin ? (
                <>
                  Click <span className="font-medium text-fg-muted">+ {createLabel}</span> to start one.
                </>
              ) : (
                'Projects you own, or projects where one of your teams is assigned, will show up here.'
              )}
            </p>
          </div>
        )
      ) : (
        <>
          {viewMode === 'table' ? (
            <ProjectsTable
              projects={items}
              userById={userById}
              showWorkflowColumn={activeWorkflows.length > 1}
              chatEnabled={chatEnabled}
              chatLastReadAt={profile?.chatLastReadAt}
            />
          ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
              const owner = userById.get(p.ownerId)
              const overdue = isOverdue(p)

              return (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="group flex flex-col rounded-2xl border border-line bg-card p-5 transition hover:border-line-strong hover:bg-fill-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 truncate text-lg font-semibold text-fg">{p.title}</h3>
                    <div className="flex shrink-0 items-center gap-2">
                      {chatEnabled && (
                        <UnreadChatBadge
                          chatLastMessageAt={p.chatLastMessageAt}
                          lastReadAt={profile?.chatLastReadAt?.[p.id]}
                        />
                      )}
                      <ProjectStatusPill status={p.status} size="sm" />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <ProjectWorkflowChip project={p} />
                    <StagePill project={p} />
                    {(p.iterationCount ?? 0) > 0 && (
                      <span className="inline-flex items-center rounded-full border border-tone-accent-bd bg-tone-accent-bg px-2 py-0.5 text-[11px] font-medium text-tone-accent-fg">
                        Iter {(p.iterationCount ?? 0) + 1}
                      </span>
                    )}
                  </div>

                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-fg-subtle">{p.description}</p>
                  )}

                  <div className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
                    {owner ? (
                      <>
                        <Avatar user={owner} size={22} />
                        <span className="truncate">
                          <span className="text-fg-muted">{owner.displayName}</span>
                          <span className="ml-1 text-fg-subtle">· Owner</span>
                        </span>
                      </>
                    ) : (
                      <span className="text-fg-subtle">No owner</span>
                    )}
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-line-subtle pt-4 text-xs">
                    <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}>
                      {overdue ? 'Overdue · ' : ''}
                      {formatDeadline(submissionDeadline(p))}
                    </span>
                    <div className="flex items-center gap-3 text-fg-subtle">
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

          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong" />
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

// Grid-card workflow chip. Prefers the snapshot pinned on the project at
// creation so workflow edits don't affect labelling on in-flight projects.
function ProjectWorkflowChip({ project }: { project: Project }) {
  const workflow = useProjectWorkflow(project)
  if (!workflow) return null
  return <WorkflowBadge workflow={workflow} compact />
}
