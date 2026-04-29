import type { TaskPriority, TaskStatus } from '../../types/models'

export const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: '#94a3b8', // slate-400
  in_progress: '#60a5fa', // blue-400
  in_review: '#c084fc', // purple-400
  done: '#34d399', // emerald-400
  blocked: '#f87171', // red-400
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
}

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: '#94a3b8',
  medium: '#fbbf24', // amber-400
  high: '#f87171',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const TOOLTIP_STYLE = {
  backgroundColor: '#0e0e16',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  color: 'rgba(255, 255, 255, 0.9)',
} as const

export const ITEM_STYLE = {
  color: 'rgba(255, 255, 255, 0.8)',
} as const

export const LABEL_STYLE = {
  color: 'rgba(255, 255, 255, 0.95)',
  fontWeight: 500,
  marginBottom: 4,
} as const

export const AXIS_STYLE = {
  fontSize: 11,
  fill: 'rgba(255, 255, 255, 0.5)',
} as const

export const GRID_COLOR = 'rgba(255, 255, 255, 0.06)'