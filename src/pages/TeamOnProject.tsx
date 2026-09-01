import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {  onSnapshot } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { tenantDoc } from '../lib/firestore'
import { useFeature } from '../contexts/AppConfigContext'
import { effectiveKind } from '../lib/taskKind'
import { isTerminal } from '../lib/taskStatus'
import { subtaskRatio } from '../lib/progress'
import { useAllUsers } from '../hooks/useAllUsers'
import { useTeamProjectTasks } from '../hooks/useTeamProjectTasks'
import { usePermissions } from '../hooks/usePermissions'
import NewTaskModal from '../components/admin/NewTaskModal'
import TaskBoard from '../components/tasks/TaskBoard'
import TaskStatusPill from '../components/tasks/TaskStatusPill'
import TaskFilters, {
  EMPTY_FILTERS,
  applyFilters,
  type TaskFilterState,
} from '../components/tasks/TaskFilters'
import {
  readStoredFilters,
  teamBoardFiltersKey,
  writeStoredFilters,
} from '../components/tasks/taskFilterStorage'
import ViewToggle, { type TaskView } from '../components/tasks/ViewToggle'
import { getEffectiveAssignee } from '../lib/effectiveAssignee'
import type {
  Project,
  Task,
  TaskPriority,
  Team,
  User,
} from '../types/models'

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

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-fg-subtle' },
  medium: { label: 'Medium', cls: 'text-tone-warn-fg' },
  high: { label: 'High', cls: 'text-tone-danger-fg' },
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface TaskRowProps {
  task: Task
  users: Map<string, User>
  teams: Map<string, Team>
  variant?: 'parent' | 'subtask' | 'orphan'
  parentTitle?: string | null
}

