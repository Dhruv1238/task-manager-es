import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Timestamp } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useMyTasks } from '../hooks/useMyTasks'
import { useMyLedTeamTasks } from '../hooks/useMyLedTeamTasks'
import StatusDonut from '../components/charts/StatusDonut'
import PriorityBar from '../components/charts/PriorityBar'
import UpcomingDeadlines from '../components/charts/UpcomingDeadlines'
import WeeklyCompletionLine from '../components/charts/WeeklyCompletionLine'
import type { Task, TaskPriority, TaskStatus } from '../types/models'

const STATUS_STYLES: Record<TaskStatus, { label: string; cls: string }> = {
  todo: { label: 'Todo', cls: 'border-white/15 bg-white/5 text-white/70' },
  in_progress: {
    label: 'In Progress',
    cls: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
  },
  in_review: {
    label: 'In Review',
    cls: 'border-purple-400/40 bg-purple-500/15 text-purple-200',
  },
  done: { label: 'Done', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' },
  blocked: { label: 'Blocked', cls: 'border-red-400/40 bg-red-500/15 text-red-200' },
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-white/50' },
  medium: { label: 'Medium', cls: 'text-amber-300' },
  high: { label: 'High', cls: 'text-red-300' },
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
    <li className="border-b border-white/5 last:border-b-0">
      <Link
        to={`/tasks/${task.id}`}
        state={{ backgroundLocation: location }}
        className="flex items-center gap-3 px-5 py-3 transition hover:bg-white/2"
      >
        <StatusPill status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{task.title}</div>
          {task.description && (
            <div className="mt-0.5 line-clamp-1 text-xs text-white/50">
              {task.description}
            </div>
          )}
        </div>
        <div className="hidden items-center gap-4 text-xs text-white/50 sm:flex">
          <span className={`font-medium ${priority.cls}`}>{priority.label}</span>
          <span className={overdue ? 'text-red-300' : 'text-white/50'}>
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.dueDate)}
          </span>
          {showSubtaskProgress && (
            <span className="text-white/40">
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
            className="group inline-flex items-center gap-2 text-sm text-white/50 transition hover:text-white/80"
          >
            <span className="text-xs uppercase tracking-wider text-white/40">Project</span>
            <span className="font-medium text-white/85 group-hover:text-white">
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
              className="text-white/30"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>

          <div className="mt-3 space-y-4">
            {Array.from(proj.teams.values()).map((team) => (
              <div
                key={team.teamId}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/2"
              >
                <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                    {team.teamName}
                  </span>
                  <Link
                    to={`/projects/${proj.projectId}/teams/${team.teamId}`}
                    className="text-xs text-purple-300 transition hover:text-purple-200"
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

export default function Me() {
  const { user, profile } = useAuth()
  const {
    tasks: myTasks,
    loading: myLoading,
    error: myError,
  } = useMyTasks(user?.uid)
  const {
    tasks: ledTasks,
    loading: ledLoading,
    error: ledError,
  } = useMyLedTeamTasks(user?.uid)
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

  const firstName = profile?.displayName?.split(/\s+/)[0] ?? ''

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-white/40">My workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
            Hi{firstName ? `, ${firstName}` : ''}. Here's what's on your plate.
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="text-white/60">
              <span className="font-semibold text-white">{openCount}</span> open
            </span>
            <span className="text-white/60">
              <span className="font-semibold text-white">{doneCount}</span> done
            </span>
            {ledOpenCount > 0 && (
              <span className="text-white/60">
                <span className="font-semibold text-white">{ledOpenCount}</span> led
              </span>
            )}
            {overdueCount > 0 && (
              <span className="text-red-300">
                <span className="font-semibold">{overdueCount}</span> overdue
              </span>
            )}
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-white/5 text-purple-500 accent-purple-500"
          />
          Show completed
        </label>
      </div>

      <section className="mb-10">
        <div className="mb-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-white/40">
            Assigned to me
          </h2>
        </div>

        {myError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
            Couldn't load your tasks: {myError}
            {myError.includes('index') && (
              <div className="mt-2 text-red-200/70">
                Firestore wants a composite index on{' '}
                <code className="rounded bg-white/5 px-1">assigneeId</code> +{' '}
                <code className="rounded bg-white/5 px-1">updatedAt</code>. Open the link in your
                browser console to create it.
              </div>
            )}
          </div>
        ) : myLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/2 p-10 text-center text-sm text-white/40">
            Loading your tasks…
          </div>
        ) : groupedMine.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/1 p-10 text-center">
            <h3 className="text-base font-medium text-white">
              {myTasks.length === 0 ? 'Nothing assigned to you yet' : 'All caught up'}
            </h3>
            <p className="mt-2 text-sm text-white/50">
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
            <h2 className="text-xs font-medium uppercase tracking-wider text-white/40">
              Led by me
            </h2>
            <p className="mt-1 text-xs text-white/40">
              Team-level tasks on teams where you're the lead. You own delegation for these.
            </p>
          </div>

          {ledError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
              Couldn't load led tasks: {ledError}
            </div>
          ) : ledLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/2 p-10 text-center text-sm text-white/40">
              Loading team tasks…
            </div>
          ) : groupedLed.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/1 p-10 text-center text-sm text-white/50">
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
            className="flex w-full items-center justify-between gap-4 border-t border-white/5 pt-6 text-left transition hover:text-white"
          >
            <div>
              <h2 className="text-xs font-medium uppercase tracking-wider text-white/40">
                Your dashboard
              </h2>
              <p className="mt-1 text-xs text-white/40">
                Status, priorities, upcoming deadlines, and your weekly throughput.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/4 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/8 hover:text-white">
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