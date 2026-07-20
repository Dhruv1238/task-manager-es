import type { Timestamp } from 'firebase/firestore'
import type { Project } from '../../types/models'
import { isProjectClosed } from '../../lib/projectStatus'

// `hasTime` → the value is a real local instant; show date + time. Otherwise it's
// a date-only value stored at UTC midnight — format in UTC so it doesn't drift a
// day for users west of UTC.
export function formatDeadline(ts: Timestamp | undefined, hasTime = false): string {
  if (!ts) return 'No deadline'
  const d = ts.toDate()
  return hasTime
    ? d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
}

export function submissionDeadline(project: Project) {
  return project.submissionDate ?? project.deadline
}

// The list "deadline" is submissionDate ?? deadline; only submissionDate can
// carry a time. So hasTime applies only when the shown value IS the submission date.
export function deadlineHasTime(project: Project): boolean {
  return !!project.submissionHasTime && project.submissionDate != null
}

// The submission deadline only gates projects still working toward submission.
// Once submitted (deadline met), awarded, or otherwise closed, the date is moot.
// Single source of truth for both overdue flags and at-risk filtering.
export function submissionGateOpen(project: Project): boolean {
  return (
    !isProjectClosed(project.status) &&
    project.status !== 'awarded' &&
    project.status !== 'submitted'
  )
}

export function isOverdue(project: Project): boolean {
  const ts = submissionDeadline(project)
  if (!ts) return false
  if (!submissionGateOpen(project)) return false
  return ts.toDate().getTime() < Date.now()
}
