import type { TaskLinkRelation } from '../types/models'

// A link is stored on BOTH tasks; the target carries the inverse relation so
// either side renders correctly. blocks↔blocked_by; relates_to and duplicates
// are their own inverse.
export const INVERSE_RELATION: Record<TaskLinkRelation, TaskLinkRelation> = {
  relates_to: 'relates_to',
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  duplicates: 'duplicates',
}

// Label shown as the relation chip on a link row (from the current task's POV).
export const RELATION_LABEL: Record<TaskLinkRelation, string> = {
  relates_to: 'Relates to',
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  duplicates: 'Duplicates',
}

// Chip styling per relation. blocked_by gets a warn tone; the rest are neutral.
export const RELATION_STYLE: Record<TaskLinkRelation, string> = {
  relates_to: 'border-line bg-fill-2 text-fg-muted',
  blocks: 'border-tone-warn-bd bg-tone-warn-bg text-tone-warn-fg',
  blocked_by: 'border-tone-warn-bd bg-tone-warn-bg text-tone-warn-fg',
  duplicates: 'border-line bg-fill-2 text-fg-muted',
}

// Options for the relation picker in the link modal.
export const RELATION_OPTIONS: { value: TaskLinkRelation; label: string }[] = [
  { value: 'relates_to', label: 'Relates to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked_by', label: 'Blocked by' },
  { value: 'duplicates', label: 'Duplicates' },
]

// Defensive: render an unknown/legacy relation as relates_to.
export function relationLabel(relation: TaskLinkRelation): string {
  return RELATION_LABEL[relation] ?? RELATION_LABEL.relates_to
}

export function relationStyle(relation: TaskLinkRelation): string {
  return RELATION_STYLE[relation] ?? RELATION_STYLE.relates_to
}
