import type { Task } from '../types/models'

// Progress for a single team-level task (0..1). If it has subtasks, use the
// denormalized rollup. Otherwise fall back to a binary "done?" check.
export function taskProgress(task: Task): number {
  const count = task.subtaskCount ?? 0
  if (count > 0) {
    return Math.min(1, (task.subtaskDoneCount ?? 0) / count)
  }
  return task.status === 'done' ? 1 : 0
}

// Average progress across a set of team-level tasks. 0 when the list is empty.
export function aggregateProgress(tasks: Task[]): number {
  if (tasks.length === 0) return 0
  const sum = tasks.reduce((acc, t) => acc + taskProgress(t), 0)
  return sum / tasks.length
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

// Recursive progress: a node with loaded children averages their deep progress;
// a leaf falls back to its per-edge counter (children not loaded) or binary
// done. Cycle-guarded and depth-capped so a malformed graph can't loop.
export function deepTaskProgress(
  task: Task,
  index: Map<string, Task[]>,
  visited: Set<string> = new Set(),
  depth = 0,
): number {
  const children = index.get(task.id)
  if (!children || children.length === 0 || visited.has(task.id) || depth >= 4) {
    return taskProgress(task)
  }
  visited.add(task.id)
  const sum = children.reduce(
    (acc, c) => acc + deepTaskProgress(c, index, visited, depth + 1),
    0,
  )
  return sum / children.length
}

// Mean deep progress across a set of root tasks. 0 when empty.
export function aggregateDeepProgress(roots: Task[], index: Map<string, Task[]>): number {
  if (roots.length === 0) return 0
  const sum = roots.reduce((acc, t) => acc + deepTaskProgress(t, index), 0)
  return sum / roots.length
}