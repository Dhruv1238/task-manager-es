import type { Task } from '../types/models'
import { countsForProgress, isComplete } from './taskStatus'

// Cancelled children are excluded from progress denominators entirely (neither
// done nor outstanding — features.techTaskStatuses). Done and cancelled are
// disjoint, so the numerator needs no correction; legacy docs (no
// subtaskCancelledCount) reduce to the original done/count formula.
function effectiveSubtaskCount(task: Task): number {
  return (task.subtaskCount ?? 0) - (task.subtaskCancelledCount ?? 0)
}

// "3/4" style ratio for card/detail displays. Must stay in agreement with
// taskProgress below — both use the cancelled-adjusted denominator.
export function subtaskRatio(task: Task): { done: number; total: number } {
  return { done: task.subtaskDoneCount ?? 0, total: Math.max(0, effectiveSubtaskCount(task)) }
}

// Progress for a single team-level task (0..1). If it has (non-cancelled)
// subtasks, use the denormalized rollup. Otherwise fall back to a binary
// "done?" check (which also covers the all-children-cancelled case).
export function taskProgress(task: Task): number {
  const count = effectiveSubtaskCount(task)
  if (count > 0) {
    return Math.min(1, (task.subtaskDoneCount ?? 0) / count)
  }
  return isComplete(task.status) ? 1 : 0
}

// Average progress across a set of team-level tasks, cancelled tasks excluded
// from the denominator. 0 when nothing counts.
export function aggregateProgress(tasks: Task[]): number {
  const counted = tasks.filter((t) => countsForProgress(t.status))
  if (counted.length === 0) return 0
  const sum = counted.reduce((acc, t) => acc + taskProgress(t), 0)
  return sum / counted.length
}

export function formatPercent(progress: number): string {
  return `${Math.round(progress * 100)}%`
}

// ─── Deep (hierarchy-aware) progress ──────────────────────────────────────
// The per-edge subtaskCount/subtaskDoneCount counters (maintained in
// firestore.ts) only reflect a node's IMMEDIATE children — correct at any
// depth but they don't roll a grandchild's completion up to a grandparent. For
// an Epic → Story → Task → Subtask tree we compute the true rollup on the
// client, where the full project task set is already loaded (useAllProjectTasks).
// No write-path change: keeping this client-side avoids ancestor-walk reads and
// hot-doc contention on every status change.

// parentTaskId → children. Pass the full loaded task set.
export function buildChildrenIndex(tasks: Task[]): Map<string, Task[]> {
  const index = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.parentTaskId) continue
    const arr = index.get(t.parentTaskId)
    if (arr) arr.push(t)
    else index.set(t.parentTaskId, [t])
  }
  return index
}

// Recursive progress: a node with loaded children averages their deep progress
// (cancelled children excluded); a leaf falls back to its per-edge counter
// (children not loaded) or binary done. Cycle-guarded and depth-capped so a
// malformed graph can't loop.
export function deepTaskProgress(
  task: Task,
  index: Map<string, Task[]>,
  visited: Set<string> = new Set(),
  depth = 0,
): number {
  const children = (index.get(task.id) ?? []).filter((c) => countsForProgress(c.status))
  if (children.length === 0 || visited.has(task.id) || depth >= 4) {
    return taskProgress(task)
  }
  visited.add(task.id)
  const sum = children.reduce(
    (acc, c) => acc + deepTaskProgress(c, index, visited, depth + 1),
    0,
  )
  return sum / children.length
}

// Mean deep progress across a set of root tasks, cancelled roots excluded.
// 0 when nothing counts.
export function aggregateDeepProgress(roots: Task[], index: Map<string, Task[]>): number {
  const counted = roots.filter((t) => countsForProgress(t.status))
  if (counted.length === 0) return 0
  const sum = counted.reduce((acc, t) => acc + deepTaskProgress(t, index), 0)
  return sum / counted.length
}