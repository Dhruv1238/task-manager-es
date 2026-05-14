import type { Timestamp } from 'firebase/firestore'
import type { Project } from '../../types/models'
import { isProjectClosed } from '../../lib/projectStatus'

export function formatDeadline(ts: Timestamp | undefined): string {
  if (!ts) return 'No deadline'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function submissionDeadline(project: Project) {
  return project.submissionDate ?? project.deadline
}

export function isOverdue(project: Project): boolean {
  const ts = submissionDeadline(project)
  if (!ts) return false
  // Skip the submission-deadline overdue flag once the tender has a final outcome,
  // and also once awarded — at that point the deadline is no longer a submission gate.
  if (isProjectClosed(project.status) || project.status === 'awarded') return false
  return ts.toDate().getTime() < Date.now()
}
