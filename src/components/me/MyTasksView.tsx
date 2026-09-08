import { useCallback, useMemo, useState, useRef } from 'react'
import { useFeature } from '../../contexts/AppConfigContext'
import { useMyTasks } from '../../hooks/useMyTasks'
import { useMyLedTeamTasks } from '../../hooks/useMyLedTeamTasks'
import { useMyReviewQueue } from '../../hooks/useMyReviewQueue'
import { useProjectsAwaitingMyAction } from '../../hooks/useProjectsAwaitingMyAction'
import { useAllProjects } from '../../hooks/useAllProjects'
import { groupByProjectTeam, isOverdueTask, mergeUniqueById } from '../../lib/myTasksDerive'
import { isComplete, isTerminal } from '../../lib/taskStatus'
import MyTimeSection from '../tasks/MyTimeSection'
import TaskDrillDownPanel from '../charts/TaskDrillDownPanel'
import MyTasksCharts from './MyTasksCharts'
import PendingActionsSection from './PendingActionsSection'
import { myTasksCopy } from './copy'
import StatTiles, { type StatTileSpec } from './StatTiles'
import TaskListSection from './TaskListSection'
import type { DrillDown, MyTasksHeading } from './types'
import type { Task, User } from '../../types/models'

export interface MyTasksViewProps {
  /** Whose tasks, led teams and review queue to stream. */
  uid: string | undefined
  /** Whose workflow inbox to compute. Explicit `null` = nobody. */
  profile: User | null
  heading: MyTasksHeading
  /**
   * The REAL signed-in uid, for the personal timesheet. Omitted on the admin
   * view: a time report is not "my time" when you are looking at someone else,
   * and admins have /admin/time for that.
   */
  timeUid?: string
  /**
   * Whose plate this is, for wording. Omitted on /me, where the reader IS the
   * person and the copy reads "Assigned to me" / "blocked on you"; supplied on
   * the admin view, where that wording would be misleading. See copy.ts.
   */
  personName?: string
}

/**
 * The My Tasks surface, shared by /me and /admin/member-tasks.
 *
 * Doctrine: every tile number is `someArray.length`, and clicking the tile
 * hands that SAME array to the drill-down panel. Nothing is recounted or
 * re-filtered on the way into the panel, so a number and the list behind it
 * cannot disagree.
 */
