import type { Task } from '../../types/models'
import type { OnDrillDown } from './types'
import PriorityBar from '../charts/PriorityBar'
import StatusDonut from '../charts/StatusDonut'
import TasksByProjectBar from '../charts/TasksByProjectBar'
import UpcomingDeadlines from '../charts/UpcomingDeadlines'
import WeeklyCompletionLine from '../charts/WeeklyCompletionLine'

interface Props {
  /** Assigned + led, de-duplicated. Every chart but the weekly line reads this. */
  allTasks: Task[]
  /**
   * Assigned only. Weekly throughput is a measure of what THIS person finished,
   * so led tasks (which their team completed) would inflate it.
   */
  myTasks: Task[]
  /** Donut wording comes from the page — "Your status breakdown" vs a name. */
  statusTitle: string
  statusSubtitle: string
  /**
   * The "Show completed" toggle. The breakdown charts follow it so the picture
   * matches the lists beside them; a user who asks to see finished work means
   * the charts too. Deadlines and weekly throughput deliberately do NOT follow
   * it — see below.
   */
  includeCompleted: boolean
  onSelect: OnDrillDown
}

/**
 * The chart column of the My Tasks surface. Clicking any slice, bar or point
 * hands its own task array up through `onSelect`.
 *
 * The grid goes 2-up on tablets, back to 1-up at lg and 2-up again at xl:
 * between 1024 and 1280px these charts live in a half-width column, which is
 * too narrow for two plots side by side.
 */
export default function MyTasksCharts({
  allTasks,
  myTasks,
  statusTitle,
  statusSubtitle,
  includeCompleted,
  onSelect,
}: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <StatusDonut
        tasks={allTasks}
        title={statusTitle}
        subtitle={statusSubtitle}
        excludeDone={!includeCompleted}
        onSelect={onSelect}
      />
      <PriorityBar
        tasks={allTasks}
        title="Priority mix"
        subtitle={includeCompleted ? 'All tasks by priority' : 'Open tasks by priority'}
        excludeDone={!includeCompleted}
        onSelect={onSelect}
      />
      <TasksByProjectBar tasks={allTasks} includeCompleted={includeCompleted} onSelect={onSelect} />
      {/* These two stay put. A finished task has no upcoming deadline, and the
          weekly line already plots nothing BUT completions, so following the
          toggle would make one list wrong and the other a no-op. */}
      {/* No onSelect: this card already lists its own tasks as rows. */}
      <UpcomingDeadlines tasks={allTasks} />
      <WeeklyCompletionLine tasks={myTasks} onSelect={onSelect} />
    </div>
  )
}
