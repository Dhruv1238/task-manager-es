import type { ReactNode } from 'react'
import type { Timestamp } from 'firebase/firestore'
import type { DrillDown } from '../me/types'
import type { Task, TaskPriority } from '../../types/models'
import { isOverdueTask } from '../../lib/myTasksDerive'
import TaskListRow from '../tasks/TaskListRow'
import Modal from '../ui/Modal'

interface Props {
  drill: DrillDown | null
  onClose: () => void
  /**
   * Latest snapshot of the tasks this page is subscribed to, by id. Optional:
   * without it the rows simply render the tasks as handed in.
   */
  liveById?: Map<string, Task>
}

// Same literal-class map as the priority column on /me (never interpolate a
// Tailwind class — see src/lib/taskStatus.ts).
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

function rightSlotFor(task: Task, kind: DrillDown['rightSlot']): ReactNode {
  if (kind === 'priority') {
    const p = PRIORITY_STYLES[task.priority]
    return <span className={`text-xs ${p?.cls ?? 'text-fg-subtle'}`}>{p?.label ?? '—'}</span>
  }
  if (kind === 'completed') {
    return <span className="text-xs text-fg-muted">{formatDate(task.completedAt)}</span>
  }
  // One definition of "overdue", shared with the Overdue tile and the
  // deadlines list, so the three can't drift apart.
  const overdue = isOverdueTask(task)
  return (
    <span className={`text-xs ${overdue ? 'text-tone-danger-fg' : 'text-fg-muted'}`}>
      {overdue ? 'Overdue · ' : ''}
      {formatDate(task.dueDate)}
    </span>
  )
}

/**
 * Drill-down behind one clicked number on the My Tasks surface: a tile, a
 * donut slice, a bar, a line point.
 *
 * The rows come from `drill.tasks` — the very array the number was counted
 * from — so the list can never disagree with the number that was clicked.
 * Nothing here re-filters or re-derives membership; same doctrine as
 * TimeEntriesPanel.
 */
export default function TaskDrillDownPanel({ drill, onClose, liveById }: Props) {
  if (!drill) return null

  // Sort a COPY: `drill.tasks` belongs to the caller's memo, and sorting in
  // place would silently reorder the bucket the chart is drawn from. Ordering
  // is fixed on the clicked snapshot, so a live due-date edit doesn't make
  // rows jump around underneath the reader.
  const rows = [...drill.tasks].sort((a, b) => {
    const ax = a.dueDate?.toDate().getTime()
    const bx = b.dueDate?.toDate().getTime()
    if (ax === undefined) return bx === undefined ? 0 : 1
    if (bx === undefined) return -1
    return ax - bx
  })

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${drill.title} · ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}`}
      description={drill.subtitle}
    >
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-fg-subtle">
          Nothing in this bucket.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((snapshot) => {
            // The SET of rows is the snapshot that was clicked; each ROW is
            // rendered from the live doc when we have it, so a status changed
            // in the task modal stacked on top shows immediately without the
            // task dropping out of (or appearing in) the list under the reader.
            const task = liveById?.get(snapshot.id) ?? snapshot
            return (
              <TaskListRow
                key={task.id}
                task={task}
                right={rightSlotFor(task, drill.rightSlot)}
              />
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