function TaskRow({
  task,
  users,
  teams,
  variant = 'parent',
  parentTitle,
}: TaskRowProps) {
  const location = useLocation()
  const overdue =
    task.dueDate &&
    !isTerminal(task.status) &&
    task.dueDate.toDate().getTime() < Date.now()
  const priority = PRIORITY_STYLES[task.priority]
  const assignee = getEffectiveAssignee(task, users, teams)
  const nested = variant === 'subtask'
  // Cancelled-adjusted denominator — must agree with the progress bars.
  const ratio = subtaskRatio(task)
  const showSubtaskCount = variant === 'parent' && ratio.total > 0

  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <Link
        to={`/tasks/${task.id}`}
        state={{ backgroundLocation: location }}
        className={`flex items-center gap-3 text-left transition hover:bg-fill-1 ${
          nested ? 'pl-10 pr-5 py-2.5' : 'px-5 py-3'
        }`}
      >
        {nested && (
          <span className="text-fg-faint" aria-hidden>
            ↳
          </span>
        )}
        <TaskStatusPill status={task.status} />
        <div className="min-w-0 flex-1">
          <div className={`truncate font-medium text-fg ${nested ? 'text-sm' : 'text-sm'}`}>
            {task.title}
          </div>
          {variant === 'orphan' && parentTitle && (
            <div className="mt-0.5 truncate text-xs text-fg-subtle">
              <span className="mr-1">↳ From</span>
              {parentTitle}
            </div>
          )}
          {variant !== 'orphan' && task.description && (
            <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">
              {task.description}
            </div>
          )}
        </div>
        <div className="hidden items-center gap-4 text-xs text-fg-subtle sm:flex">
          {assignee && (
            <span className="inline-flex items-center gap-1.5 text-fg-muted">
              <Avatar user={assignee.user} size={18} />
              <span className="truncate">
                {assignee.user.displayName}
                {assignee.implicit && (
                  <span className="ml-1 text-fg-subtle">· Lead</span>
                )}
              </span>
            </span>
          )}
          <span className={`font-medium ${priority.cls}`}>{priority.label}</span>
          <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}>
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.dueDate)}
          </span>
          {showSubtaskCount && (
            <span className="text-fg-subtle">
              {ratio.done}/{ratio.total}
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}

interface DisplayGroup {
  parent: Task | null // null → orphan rendering
  subtasks: Task[]
  parentTitle?: string | null // populated when this is a pseudo-group for orphans
}

export default function TeamOnProject() {
  const { projectId, teamId } = useParams<{ projectId: string; teamId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [view, setView] = useState<TaskView>('list')
  const [filters, setFilters] = useState<TaskFilterState>(() =>
    projectId && teamId
      ? readStoredFilters(teamBoardFiltersKey(projectId, teamId))
      : EMPTY_FILTERS,
  )
  const { users } = useAllUsers()
  const hierarchyOn = useFeature('taskHierarchy')
  const techOn = useFeature('techTaskStatuses')

  // Same non-remount navigation caveat as ProjectBoard: re-hydrate when the
  // route params change and only persist filters that belong to the current
  // project/team key (see taskFilterStorage.ts).
  const storageKey = projectId && teamId ? teamBoardFiltersKey(projectId, teamId) : null
  const hydratedKeyRef = useRef<string | null>(storageKey)
  useEffect(() => {
    if (!storageKey) return
    if (hydratedKeyRef.current === storageKey) return
    setFilters(readStoredFilters(storageKey))
    hydratedKeyRef.current = storageKey
  }, [storageKey])
  useEffect(() => {
    if (!storageKey || hydratedKeyRef.current !== storageKey) return
    writeStoredFilters(storageKey, filters)
  }, [filters, storageKey])
  const { tasks, loading: tasksLoading, error: tasksError } = useTeamProjectTasks(
    projectId,
    teamId,
  )
  const { isAdmin, isProjectOwner, isTeamLead } = usePermissions(projectId, teamId)
  const canCreateTask = isAdmin || isProjectOwner || isTeamLead

  useEffect(() => {
    if (!projectId || !teamId) return
    let projectReady = false
    let teamReady = false
    const tick = () => {
      if (projectReady && teamReady) setLoading(false)
    }
    const unsubProject = onSnapshot(
      tenantDoc('projects', projectId),
      (snap) => {
        if (!snap.exists()) setNotFound(true)
        else setProject({ ...(snap.data() as Project), id: snap.id })
        projectReady = true
        tick()
      },
      () => {
        projectReady = true
        tick()
      },
    )
    const unsubTeam = onSnapshot(
      tenantDoc('teams', teamId),
      (snap) => {
        if (!snap.exists()) setNotFound(true)
        else setTeam({ ...(snap.data() as Team), id: snap.id })
        teamReady = true
        tick()
      },
      () => {
        teamReady = true
        tick()
      },
    )
    return () => {
      unsubProject()
      unsubTeam()
    }
  }, [projectId, teamId])

  // Drop a persisted assignee filter that no longer belongs to this team so a
  // stale saved value can't blank the list (mirrors ProjectBoard's guard).
  useEffect(() => {
    if (!team || users.length === 0) return
    setFilters((f) => {
      if (f.assigneeId === null) return f
      const memberSet = new Set([team.leadId, ...team.memberIds])
      if (memberSet.has(f.assigneeId)) return f
      return { ...f, assigneeId: null }
    })
  }, [team, users.length])

  // The Type (kind) filter is only reachable while hierarchy is on. If the org
  // turns it off, clear any persisted kinds so a now-hidden filter can't keep
  // silently narrowing the list (same intent as the stale-value guard above).
  useEffect(() => {
    if (hierarchyOn) return
    setFilters((f) => (f.kinds.size === 0 ? f : { ...f, kinds: new Set() }))
  }, [hierarchyOn])

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  const teamById = useMemo(() => {
    const m = new Map<string, Team>()
    if (team) m.set(team.id, team)
    return m
  }, [team])

  const tasksById = useMemo(() => {
    const m = new Map<string, Task>()
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [tasks])

  const members = useMemo(() => {
    if (!team) return []
    return team.memberIds
      .map((uid) => userById.get(uid))
      .filter(Boolean) as User[]
  }, [team, userById])

  // Effective assignee for filtering: team-level tasks resolve to team lead.
  const effectiveAssigneeById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of tasks) {
      m.set(t.id, t.assigneeId ?? team?.leadId ?? null)
    }
    return m
  }, [tasks, team?.leadId])

  const filteredIds = useMemo(() => {
    // techOn threads through to applyFilters so a persisted status filter
    // (the status pills are hidden in board view) matches on the active
    // bucket and stays in agreement with the board columns.
    const mask = applyFilters(
      tasks.map((t) => ({
        status: t.status,
        priority: t.priority,
        kind: effectiveKind(t),
        effectiveAssigneeId: effectiveAssigneeById.get(t.id) ?? null,
      })),
      filters,
      techOn,
    )
    const s = new Set<string>()
    tasks.forEach((t, i) => {
      if (mask[i]) s.add(t.id)
    })
    return s
  }, [tasks, effectiveAssigneeById, filters, techOn])

  const filteredTasks = useMemo(
    () => tasks.filter((t) => filteredIds.has(t.id)),
    [tasks, filteredIds],
  )

  // Build list hierarchy: parents first (by createdAt desc), each with its visible
  // subtasks beneath (by createdAt asc). Subtasks whose parent isn't visible show
  // as orphans at the bottom with a "↳ From: Parent" caption.
  const listGroups = useMemo<DisplayGroup[]>(() => {
    const parents: Task[] = []
    const subtaskBuckets = new Map<string, Task[]>()
    const orphans: Task[] = []

    for (const t of filteredTasks) {
      if (!t.parentTaskId) {
        parents.push(t)
      } else if (filteredIds.has(t.parentTaskId)) {
        let arr = subtaskBuckets.get(t.parentTaskId)
        if (!arr) {
          arr = []
          subtaskBuckets.set(t.parentTaskId, arr)
        }
        arr.push(t)
      } else {
        orphans.push(t)
      }
    }

    for (const arr of subtaskBuckets.values()) {
      arr.sort((a, b) => {
        const at = a.createdAt?.toDate().getTime() ?? 0
        const bt = b.createdAt?.toDate().getTime() ?? 0
        return at - bt
      })
    }

    const groups: DisplayGroup[] = parents.map((p) => ({
      parent: p,
      subtasks: subtaskBuckets.get(p.id) ?? [],
    }))

    for (const o of orphans) {
      // Fall back to the denormalized parentTitle when the parent isn't in this
      // team's loaded set (e.g. a cross-team subtask whose parent is elsewhere).
      const parentTitle =
        (o.parentTaskId && tasksById.get(o.parentTaskId)?.title) ??
        o.parentTitle ??
        '(parent filtered out)'
      groups.push({ parent: null, subtasks: [o], parentTitle })
    }

    return groups
  }, [filteredTasks, filteredIds, tasksById])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-fg-subtle sm:px-6 lg:px-8">
        Loading team workspace…
      </div>
    )
  }

  if (notFound || !project || !team) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-fg">Team workspace not found</h1>
        <p className="mt-2 text-fg-subtle">
          Either the project or the team no longer exists, or the team isn't on this project.
        </p>
        <Link
          to="/projects"
          className="mt-6 inline-block rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-4"
        >
          Back to projects
        </Link>
      </div>
    )
  }

  const teamIsOnProject = (project.teamIds ?? []).includes(team.id)
  const lead = userById.get(team.leadId)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to={`/projects/${project.id}`}
        className="inline-flex items-center gap-1 text-sm text-fg-subtle transition hover:text-fg-muted"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {project.title}
      </Link>

      <div className="mt-4 mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-fg-subtle">Team workspace</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
            {team.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-subtle">
            {lead && (
              <div className="flex items-center gap-2">
                <Avatar user={lead} size={22} />
                <span>
                  <span className="text-fg-muted">{lead.displayName}</span>
                  <span className="ml-1 text-fg-subtle">· Lead</span>
                </span>
              </div>
            )}
            <span>
              {team.memberIds.length} member{team.memberIds.length === 1 ? '' : 's'}
            </span>
            <Link
              to={`/teams/${team.id}`}
              className="text-brand transition hover:text-brand"
            >
              Team profile →
            </Link>
          </div>
        </div>

        {canCreateTask && teamIsOnProject && (
          <button
            type="button"
            onClick={() => setNewTaskOpen(true)}
            className="shrink-0 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient"
          >
            + New Task
          </button>
        )}
      </div>

      {!teamIsOnProject && (
        <div className="mb-6 rounded-xl border border-tone-warn-bd bg-tone-warn-bg px-4 py-3 text-sm text-tone-warn-fg">
          This team isn't currently assigned to this project. Existing tasks below are from prior
          assignments. Re-add the team from the project page to create new tasks.
        </div>
      )}

      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ViewToggle value={view} onChange={setView} />
        {!tasksLoading && !tasksError && (
          <span className="text-xs text-fg-subtle">
            {filteredTasks.length === tasks.length
              ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
              : `${filteredTasks.length} of ${tasks.length}`}
          </span>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-line bg-card px-4 py-3">
        <TaskFilters
          value={filters}
          onChange={setFilters}
          members={members}
          showStatus={view === 'list'}
          showKind={hierarchyOn}
        />
      </div>

      {tasksError ? (
        <div className="rounded-2xl border border-tone-danger-bd bg-tone-danger-bg p-6 text-sm text-tone-danger-fg">
          Couldn't load tasks: {tasksError}
          {tasksError.includes('index') && (
            <div className="mt-2 text-tone-danger-fg/70">
              Firestore wants a composite index. Open the link in your browser console to create it.
            </div>
          )}
        </div>
      ) : tasksLoading ? (
        <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-fg-subtle">
          Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center">
          <h3 className="text-base font-medium text-fg">No tasks yet</h3>
          <p className="mt-2 text-sm text-fg-subtle">
            {canCreateTask
              ? 'Click + New Task to add the first team-level task.'
              : 'The team lead will add tasks here.'}
          </p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-fg-subtle">
          No tasks match the current filters.
        </div>
      ) : view === 'list' ? (
        <ul className="overflow-hidden rounded-2xl border border-line bg-card">
          {listGroups.map((g, i) =>
            g.parent ? (
              <div key={g.parent.id} className={i > 0 ? 'border-t border-line-subtle' : ''}>
                <TaskRow
                  task={g.parent}
                  users={userById}
                  teams={teamById}
                  variant="parent"
                />
                {g.subtasks.map((s) => (
                  <TaskRow
                    key={s.id}
                    task={s}
                    users={userById}
                    teams={teamById}
                    variant="subtask"
                  />
                ))}
              </div>
            ) : (
              <TaskRow
                key={g.subtasks[0].id}
                task={g.subtasks[0]}
                users={userById}
                teams={teamById}
                variant="orphan"
                parentTitle={g.parentTitle}
              />
            ),
          )}
        </ul>
      ) : (
        <TaskBoard
          tasks={filteredTasks}
          users={userById}
          teams={teamById}
          tasksById={tasksById}
        />
      )}

      {projectId && teamId && (
        <NewTaskModal
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          projectId={projectId}
          teamId={teamId}
          projectTitle={project.title}
          teamName={team.name}
        />
      )}
    </div>
  )
}