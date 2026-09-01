import type { TaskPriority, TaskStatus } from '../../types/models'

// Chart colors reference CSS custom properties so they automatically switch
// with the active theme. Recharts forwards these strings directly to SVG
// fill/stroke attributes, where the browser resolves them at render time.
export const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: 'var(--color-neutral-dot)',
  in_progress: 'var(--color-info-dot)',
  in_review: 'var(--color-brandtone-dot)',
  done: 'var(--color-success-dot)',
  blocked: 'var(--color-danger-dot)',
  // Tech-set statuses — tones match the pill/dot classes in TASK_STATUS_META.
  dev_done: 'var(--color-mint-dot)',
  in_uat: 'var(--color-yellow-dot)',
  ready_for_prod: 'var(--color-orange-dot)',
  cancelled: 'var(--color-pink-dot)',
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
  dev_done: 'Dev Done',
  in_uat: 'In UAT',
  ready_for_prod: 'Ready for Prod',
  cancelled: 'Cancelled',
}

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: 'var(--color-neutral-dot)',
  medium: 'var(--color-warn-dot)',
  high: 'var(--color-danger-dot)',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-elevated)',
  border: '1px solid var(--color-line)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  color: 'var(--color-fg-strong)',
} as const

export const ITEM_STYLE = {
  color: 'var(--color-fg-muted)',
} as const

export const LABEL_STYLE = {
  color: 'var(--color-fg-strong)',
  fontWeight: 500,
  marginBottom: 4,
} as const

export const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--color-fg-subtle)',
} as const

export const GRID_COLOR = 'var(--color-line-subtle)'
