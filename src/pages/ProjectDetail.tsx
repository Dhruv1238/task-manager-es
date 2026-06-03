import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {  onSnapshot, Timestamp } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAllTeams } from '../hooks/useAllTeams'
import { useProjectTasks } from '../hooks/useProjectTasks'
import { usePermissions } from '../hooks/usePermissions'
import { useLeadRoleName, useProjectWorkflow } from '../contexts/AppConfigContext'
import { uploadAsset } from '../lib/uploadAsset'
import { addProjectAttachment, tenantDoc } from '../lib/firestore'
import FileBadge, { formatFileSize } from '../components/ui/FileBadge'
import ProgressBar from '../components/ui/ProgressBar'
import ManageTeamsModal from '../components/admin/ManageTeamsModal'
import ProjectRolesSection from '../components/project/ProjectRolesSection'
import ProjectFieldsSection from '../components/project/ProjectFieldsSection'
import SubtasksPanel from '../components/tasks/SubtasksPanel'
import StageBanner from '../components/workflow/StageBanner'
import NewTaskModal from '../components/admin/NewTaskModal'
import ProjectStatusPill from '../components/workflow/ProjectStatusPill'
import UpdateProjectStatusModal from '../components/workflow/UpdateProjectStatusModal'
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
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white ring-2 ring-surface"
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
      className="group flex flex-col rounded-2xl border border-line bg-card p-4 transition hover:border-line-strong hover:bg-fill-2"
    >
      <h3 className="text-base font-semibold text-fg">{team.name}</h3>
      {team.description && (
        <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{team.description}</p>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
        {lead ? (
          <>
            <Avatar user={lead} size={20} />
            <span className="truncate">
              <span className="text-fg-muted">{lead.displayName}</span>
              <span className="ml-1 text-fg-subtle">· Lead</span>
            </span>
          </>
        ) : (
          <span className="text-fg-subtle">No lead</span>
        )}
      </div>

      <div className="mt-4">
        {teamTasks.length === 0 ? (
          <div className="text-xs text-fg-subtle">No tasks yet</div>
        ) : (
          <ProgressBar progress={progress} size="sm" showLabel={false} />
        )}
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-fg-subtle">
            {teamTasks.length === 0
              ? '—'
              : `${openCount} open · ${formatPercent(progress)}`}
          </span>
          <span className="text-fg-subtle">
            {teamTasks.length} task{teamTasks.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line-subtle pt-3 text-xs text-fg-subtle">
        <div className="flex -space-x-2">
          {visible.length === 0 ? (
            <span className="text-fg-subtle">No other members</span>
          ) : (
            <>
              {visible.map((m) => (
                <Avatar key={m.uid} user={m} size={20} />
              ))}
              {extra > 0 && (
                <div
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line bg-fill-4 text-[9px] font-semibold text-fg-muted ring-2 ring-surface"
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
  const {
    isAdmin,
    isSuperAdmin,
    isProjectOwner,
    isProjectLead,
    canUpdateStatus,
    canEditProjectMeta,
    can,
  } = usePermissions(projectId)
  const orgLeadRoleName = useLeadRoleName()
  const workflow = useProjectWorkflow(project)
  // Per-workflow lead label, falling back to the org-wide one for fresh
  // projects loaded before the workflow doc resolves.
  const leadRoleName = workflow?.leadRoleName || orgLeadRoleName
  // Collaborative-flow projects get the full tender sidebar (lead, dates,
  // pitch metrics). Individual / basic flows render a simpler details block.
  const isCollabFlow = workflow?.flowType === 'collaborative'
  const { user, profile } = useAuth()
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
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
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-fg-subtle sm:px-6 lg:px-8">
        Loading project…
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

  // Phase 2d: owner retired — show the creator (createdBy) as a muted attribution.
  const creator = userById.get(project.createdBy)
  const projectLeadId = project.leadUid ?? null
  const vh = projectLeadId ? userById.get(projectLeadId) : undefined
  const submissionDeadline = project.submissionDate ?? project.deadline
  const isClosed = isProjectClosed(project.status)
  const overdue =
    submissionDeadline &&
    !isClosed &&
    submissionDeadline.toDate().getTime() < Date.now()
  // Managing teams (assigning global teams to the project) now honors the
  // Role-Hierarchy "Teams" module access (create/update) in addition to the
  // admin / owner / lead baseline — so a configured Functional/Admin Head can
  // manage teams without being the allocated lead.
  const canManageTeams =
    !isClosed &&
    (isAdmin || isProjectOwner || isProjectLead || can('teams', 'create') || can('teams', 'update'))
  // Creating tasks is an always-on op for anyone on the project (role-holder,
  // creator, admin, or lead), plus anyone the hierarchy grants Tasks → Create.
  const canCreateTask =
    !isClosed && (canEditProjectMeta || isProjectLead || can('tasks', 'create'))
  const canAddAttachments = isSuperAdmin || isProjectLead
  const projectAttachments = project.attachments ?? []
  const assignedTeams = (project.teamIds ?? [])
    .map((id) => teamById.get(id))
    .filter(Boolean) as Team[]

  async function handleAttachmentFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const target = e.target
    const picked = Array.from(target.files ?? [])
    target.value = ''
    if (!user || !project || picked.length === 0) return

    setAttachmentError(null)
    setUploadingAttachment(true)
    try {
      for (const f of picked) {
        const result = await uploadAsset(f)
        await addProjectAttachment({
          projectId: project.id,
          projectTitle: project.title,
          attachment: {
            id: crypto.randomUUID(),
            name: result.fileName,
            url: result.url,
            key: result.key,
            mimeType: result.contentType,
            sizeBytes: result.sizeBytes,
            uploadedBy: user.uid,
            uploadedAt: Timestamp.now(),
          },
          actorId: user.uid,
          actorName: profile?.displayName ?? user.email ?? 'User',
        })
      }
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingAttachment(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-sm text-fg-subtle transition hover:text-fg-muted"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All projects
      </Link>

      <div className="mt-4">
        <div data-tour-id="project-stage-banner">
          <StageBanner project={project} />
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-fg">{project.title}</h1>
            <ProjectStatusPill
              status={project.status}
              workflow={workflow}
              onClick={canUpdateStatus ? () => setStatusUpdateOpen(true) : undefined}
            />
          </div>
          {project.statusNote && (
            <p className="mt-1 text-xs text-fg-subtle">
              <span className="text-fg-faint">Latest note:</span> {project.statusNote}
            </p>
          )}
          {project.description && (
            <p className="mt-2 max-w-2xl text-fg-muted">{project.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-fg-subtle">
            {vh && (
              <div className="flex items-center gap-2">
                <Avatar user={vh} size={22} />
                <span>
                  <span className="text-fg-muted">{vh.displayName}</span>
                  <span className="ml-1 text-fg-subtle">· {leadRoleName}</span>
                </span>
              </div>
            )}
            {(isCollabFlow || submissionDeadline) && (
              <span className={overdue ? 'text-tone-danger-fg' : undefined}>
                {overdue ? 'Overdue · ' : ''}
                {submissionDeadline
                  ? `${isCollabFlow ? 'Submit by ' : 'Due '}${formatDate(submissionDeadline)}`
                  : 'No submission date'}
              </span>
            )}
            <span>
              {project.teamIds?.length ?? 0} team
              {(project.teamIds?.length ?? 0) === 1 ? '' : 's'}
            </span>
            <span className="text-fg-faint">
              Created by {creator?.displayName ?? '—'} · {formatDate(project.createdAt)}
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="6" height="16" rx="1" />
              <rect x="10" y="4" width="6" height="10" rx="1" />
              <rect x="17" y="4" width="4" height="7" rx="1" />
            </svg>
            Board View
          </Link>
          {canCreateTask && (
            <button
              type="button"
              onClick={() => setNewTaskOpen(true)}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient"
            >
              + New Task
            </button>
          )}
          {canManageTeams && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg"
            >
              Manage Teams
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 inline-flex items-center gap-1 rounded-lg border border-line bg-card p-0.5">
        {(['overview', 'analytics'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === t
                ? 'bg-fill-4 text-fg'
                : 'text-fg-muted hover:bg-fill-2 hover:text-fg-strong'
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
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
            Teams
          </h2>

          {assignedTeams.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center">
              <h3 className="text-base font-medium text-fg">No teams assigned yet</h3>
              <p className="mt-2 text-sm text-fg-subtle">
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

          {(projectAttachments.length > 0 || canAddAttachments) && (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
                  Attachments
                  {projectAttachments.length > 0 && (
                    <span className="ml-1 text-fg-muted">({projectAttachments.length})</span>
                  )}
                </h2>
                {canAddAttachments && (
                  <>
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={uploadingAttachment}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg disabled:opacity-60"
                    >
                      {uploadingAttachment ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-white" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          Add files
                        </>
                      )}
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleAttachmentFiles}
                    />
                  </>
                )}
              </div>

              {attachmentError && (
                <div
                  role="alert"
                  className="mb-3 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"
                >
                  {attachmentError}
                </div>
              )}

              {projectAttachments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-xs text-fg-subtle">
                  No attachments yet.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {projectAttachments.map((a) => (
                    <a
                      key={a.id}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 transition hover:border-line-strong hover:bg-fill-2"
                    >
                      <FileBadge mimeType={a.mimeType} fileName={a.name} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg">{a.name}</div>
                        <div className="text-xs text-fg-subtle">{formatFileSize(a.sizeBytes)}</div>
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
                        className="shrink-0 text-fg-faint"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <ProjectRolesSection
            project={project}
            workflow={workflow}
            userById={userById}
            canEdit={canEditProjectMeta}
            actorId={user?.uid ?? ''}
            actorName={profile?.displayName ?? user?.email ?? 'User'}
          />

          {/* Phase 3: simple subtasks under the project. */}
          <SubtasksPanel projectId={project.id} />

          <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
            Details
          </h2>
          <div className="rounded-2xl border border-line bg-card p-5 text-sm">
            {/* Lead row: shown for any workflow that has the concept (collab
             * + individual). Basic-flow projects have no lead. */}
            {workflow && workflow.flowType !== 'basic' && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-fg-subtle">{leadRoleName}</span>
                <span className="text-fg-strong">{vh?.displayName ?? '— not allocated —'}</span>
              </div>
            )}
            {/* Submission / presentation dates only apply to the
             * collaborative flow (tender pitches). Other flow types track
             * deadlines via project.deadline (rendered in the header). */}
            {isCollabFlow && (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-fg-subtle">Submission</span>
                  <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-strong'}>
                    {formatDate(project.submissionDate)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-fg-subtle">Presentation</span>
                  <span className="text-fg-strong">{formatDate(project.presentationDate)}</span>
                </div>
              </>
            )}
            {workflow && !isCollabFlow && project.deadline && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-fg-subtle">Deadline</span>
                <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-strong'}>
                  {formatDate(project.deadline)}
                </span>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-fg-subtle">Created</span>
              <span className="text-fg-strong">{formatDate(project.createdAt)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-fg-subtle">Last updated</span>
              <span className="text-fg-strong">{formatDate(project.updatedAt)}</span>
            </div>
          </div>
          </div>

          <ProjectFieldsSection
            project={project}
            workflow={workflow}
            userById={userById}
            canEdit={canEditProjectMeta}
            actorId={user?.uid ?? ''}
            actorName={profile?.displayName ?? user?.email ?? 'User'}
          />
        </div>
      </div>
      )}

      {projectId && (
        <ManageTeamsModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          projectId={projectId}
          projectTitle={project.title}
          roleAssignments={project.roleAssignments}
          createdBy={project.createdBy ?? project.ownerId}
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