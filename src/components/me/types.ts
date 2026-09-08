import type { ReactNode } from 'react'
import type { Task } from '../../types/models'

/**
 * Shared contract for the My Tasks surface (/me and /admin/member-tasks).
 *
 * A DrillDown is ONE clicked data point — a stat tile, a donut slice, a bar, a
 * line point — carrying the exact Task array the number was computed from.
 * Same doctrine as TimeEntriesPanel / ActiveUsersPanel: the detail list is
 * never re-derived or re-queried, so it can't disagree with the number that
 * was clicked.
 */
export interface DrillDown {
  /** Bucket name, e.g. "In Progress" or "Overdue". Used as the panel title. */
  title: string
  subtitle?: string
  /** The bucket's own array — pass it through, never rebuild it. */
  tasks: Task[]
  /** What each row shows in its right slot. Defaults to 'due'. */
  rightSlot?: 'due' | 'completed' | 'priority'
}

export type OnDrillDown = (d: DrillDown) => void

/** Page-supplied heading, so /me and the admin view differ only in words. */
export interface MyTasksHeading {
  eyebrow: string
  title: ReactNode
}
