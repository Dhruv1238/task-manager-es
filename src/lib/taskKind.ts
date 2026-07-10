import type { Task, TaskKind } from '../types/models'

// Single source of truth for the Epic → Story → Task → Subtask hierarchy.
// Everything is still a `tasks` doc; `kind` is just the tier. Legacy docs
// predate the field, so always read it through effectiveKind().

export const KIND_ORDER: TaskKind[] = ['epic', 'story', 'task', 'subtask']

// Legacy rule (no migration): a doc with no `kind` is a top-level 'task', or a
// 'subtask' if it already has a parent. Keeps old data internally consistent —
// old parents read as 'task', their children as 'subtask'.
export function effectiveKind(t: Pick<Task, 'kind' | 'parentTaskId'>): TaskKind {
  return t.kind ?? (t.parentTaskId ? 'subtask' : 'task')
}

// The tier one level down, or null for a leaf (subtask). Child kind is always
// derived from the parent, never chosen — that's what caps the tree at 4 levels
// and prevents mixed task+subtask children under one parent.
export function childKind(kind: TaskKind): TaskKind | null {
  const i = KIND_ORDER.indexOf(kind)
  if (i < 0 || i >= KIND_ORDER.length - 1) return null
  return KIND_ORDER[i + 1]
}

export function canHaveChildren(kind: TaskKind): boolean {
  return childKind(kind) !== null
}

// Section header on the parent's detail view for its children.
export function childSectionLabel(kind: TaskKind): string {
  switch (childKind(kind)) {
    case 'story':
      return 'Stories'
    case 'task':
      return 'Tasks'
    case 'subtask':
      return 'Subtasks'
    default:
      return 'Subtasks'
  }
}

// "Add story" / "Add task" / "Add subtask" for the create CTA.
export function addChildLabel(kind: TaskKind): string {
  const child = childKind(kind)
  return child ? `Add ${child}` : 'Add subtask'
}

// Pill styling, mirroring the tone tokens already used for status/priority
// pills in TaskDetailContent/TaskCard.
export const KIND_STYLES: Record<TaskKind, { label: string; cls: string }> = {
  epic: { label: 'Epic', cls: 'border-brand-edge bg-brand-soft text-brand' },
  story: { label: 'Story', cls: 'border-tone-info-bd bg-tone-info-bg text-tone-info-fg' },
  task: { label: 'Task', cls: 'border-line bg-fill-2 text-fg-muted' },
  subtask: { label: 'Subtask', cls: 'border-line bg-fill-2 text-fg-subtle' },
}
