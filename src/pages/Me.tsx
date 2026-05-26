import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import WorkflowBadge from '../components/projects/WorkflowBadge'
import { useMyTasks } from '../hooks/useMyTasks'
import { useMyLedTeamTasks } from '../hooks/useMyLedTeamTasks'
import { useMyReviewQueue } from '../hooks/useMyReviewQueue'
import { useProjectsAwaitingMyAction } from '../hooks/useProjectsAwaitingMyAction'
import StatusDonut from '../components/charts/StatusDonut'
import PriorityBar from '../components/charts/PriorityBar'
import UpcomingDeadlines from '../components/charts/UpcomingDeadlines'
import WeeklyCompletionLine from '../components/charts/WeeklyCompletionLine'
import { stageTone } from '../components/workflow/stageStyle'
import type { Task, TaskPriority, TaskStatus } from '../types/models'

const STATUS_STYLES: Record<TaskStatus, { label: string; cls: string }> = {
  todo: { label: 'Todo', cls: 'border-line bg-fill-2 text-fg-muted' },
  in_progress: {
    label: 'In Progress',
    cls: 'border-tone-info-bd bg-tone-info-bg text-tone-info-fg',
  },
  in_review: {
    label: 'In Review',
    cls: 'border-brand-edge bg-brand-soft text-brand',
  },
  done: { label: 'Done', cls: 'border-tone-success-bd bg-tone-success-bg text-tone-success-fg' },
  blocked: { label: 'Blocked', cls: 'border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg' },
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-fg-subtle' },
  medium: { label: 'Medium', cls: 'text-tone-warn-fg' },
  high: { label: 'High', cls: 'text-tone-danger-fg' },
}

function StatusPill({ status }: { status: TaskStatus }) {
  const s = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}
    >
      {s.label}
    </span>
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

type ProjectBucket = {
  projectId: string
  projectTitle: string
  teams: Map<string, TeamBucket>
}
type TeamBucket = {
  teamId: string
  teamName: string
  tasks: Task[]
}

function groupByProjectTeam(tasks: Task[]): ProjectBucket[] {
  const projects = new Map<string, ProjectBucket>()
  for (const t of tasks) {
    let p = projects.get(t.projectId)
    if (!p) {
      p = {
        projectId: t.projectId,
        projectTitle: t.projectTitle ?? '(Untitled project)',
        teams: new Map(),
      }
      projects.set(t.projectId, p)
    }
    let tm = p.teams.get(t.teamId)
    if (!tm) {
      tm = {
        teamId: t.teamId,
        teamName: t.teamName ?? '(Untitled team)',
        tasks: [],
      }
      p.teams.set(t.teamId, tm)
    }
    tm.tasks.push(t)
  }
  return Array.from(projects.values())
}

