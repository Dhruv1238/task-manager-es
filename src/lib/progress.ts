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