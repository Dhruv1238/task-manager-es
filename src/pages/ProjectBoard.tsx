import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {  onSnapshot } from 'firebase/firestore'
import { tenantDoc } from '../lib/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/AppConfigContext'
import { effectiveKind } from '../lib/taskKind'
import { useAllProjectTasks } from '../hooks/useAllProjectTasks'
import { useAllTeams } from '../hooks/useAllTeams'
import { useAllUsers } from '../hooks/useAllUsers'
import { usePermissions } from '../hooks/usePermissions'
import NewTaskModal from '../components/admin/NewTaskModal'
import ProjectSwimlaneBoard from '../components/tasks/ProjectSwimlaneBoard'
import ProjectPicker from '../components/ui/ProjectPicker'
import TaskFilters, {
  EMPTY_FILTERS,
  applyFilters,
  type TaskFilterState,
} from '../components/tasks/TaskFilters'
import {
  boardFiltersKey,
  readStoredFilters,
  writeStoredFilters,
} from '../components/tasks/taskFilterStorage'
import type { Project, Task, Team, User } from '../types/models'

export default function ProjectBoard() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [filters, setFilters] = useState<TaskFilterState>(() =>
    projectId ? readStoredFilters(boardFiltersKey(projectId)) : EMPTY_FILTERS,
  )
  const [newTaskTeamId, setNewTaskTeamId] = useState<string | null>(null)

  // ProjectPicker navigates between projects on the SAME route, so this
  // component does not remount. Re-hydrate on param change, and only persist
  // once the current project's filters have been hydrated — otherwise project
  // A's filters would flush into project B's key during the switch.
  const hydratedKeyRef = useRef<string | null>(projectId ?? null)
  useEffect(() => {
    if (!projectId) return
    if (hydratedKeyRef.current === projectId) return
    setFilters(readStoredFilters(boardFiltersKey(projectId)))
    hydratedKeyRef.current = projectId
  }, [projectId])
  useEffect(() => {
    if (!projectId || hydratedKeyRef.current !== projectId) return
    writeStoredFilters(boardFiltersKey(projectId), filters)
  }, [filters, projectId])

  const { profile } = useAuth()
  const hierarchyOn = useFeature('taskHierarchy')
  const { users } = useAllUsers()
  const { teams: allTeams } = useAllTeams()
  const { tasks, loading: tasksLoading, error: tasksError } = useAllProjectTasks(projectId)
  const {
    isAdmin,
    isSuperAdmin,
    isProjectOwner,
    isProjectCreator,
    isAnyRoleHolder,
    isProjectLead,
    can,
  } = usePermissions(projectId)

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    return onSnapshot(
      tenantDoc('projects', projectId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true)
          setProject(null)
        } else {
          setProject({ ...(snap.data() as Project), id: snap.id })
          setNotFound(false)
        }
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [projectId])

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  const teamsById = useMemo(() => {
    const m = new Map<string, Team>()
    for (const t of allTeams) m.set(t.id, t)
    return m
  }, [allTeams])

  const projectTeams = useMemo(() => {
    if (!project) return [] as Team[]
    return (project.teamIds ?? [])
      .map((id) => teamsById.get(id))
      .filter(Boolean) as Team[]
  }, [project, teamsById])

  const allAssignees = useMemo(() => {
    const m = new Map<string, User>()
    for (const team of projectTeams) {
      for (const uid of team.memberIds) {
        const u = userById.get(uid)
        if (u) m.set(uid, u)
      }
    }
    return Array.from(m.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    )
  }, [projectTeams, userById])

  // Drop persisted filter values that no longer resolve on this project (e.g.
  // an assignee whose team was detached) so a stale saved filter can't blank
  // the board. Runs only once real data is present — an empty first snapshot
  // must not wipe valid values. Mirrors the stale-workflow-id guard on
  // Projects.tsx.
  useEffect(() => {
    if (!project || allTeams.length === 0 || users.length === 0) return
    setFilters((f) => {
      const staleAssignee =
        f.assigneeId !== null && !allAssignees.some((u) => u.uid === f.assigneeId)
      const staleTeam = f.teamId !== null && !projectTeams.some((t) => t.id === f.teamId)
      if (!staleAssignee && !staleTeam) return f
      return {
        ...f,
        assigneeId: staleAssignee ? null : f.assigneeId,
        teamId: staleTeam ? null : f.teamId,
      }
    })
  }, [project, allTeams.length, users.length, allAssignees, projectTeams])

  // The Type (kind) filter is only reachable while hierarchy is on. If the org
  // turns it off, clear any persisted kinds so a now-hidden filter can't keep
  // silently narrowing the board (same intent as the stale-value guard above).
  useEffect(() => {
    if (hierarchyOn) return
    setFilters((f) => (f.kinds.size === 0 ? f : { ...f, kinds: new Set() }))
  }, [hierarchyOn])

  // Effective assignee: team-level tasks fall back to their team lead.
  const effectiveAssigneeById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of tasks) {
      const team = teamsById.get(t.teamId)
      m.set(t.id, t.assigneeId ?? team?.leadId ?? null)
    }
    return m
  }, [tasks, teamsById])

  const filteredTasks = useMemo(() => {
    const mask = applyFilters(
      tasks.map((t) => ({
        status: t.status,
        priority: t.priority,
        kind: effectiveKind(t),
        effectiveAssigneeId: effectiveAssigneeById.get(t.id) ?? null,
        teamId: t.teamId,
      })),
      filters,
    )
    return tasks.filter((_, i) => mask[i])
  }, [tasks, effectiveAssigneeById, filters])

  const tasksById = useMemo(() => {
    const m = new Map<string, Task>()
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [tasks])

  // Anyone with access to the project sees its board: admins, owner/creator,
  // the allocated lead, any assigned project role-holder, members of an added
  // team, or anyone the Role-Hierarchy grants Projects → View.
  const canView = useMemo(() => {
    if (!project || !profile) return false
    if (
      isSuperAdmin ||
      isAdmin ||
      isProjectOwner ||
      isProjectCreator ||
      isAnyRoleHolder ||
      isProjectLead ||
      can('projects', 'view')
    )
      return true
    const myTeams = new Set(profile.teamIds ?? [])
    return (project.teamIds ?? []).some((tid) => myTeams.has(tid))
  }, [
    project,
    profile,
    isSuperAdmin,
    isAdmin,
    isProjectOwner,
    isProjectCreator,
    isAnyRoleHolder,
    isProjectLead,
    can,
  ])

  const canCreateForTeam = (team: Team): boolean => {
    if (!profile) return false
    if (isAdmin || isProjectOwner || isProjectLead || can('tasks', 'create')) return true
    return team.leadId === profile.uid
  }

  const newTaskTeam = useMemo(
    () => (newTaskTeamId ? projectTeams.find((t) => t.id === newTaskTeamId) ?? null : null),
    [newTaskTeamId, projectTeams],
  )

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 text-center text-fg-subtle sm:px-6 lg:px-8">
        Loading board…
      </div>
    )
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-fg">Project not found</h1>
        <p className="mt-2 text-fg-subtle">It may have been deleted or the link is invalid.</p>
        <Link
          to="/projects"
          className="mt-6 inline-block rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-4"
        >
          Back to projects
        </Link>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-fg">You don't have access to this board</h1>
        <p className="mt-2 text-fg-subtle">
          You can only view boards for projects where one of your teams is assigned.
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

  return (
    <div className="mx-auto w-full max-w-350 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to={`/projects/${project.id}`}
        className="inline-flex items-center gap-1 text-sm text-fg-subtle transition hover:text-fg-muted"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {project.title}
      </Link>

      <div className="mt-4 mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-fg-subtle">Board view</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
            {project.title}
          </h1>
          <p className="mt-2 text-sm text-fg-subtle">
            Kanban across every team on this project. Swimlanes are teams, columns are statuses.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-64">
          <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
            Switch project
          </span>
          <ProjectPicker
            value={project.id}
            onChange={(next) => {
              if (next !== project.id) navigate(`/projects/${next}/boards`)
            }}
            selectedLabel={project.title}
          />
          <div className="text-right text-xs text-fg-subtle">
            {tasksLoading
              ? 'Loading…'
              : filteredTasks.length === tasks.length
                ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
                : `${filteredTasks.length} of ${tasks.length}`}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-line bg-card px-4 py-3">
        <TaskFilters
          value={filters}
          onChange={setFilters}
          members={allAssignees}
          teams={projectTeams}
          showStatus={false}
          showKind={hierarchyOn}
        />
      </div>

      {tasksError ? (
        <div className="rounded-2xl border border-tone-danger-bd bg-tone-danger-bg p-6 text-sm text-tone-danger-fg">
          Couldn't load tasks: {tasksError}
        </div>
      ) : tasksLoading ? (
        <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-fg-subtle">
          Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center">
          <h3 className="text-base font-medium text-fg">No tasks on this project yet</h3>
          <p className="mt-2 text-sm text-fg-subtle">
            Once a team on this project creates its first task, the board fills in here.
          </p>
        </div>
      ) : (
        <ProjectSwimlaneBoard
          tasks={filteredTasks}
          teams={projectTeams}
          teamsMap={teamsById}
          users={userById}
          tasksById={tasksById}
          onCreateTask={(teamId) => setNewTaskTeamId(teamId)}
          canCreateForTeam={canCreateForTeam}
        />
      )}

      {newTaskTeam && (
        <NewTaskModal
          open={Boolean(newTaskTeam)}
          onClose={() => setNewTaskTeamId(null)}
          projectId={project.id}
          teamId={newTaskTeam.id}
          projectTitle={project.title}
          teamName={newTaskTeam.name}
        />
      )}
    </div>
  )
}