function TaskRow({ task, showSubtaskProgress = false }: { task: Task; showSubtaskProgress?: boolean }) {
  const location = useLocation()
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    task.dueDate.toDate().getTime() < Date.now()
  const priority = PRIORITY_STYLES[task.priority]

  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <Link
        to={`/tasks/${task.id}`}
        state={{ backgroundLocation: location }}
        className="flex items-center gap-3 px-5 py-3 transition hover:bg-fill-1"
      >
        <StatusPill status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">{task.title}</div>
          {task.description && (
            <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">
              {task.description}
            </div>
          )}
        </div>
        <div className="hidden items-center gap-4 text-xs text-fg-subtle sm:flex">
          <span className={`font-medium ${priority.cls}`}>{priority.label}</span>
          <span className={overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}>
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.dueDate)}
          </span>
          {showSubtaskProgress && (
            <span className="text-fg-subtle">
              {task.subtaskDoneCount ?? 0}/{task.subtaskCount ?? 0}
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}

function GroupedTaskList({
  grouped,
  showSubtaskProgress,
}: {
  grouped: ProjectBucket[]
  showSubtaskProgress?: boolean
}) {
  return (
    <div className="space-y-6">
      {grouped.map((proj) => (
        <section key={proj.projectId}>
          <Link
            to={`/projects/${proj.projectId}`}
            className="group inline-flex items-center gap-2 text-sm text-fg-subtle transition hover:text-fg-muted"
          >
            <span className="text-xs uppercase tracking-wider text-fg-subtle">Project</span>
            <span className="font-medium text-fg-strong group-hover:text-fg">
              {proj.projectTitle}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fg-faint"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>

          <div className="mt-3 space-y-4">
            {Array.from(proj.teams.values()).map((team) => (
              <div
                key={team.teamId}
                className="overflow-hidden rounded-2xl border border-line bg-card"
              >
                <div className="flex items-center justify-between border-b border-line-subtle px-5 py-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                    {team.teamName}
                  </span>
                  <Link
                    to={`/projects/${proj.projectId}/teams/${team.teamId}`}
                    className="text-xs text-brand transition hover:text-brand"
                  >
                    Open workspace →
                  </Link>
                </div>
                <ul>
                  {team.tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      showSubtaskProgress={showSubtaskProgress}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ReviewQueueSection({ tasks }: { tasks: Task[] }) {
  const location = useLocation()
  if (tasks.length === 0) return null
  return (
    <section className="mb-10" data-tour-id="review-queue">
      <div className="mb-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-brand">
          🔍 Awaiting my review
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          Tasks where you're the named reviewer. Open one to approve or send back.
        </p>
      </div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link
              to={`/tasks/${t.id}`}
              state={{ backgroundLocation: location }}
              className="flex items-center gap-3 rounded-xl border border-brand-edge bg-brand-soft px-4 py-3 transition hover:bg-brand-soft"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-edge bg-brand-soft text-base">
                🔍
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{t.title}</div>
                <div className="mt-0.5 text-xs text-fg-subtle">
                  {t.projectTitle ?? '—'}
                  <span className="mx-1.5 text-fg-faint">·</span>
                  {t.teamName ?? '—'}
                  {t.assigneeName && (
                    <>
                      <span className="mx-1.5 text-fg-faint">·</span>
                      from {t.assigneeName}
                    </>
                  )}
                </div>
              </div>
              <span className="hidden text-xs text-brand/80 sm:block">Review →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProjectsAwaitingActionSection() {
  const { projects } = useProjectsAwaitingMyAction()
  if (projects.length === 0) return null
  return (
    <section className="mb-10" data-tour-id="projects-awaiting-action">
      <div className="mb-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-tone-warn-fg">
          🚦 Projects awaiting my action
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          The workflow is blocked on you. Take an action to move things forward.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {projects.map(({ project, cta, reason, workflow }) => {
          const stage =
            workflow.stages.find((s) => s.id === project.currentStageId) ??
            workflow.stages[0]
          const tone = stageTone(stage?.order ?? 1, stage?.isTerminal ?? false)
          // Escalation-flavoured visual: surface danger styling when the project
          // sits back at the starting stage with at least one escalation logged.
          const isEscalated =
            (project.escalationCount ?? 0) > 0 &&
            (stage?.id === workflow.stages[0]?.id || reason === 'allocate')
          const cardCls = isEscalated
            ? 'group flex h-full flex-col justify-between gap-3 rounded-xl border border-tone-danger-bd bg-tone-danger-bg p-4 transition hover:opacity-90'
            : 'group flex h-full flex-col justify-between gap-3 rounded-xl border border-tone-warn-bd bg-tone-warn-bg p-4 transition hover:opacity-90'
          const ctaCls = isEscalated
            ? 'inline-flex items-center justify-between gap-2 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-1.5 text-xs font-medium text-tone-danger-fg transition group-hover:bg-tone-danger-bg'
            : 'inline-flex items-center justify-between gap-2 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-3 py-1.5 text-xs font-medium text-tone-warn-fg transition group-hover:bg-tone-warn-bg'
          return (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`} className={cardCls}>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                      {stage?.displayName ?? '—'}
                    </span>
                    <WorkflowBadge workflow={workflow} compact />
                  </div>
                  <h3 className="mt-2 text-sm font-medium text-fg">{project.title}</h3>
                  {project.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{project.description}</p>
                  )}
                </div>
                <span className={ctaCls}>
                  {cta}
                  <span aria-hidden>→</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function Me() {
  const { user, profile, effectiveUid, effectiveProfile } = useAuth()
  // Sandbox: when a persona is being acted as, all "my tasks / my review
  // queue / my led teams" surfaces should reflect *that* persona's lens, not
  // the real visitor's. Production: effectiveUid === user.uid, no-op branch.
  const lensUid = __IS_SANDBOX__ ? (effectiveUid ?? user?.uid) : user?.uid
  const lensProfile = __IS_SANDBOX__ ? (effectiveProfile ?? profile) : profile
  const {
    tasks: myTasks,
    loading: myLoading,
    error: myError,
  } = useMyTasks(lensUid)
  const {
    tasks: ledTasks,
    loading: ledLoading,
    error: ledError,
  } = useMyLedTeamTasks(lensUid)
  const { tasks: reviewQueue } = useMyReviewQueue(lensUid)
  const [showCompleted, setShowCompleted] = useState(false)
  const [showDashboard, setShowDashboard] = useState(true)

  const filteredMine = useMemo(
    () => (showCompleted ? myTasks : myTasks.filter((t) => t.status !== 'done')),
    [myTasks, showCompleted],
  )
  const filteredLed = useMemo(
    () => (showCompleted ? ledTasks : ledTasks.filter((t) => t.status !== 'done')),
    [ledTasks, showCompleted],
  )

  const groupedMine = useMemo(() => groupByProjectTeam(filteredMine), [filteredMine])
  const groupedLed = useMemo(() => groupByProjectTeam(filteredLed), [filteredLed])

  const openCount = useMemo(
    () => myTasks.filter((t) => t.status !== 'done').length,
    [myTasks],
  )
  const doneCount = myTasks.length - openCount
  const overdueCount = useMemo(
    () =>
      [...myTasks, ...ledTasks].filter(
        (t) =>
          t.status !== 'done' &&
          t.dueDate &&
          t.dueDate.toDate().getTime() < Date.now(),
      ).length,
    [myTasks, ledTasks],
  )
  const ledOpenCount = useMemo(
    () => ledTasks.filter((t) => t.status !== 'done').length,
    [ledTasks],
  )

  const firstName = lensProfile?.displayName?.split(/\s+/)[0] ?? ''

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-tour-id="my-tasks">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-fg-subtle">My workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
            Hi{firstName ? `, ${firstName}` : ''}. Here's what's on your plate.
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="text-fg-muted">
              <span className="font-semibold text-fg">{openCount}</span> open
            </span>
            <span className="text-fg-muted">
              <span className="font-semibold text-fg">{doneCount}</span> done
            </span>
            {ledOpenCount > 0 && (
              <span className="text-fg-muted">
                <span className="font-semibold text-fg">{ledOpenCount}</span> led
              </span>
            )}
            {overdueCount > 0 && (
              <span className="text-tone-danger-fg">
                <span className="font-semibold">{overdueCount}</span> overdue
              </span>
            )}
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong bg-fill-2 text-brand accent-brand"
          />
          Show completed
        </label>
      </div>

      <ReviewQueueSection tasks={reviewQueue} />
      <ProjectsAwaitingActionSection />

      <section className="mb-10">
        <div className="mb-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Assigned to me
          </h2>
        </div>

        {myError ? (
          <div className="rounded-2xl border border-tone-danger-bd bg-tone-danger-bg p-6 text-sm text-tone-danger-fg">
            Couldn't load your tasks: {myError}
            {myError.includes('index') && (
              <div className="mt-2 text-tone-danger-fg/70">
                Firestore wants a composite index on{' '}
                <code className="rounded bg-fill-2 px-1">assigneeId</code> +{' '}
                <code className="rounded bg-fill-2 px-1">updatedAt</code>. Open the link in your
                browser console to create it.
              </div>
            )}
          </div>
        ) : myLoading ? (
          <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-fg-subtle">
            Loading your tasks…
          </div>
        ) : groupedMine.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center">
            <h3 className="text-base font-medium text-fg">
              {myTasks.length === 0 ? 'Nothing assigned to you yet' : 'All caught up'}
            </h3>
            <p className="mt-2 text-sm text-fg-subtle">
              {myTasks.length === 0
                ? 'When a team lead delegates a subtask to you, it will show up here.'
                : 'Toggle "Show completed" to see what you finished.'}
            </p>
          </div>
        ) : (
          <GroupedTaskList grouped={groupedMine} />
        )}
      </section>

      {(ledLoading || ledTasks.length > 0) && (
        <section>
          <div className="mb-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Led by me
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">
              Team-level tasks on teams where you're the lead. You own delegation for these.
            </p>
          </div>

          {ledError ? (
            <div className="rounded-2xl border border-tone-danger-bd bg-tone-danger-bg p-6 text-sm text-tone-danger-fg">
              Couldn't load led tasks: {ledError}
            </div>
          ) : ledLoading ? (
            <div className="rounded-2xl border border-line bg-card p-10 text-center text-sm text-fg-subtle">
              Loading team tasks…
            </div>
          ) : groupedLed.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center text-sm text-fg-subtle">
              No open team-level tasks on the teams you lead.
            </div>
          ) : (
            <GroupedTaskList grouped={groupedLed} showSubtaskProgress />
          )}
        </section>
      )}

      {(myTasks.length > 0 || ledTasks.length > 0) && (
        <section className="mt-12">
          <button
            type="button"
            onClick={() => setShowDashboard((s) => !s)}
            aria-expanded={showDashboard}
            className="flex w-full items-center justify-between gap-4 border-t border-line-subtle pt-6 text-left transition hover:text-fg"
          >
            <div>
              <h2 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                Your dashboard
              </h2>
              <p className="mt-1 text-xs text-fg-subtle">
                Status, priorities, upcoming deadlines, and your weekly throughput.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-fill-2 px-2.5 py-1 text-xs text-fg-muted transition hover:bg-fill-4 hover:text-fg">
              {showDashboard ? 'Hide' : 'Show'}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${showDashboard ? '' : '-rotate-90'}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>

          {showDashboard && (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <StatusDonut
                tasks={[...myTasks, ...ledTasks]}
                title="Your status breakdown"
                subtitle="Open tasks across everything on your plate"
                excludeDone
              />
              <PriorityBar
                tasks={[...myTasks, ...ledTasks]}
                title="Priority mix"
                subtitle="Open tasks by priority"
              />
              <UpcomingDeadlines tasks={[...myTasks, ...ledTasks]} />
              <WeeklyCompletionLine tasks={myTasks} />
            </div>
          )}
        </section>
      )}
    </main>
  )
}