export default function MyTasksView({
  uid,
  profile,
  heading,
  timeUid,
  personName,
}: MyTasksViewProps) {
  const copy = useMemo(() => myTasksCopy(personName), [personName])
  const { tasks: myTasks, loading: myLoading, error: myError } = useMyTasks(uid)
  const { tasks: ledTasks, loading: ledLoading, error: ledError } = useMyLedTeamTasks(uid)
  const { tasks: reviewQueue, loading: reviewLoading, error: reviewError } = useMyReviewQueue(uid)
  // The inbox belongs to the person being VIEWED, not the visitor — hence the
  // explicit profile rather than the hook's default of useAuth().profile.
  const { projects: actionableAll, loading: actionableLoading } =
    useProjectsAwaitingMyAction(profile)

  const [showCompleted, setShowCompleted] = useState(false)
  const [showSubmitted, setShowSubmitted] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(true)
  const [mineOpen, setMineOpen] = useState(true)
  const [ledOpen, setLedOpen] = useState(true)
  const [drill, setDrill] = useState<DrillDown | null>(null)
  const pendingRef = useRef<HTMLElement>(null)
  const timeTrackingOn = useFeature('timeTracking')

  // Project status by id — used to hide tasks whose project has been submitted
  // (the work is off the assignee's plate). Fail open: a task whose project
  // isn't in the map yet (loading / deleted) stays visible.
  const { projects: allProjects } = useAllProjects()
  const statusById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of allProjects) m.set(p.id, p.status)
    return m
  }, [allProjects])

  // Submitted filter runs UPSTREAM of the completed filter so both the lists and
  // the header stats agree on what's visible.
  const visibleMine = useMemo(
    () =>
      showSubmitted ? myTasks : myTasks.filter((t) => statusById.get(t.projectId) !== 'submitted'),
    [myTasks, showSubmitted, statusById],
  )
  const visibleLed = useMemo(
    () =>
      showSubmitted ? ledTasks : ledTasks.filter((t) => statusById.get(t.projectId) !== 'submitted'),
    [ledTasks, showSubmitted, statusById],
  )

  // "Show completed" reveals all finished work — cancelled is off your plate
  // just like done, so it hides/reveals with the same toggle.
  const filteredMine = useMemo(
    () => (showCompleted ? visibleMine : visibleMine.filter((t) => !isTerminal(t.status))),
    [visibleMine, showCompleted],
  )
  const filteredLed = useMemo(
    () => (showCompleted ? visibleLed : visibleLed.filter((t) => !isTerminal(t.status))),
    [visibleLed, showCompleted],
  )

  const groupedMine = useMemo(() => groupByProjectTeam(filteredMine), [filteredMine])
  const groupedLed = useMemo(() => groupByProjectTeam(filteredLed), [filteredLed])

  // Each of these arrays IS a tile's value (via .length) and IS what the tile
  // opens in the panel. Only "Show submitted" applies here; "Show completed"
  // scopes the lists alone, which is why they read visibleMine/visibleLed.
  const openMine = useMemo(
    () => visibleMine.filter((t) => !isTerminal(t.status)),
    [visibleMine],
  )
  // "done" means completed work — cancelled tasks count as neither open nor done.
  const doneMine = useMemo(() => visibleMine.filter((t) => isComplete(t.status)), [visibleMine])
  const openLed = useMemo(() => visibleLed.filter((t) => !isTerminal(t.status)), [visibleLed])
  const overdue = useMemo(
    () => mergeUniqueById(visibleMine, visibleLed).filter((t) => isOverdueTask(t)),
    [visibleMine, visibleLed],
  )
  const actionable = useMemo(
    // Same submitted filter the task lists use, so the whole page hides and
    // reveals in lockstep.
    () =>
      showSubmitted
        ? actionableAll
        : actionableAll.filter((a) => a.project.status !== 'submitted'),
    [actionableAll, showSubmitted],
  )

  // Analytics deliberately reflect ALL of this person's tasks, independent of
  // the Show completed / Show submitted toggles (which only scope the lists) —
  // the charts are a full-picture overview. De-duplicated because a task on a
  // team you lead that is also assigned to you arrives from both streams, and
  // memoised ONCE because building it inline in JSX would hand every chart a
  // fresh array on every keystroke and bust all of their memos.
  const allTasks = useMemo(() => mergeUniqueById(myTasks, ledTasks), [myTasks, ledTasks])

  // Live docs by id, so a status changed inside the task modal stacked on the
  // panel shows fresh while panel MEMBERSHIP stays the clicked snapshot.
  const liveById = useMemo(() => {
    const m = new Map<string, Task>()
    for (const t of allTasks) m.set(t.id, t)
    for (const t of reviewQueue) m.set(t.id, t)
    return m
  }, [allTasks, reviewQueue])

  // Stable identity: Modal rebinds its Escape listener when onClose changes,
  // and the stacking guard depends on the lower modal not reshuffling the stack.
  const closeDrill = useCallback(() => setDrill(null), [])

  const revealPending = useCallback(() => {
    setPendingOpen(true)
    // Pending actions mixes tasks and projects, so a task-only drill-down panel
    // does not fit — this tile scrolls to the real section instead.
    pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const tiles: StatTileSpec[] = [
    {
      key: 'open',
      label: 'Open',
      value: openMine.length,
      sub: copy.openSub,
      onClick: () => setDrill({ title: 'Open', tasks: openMine, rightSlot: 'due' }),
    },
    {
      key: 'done',
      label: 'Done',
      value: doneMine.length,
      sub: copy.doneSub,
      onClick: () => setDrill({ title: 'Done', tasks: doneMine, rightSlot: 'completed' }),
    },
    {
      key: 'led',
      label: 'Led',
      value: openLed.length,
      sub: copy.ledSub,
      onClick: () => setDrill({ title: copy.ledTitle, tasks: openLed, rightSlot: 'due' }),
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: overdue.length,
      sub: copy.overdueSub,
      tone: overdue.length > 0 ? 'danger' : 'default',
      onClick: () => setDrill({ title: 'Overdue', tasks: overdue, rightSlot: 'due' }),
    },
    {
      key: 'pending',
      label: 'Pending actions',
      value: reviewQueue.length + actionable.length,
      sub: copy.pendingSub,
      // Amber only when something is actually waiting — an amber 0 next to a
      // neutral 0 overdue reads as "attention needed" when nothing is.
      tone: reviewQueue.length + actionable.length > 0 ? 'warn' : 'default',
      onClick: revealPending,
    },
  ]

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-fg-subtle">{heading.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">{heading.title}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong bg-fill-2 text-brand accent-brand"
            />
            Show completed
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={showSubmitted}
              onChange={(e) => setShowSubmitted(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong bg-fill-2 text-brand accent-brand"
            />
            Show submitted
          </label>
        </div>
      </div>

      <StatTiles tiles={tiles} />

      {/* items-start (plus lg:self-start on the aside) is load-bearing: a
          stretched grid item is exactly as tall as its content, so there is
          nothing for position:sticky to travel inside and it silently does
          nothing. Below lg this is one column in DOM order — tiles, then the
          lists, then the charts. Concrete work first is the whole point. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-8">
          {/* The ref is the scroll target for the "Pending actions" tile. */}
          <PendingActionsSection
            ref={pendingRef}
            reviewQueue={reviewQueue}
            actionable={actionable}
            description={copy.pendingDescription}
            reviewHeading={copy.reviewHeading}
            projectsHeading={copy.projectsHeading}
            emptyLabel={copy.pendingEmpty}
            loading={reviewLoading || actionableLoading}
            error={reviewError}
            open={pendingOpen}
            onOpenChange={setPendingOpen}
          />

          <TaskListSection
            title={copy.assignedTitle}
            // Counts the rows this section RENDERS, not just the open ones:
            // with "Show completed" on, the list grows, so a pill fixed to the
            // open count would sit reading 4 above 13 rows.
            count={showCompleted ? filteredMine.length : openMine.length}
            grouped={groupedMine}
            loading={myLoading}
            error={myError}
            open={mineOpen}
            onOpenChange={setMineOpen}
            emptyState={
              <>
                <h3 className="text-base font-medium text-fg">
                  {myTasks.length === 0 ? copy.assignedEmptyNothing : copy.assignedEmptyCaught}
                </h3>
                <p className="mt-2 text-sm text-fg-subtle">
                  {myTasks.length === 0
                    ? copy.assignedEmptyHint
                    : !showSubmitted && visibleMine.length < myTasks.length
                      ? copy.assignedEmptyHidden
                      : copy.assignedEmptyToggle}
                </p>
              </>
            }
          />

          {(ledLoading || ledTasks.length > 0) && (
            <TaskListSection
              title={copy.ledTitle}
              description={copy.ledDescription}
              count={showCompleted ? filteredLed.length : openLed.length}
              grouped={groupedLed}
              loading={ledLoading}
              error={ledError}
              showSubtaskProgress
              open={ledOpen}
              onOpenChange={setLedOpen}
              emptyState={
                <p className="text-sm text-fg-subtle">{copy.ledEmpty}</p>
              }
            />
          )}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto scrollbar-themed">
          {allTasks.length > 0 && (
            <MyTasksCharts
              allTasks={allTasks}
              myTasks={myTasks}
              statusTitle={copy.statusTitle}
              statusSubtitle={showCompleted ? copy.statusSubtitleAll : copy.statusSubtitleOpen}
              includeCompleted={showCompleted}
              onSelect={setDrill}
            />
          )}
        </aside>
      </div>

      {/* Flag-gated as a whole section: with time tracking off there is nothing
          to log against, so a personal timesheet is just noise on this page.
          Nothing is lost — the entries stay in Firestore and remain visible on
          each task's detail (which keeps showing logged time regardless of the
          flag) and on /admin/time, so re-enabling brings this straight back. */}
      {timeTrackingOn && timeUid && <MyTimeSection uid={timeUid} />}

      <TaskDrillDownPanel drill={drill} onClose={closeDrill} liveById={liveById} />
    </>
  )
}
