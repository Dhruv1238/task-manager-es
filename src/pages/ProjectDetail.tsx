import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAllTeams } from '../hooks/useAllTeams'
import { useProjectTasks } from '../hooks/useProjectTasks'
import { usePermissions } from '../hooks/usePermissions'
import FileBadge, { formatFileSize } from '../components/ui/FileBadge'
import ProgressBar from '../components/ui/ProgressBar'
import ManageTeamsModal from '../components/admin/ManageTeamsModal'
import StageBanner from '../components/tender/StageBanner'
import NewTaskModal from '../components/admin/NewTaskModal'
import ProjectStatusPill from '../components/tender/ProjectStatusPill'
import UpdateProjectStatusModal from '../components/tender/UpdateProjectStatusModal'
import ProgressRing from '../components/charts/ProgressRing'
import PerTeamProgress from '../components/charts/PerTeamProgress'
import OverdueTasksList from '../components/charts/OverdueTasksList'
import StatusDonut from '../components/charts/StatusDonut'
import { aggregateProgress, formatPercent } from '../lib/progress'
import type { Project, Task, Team, User } from '../types/models'
import { isProjectClosed } from '../lib/projectStatus'

type ProjectTab = 'overview' | 'analytics'

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 32 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white ring-2 ring-[#0b0b12]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function TeamCard({
  team,
  projectId,
  users,
  teamTasks,
}: {
  team: Team
  projectId: string
  users: Map<string, User>
  teamTasks: Task[]
}) {
  const lead = users.get(team.leadId)
  const others = team.memberIds
    .filter((uid) => uid !== team.leadId)
    .map((uid) => users.get(uid))
    .filter(Boolean) as User[]
  const visible = others.slice(0, 3)
  const extra = Math.max(0, others.length - visible.length)

  const progress = aggregateProgress(teamTasks)
  const openCount = teamTasks.filter((t) => t.status !== 'done').length

  return (
    <Link
      to={`/projects/${projectId}/teams/${team.id}`}
      className="group flex flex-col rounded-2xl border border-white/10 bg-white/2 p-4 transition hover:border-white/20 hover:bg-white/4"
    >
      <h3 className="text-base font-semibold text-white">{team.name}</h3>
      {team.description && (
        <p className="mt-1 line-clamp-2 text-xs text-white/55">{team.description}</p>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
        {lead ? (
          <>
            <Avatar user={lead} size={20} />
            <span className="truncate">
              <span className="text-white/80">{lead.displayName}</span>
              <span className="ml-1 text-white/40">· Lead</span>
            </span>
          </>
        ) : (
          <span className="text-white/40">No lead</span>
        )}
      </div>

      <div className="mt-4">
        {teamTasks.length === 0 ? (
          <div className="text-xs text-white/40">No tasks yet</div>
        ) : (
          <ProgressBar progress={progress} size="sm" showLabel={false} />
        )}
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-white/50">
            {teamTasks.length === 0
              ? '—'
              : `${openCount} open · ${formatPercent(progress)}`}
          </span>
          <span className="text-white/40">
            {teamTasks.length} task{teamTasks.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-white/50">
        <div className="flex -space-x-2">
          {visible.length === 0 ? (
            <span className="text-white/40">No other members</span>
          ) : (
            <>
              {visible.map((m) => (
                <Avatar key={m.uid} user={m} size={20} />
              ))}
              {extra > 0 && (
                <div
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/8 text-[9px] font-semibold text-white/70 ring-2 ring-[#0b0b12]"
                  aria-hidden
                >
                  +{extra}
                </div>
              )}
            </>
          )}
        </div>
        <span>
          {team.memberIds.length} member{team.memberIds.length === 1 ? '' : 's'}
        </span>
      </div>
    </Link>
  )
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [statusUpdateOpen, setStatusUpdateOpen] = useState(false)
  const [tab, setTab] = useState<ProjectTab>('overview')
  const { users } = useAllUsers()
  const { teams } = useAllTeams()
  const { tasks: projectTasks } = useProjectTasks(projectId)
  const { isAdmin, isProjectOwner, isVerticalHead, canUpdateStatus } = usePermissions(projectId)

  useEffect(() => {
    if (!projectId) return
    return onSnapshot(
      doc(db, 'projects', projectId),
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

  const teamById = useMemo(() => {
    const m = new Map<string, Team>()
    for (const t of teams) m.set(t.id, t)
    return m
  }, [teams])

  const tasksByTeam = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of projectTasks) {
      let arr = m.get(t.teamId)
      if (!arr) {
        arr = []
        m.set(t.teamId, arr)
      }
      arr.push(t)
    }
    return m
  }, [projectTasks])

  const overallProgress = useMemo(
    () => aggregateProgress(projectTasks),
    [projectTasks],
  )

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-white/40 sm:px-6 lg:px-8">
        Loading project…
      </div>
    )
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-white">Project not found</h1>
        <p className="mt-2 text-white/50">It may have been deleted or the link is invalid.</p>
        <Link
          to="/projects"
          className="mt-6 inline-block rounded-lg border border-white/10 bg-white/4 px-4 py-2 text-sm text-white/80 transition hover:bg-white/8"
        >
          Back to projects
        </Link>
      </div>
    )
  }

  const owner = userById.get(project.ownerId)
  const vh = project.vhId ? userById.get(project.vhId) : undefined
  const submissionDeadline = project.submissionDate ?? project.deadline
  const isClosed = isProjectClosed(project.status)
  const overdue =
    submissionDeadline &&
    !isClosed &&
    submissionDeadline.toDate().getTime() < Date.now()
  // Project owner, admins/super_admins, or the assigned VH can manage teams.
  // Once the outcome is conclusive, lock down to super_admin / owner only.
  const canManageTeams = !isClosed && (isAdmin || isProjectOwner || isVerticalHead)
  const assignedTeams = (project.teamIds ?? [])
    .map((id) => teamById.get(id))
    .filter(Boolean) as Team[]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-sm text-white/50 transition hover:text-white/80"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All projects
      </Link>

      <div className="mt-4">
        <StageBanner project={project} />
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-white">{project.title}</h1>
            <ProjectStatusPill
              status={project.status}
              onClick={canUpdateStatus ? () => setStatusUpdateOpen(true) : undefined}
            />
          </div>
          {project.statusNote && (
            <p className="mt-1 text-xs text-white/45">
              <span className="text-white/30">Latest note:</span> {project.statusNote}
            </p>
          )}
          {project.description && (
            <p className="mt-2 max-w-2xl text-white/60">{project.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50">
            {owner && (
              <div className="flex items-center gap-2">
                <Avatar user={owner} size={22} />
                <span>
                  <span className="text-white/80">{owner.displayName}</span>
                  <span className="ml-1 text-white/40">· Owner</span>
                </span>
              </div>
            )}
            {vh && (
              <div className="flex items-center gap-2">
                <Avatar user={vh} size={22} />
                <span>
                  <span className="text-white/80">{vh.displayName}</span>
                  <span className="ml-1 text-white/40">· VH</span>
                </span>
              </div>
            )}
            <span className={overdue ? 'text-red-300' : undefined}>
              {overdue ? 'Overdue · ' : ''}
              {submissionDeadline
                ? `Submit by ${formatDate(submissionDeadline)}`
                : 'No submission date'}
            </span>
            <span>
              {project.teamIds?.length ?? 0} team
              {(project.teamIds?.length ?? 0) === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-5 max-w-md">
            <ProgressBar
              progress={overallProgress}
              size="md"
              label={
                projectTasks.length === 0
                  ? 'Overall progress · no tasks yet'
                  : `Overall progress · ${projectTasks.length} team task${
                      projectTasks.length === 1 ? '' : 's'
                    }`
              }
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to={`/projects/${project.id}/boards`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-4 py-2 text-sm font-medium text-white/85 transition hover:bg-white/8 hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="6" height="16" rx="1" />
              <rect x="10" y="4" width="6" height="10" rx="1" />
              <rect x="17" y="4" width="4" height="7" rx="1" />
            </svg>
            Board View
          </Link>
          {canManageTeams && (
            <button
              type="button"
              onClick={() => setNewTaskOpen(true)}
              className="rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover:from-purple-400 hover:to-fuchsia-400"
            >
              + New Task
            </button>
          )}
          {canManageTeams && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="rounded-lg border border-white/10 bg-white/4 px-4 py-2 text-sm font-medium text-white/85 transition hover:bg-white/8 hover:text-white"
            >
              Manage Teams
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/2 p-0.5">
        {(['overview', 'analytics'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === t
                ? 'bg-white/8 text-white'
                : 'text-white/60 hover:bg-white/4 hover:text-white/90'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'analytics' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ProgressRing
            progress={overallProgress}
            label={
              projectTasks.length === 0
                ? 'No tasks yet'
                : `${projectTasks.length} team task${projectTasks.length === 1 ? '' : 's'}`
            }
          />
          <StatusDonut
            tasks={projectTasks}
            title="Status distribution"
            subtitle="Team-level tasks"
          />
          <div className="lg:col-span-2">
            <PerTeamProgress teams={assignedTeams} tasksByTeam={tasksByTeam} />
          </div>
          <div className="lg:col-span-2">
            <OverdueTasksList tasks={projectTasks} />
          </div>
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/40">
            Teams
          </h2>

          {assignedTeams.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/1 p-10 text-center">
              <h3 className="text-base font-medium text-white">No teams assigned yet</h3>
              <p className="mt-2 text-sm text-white/50">
                {canManageTeams
                  ? 'Click Manage Teams to pick global teams for this project.'
                  : 'The project owner will assign teams here soon.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {assignedTeams.map((t) => (
                <TeamCard
                  key={t.id}
                  team={t}
                  projectId={project.id}
                  users={userById}
                  teamTasks={tasksByTeam.get(t.id) ?? []}
                />
              ))}
            </div>
          )}

          {project.attachments && project.attachments.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/40">
                Attachments
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {project.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/2 p-3 transition hover:border-white/20 hover:bg-white/4"
                  >
                    <FileBadge mimeType={a.mimeType} fileName={a.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{a.name}</div>
                      <div className="text-xs text-white/40">{formatFileSize(a.sizeBytes)}</div>
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-white/30"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/40">
            Details
          </h2>
          <div className="rounded-2xl border border-white/10 bg-white/2 p-5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-white/50">Owner</span>
              <span className="text-white/85">{owner?.displayName ?? '—'}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-white/50">Vertical Head</span>
              <span className="text-white/85">{vh?.displayName ?? '— not allocated —'}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-white/50">Submission</span>
              <span className={overdue ? 'text-red-300' : 'text-white/85'}>
                {formatDate(project.submissionDate)}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-white/50">Presentation</span>
              <span className="text-white/85">{formatDate(project.presentationDate)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-white/50">Created</span>
              <span className="text-white/85">{formatDate(project.createdAt)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-white/50">Last updated</span>
              <span className="text-white/85">{formatDate(project.updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {projectId && (
        <ManageTeamsModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          projectId={projectId}
          projectTitle={project.title}
          currentTeamIds={project.teamIds ?? []}
        />
      )}

      {projectId && (
        <NewTaskModal
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          projectId={projectId}
          projectTitle={project.title}
        />
      )}

      <UpdateProjectStatusModal
        open={statusUpdateOpen}
        onClose={() => setStatusUpdateOpen(false)}
        project={project}
      />
    </div>
  )
}