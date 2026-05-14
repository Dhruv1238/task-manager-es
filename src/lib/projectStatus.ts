import type { ProjectStatus } from '../types/models'

// Visual + label tokens for the project status pill. Uses the semantic pill
// utilities (pill-info, pill-success, etc.) so each tone resolves correctly
// in both themes: muted neutral for the implicit/in-progress state, blue for
// submitted (in-flight), emerald for awarded (won the pitch — work begins),
// teal for completed (delivery wrapped — terminal positive), red for lost
// (negative terminal), amber for on_hold, neutral for not_submitted.
export const STATUS_DISPLAY: Record<
  ProjectStatus,
  { label: string; pill: string; dot: string; description: string }
> = {
  in_progress: {
    label: 'In progress',
    pill: 'pill-brandtone border',
    dot: 'bg-brandtone-dot',
    description: 'No outcome recorded yet — work is ongoing.',
  },
  submitted: {
    label: 'Submitted',
    pill: 'pill-info border',
    dot: 'bg-info-dot',
    description: 'Pitch sent to client — awaiting their decision.',
  },
  not_submitted: {
    label: 'Not submitted',
    pill: 'pill-neutral border',
    dot: 'bg-neutral-dot',
    description: 'We chose not to submit this tender.',
  },
  awarded: {
    label: 'Awarded',
    pill: 'pill-success border',
    dot: 'bg-success-dot',
    description: 'Client awarded the work to us — delivery in progress.',
  },
  completed: {
    label: 'Completed',
    pill: 'pill-mint border',
    dot: 'bg-mint-dot',
    description: 'Awarded work has been delivered and wrapped up.',
  },
  lost: {
    label: 'Lost',
    pill: 'pill-danger border',
    dot: 'bg-danger-dot',
    description: 'Client did not award us the work.',
  },
  on_hold: {
    label: 'On hold',
    pill: 'pill-warn border',
    dot: 'bg-warn-dot',
    description: 'Paused — waiting on the client or an internal blocker.',
  },
  archived: {
    label: 'Archived',
    pill: 'pill-neutral border',
    dot: 'bg-neutral-dot',
    description: 'Filed away — no further action expected.',
  },
}

export const STATUS_OPTIONS: ProjectStatus[] = [
  'in_progress',
  'submitted',
  'on_hold',
  'awarded',
  'completed',
  'lost',
  'not_submitted',
  'archived',
]

// Reduced option set used when the tender pipeline is disabled (Client B / simple
// Jira mode). The status pill on a project should only flip between these three.
export const SIMPLE_STATUS_OPTIONS: ProjectStatus[] = ['in_progress', 'completed', 'archived']

// Conclusive outcomes that lock the project for editing. 'awarded' is excluded
// because delivery work continues after the award until status flips to 'completed'.
export function isProjectClosed(status: ProjectStatus | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'lost' ||
    status === 'not_submitted' ||
    status === 'archived'
  )
}

// "Live" projects are anything that isn't a final outcome — used to filter
// at-risk lists, dashboards, etc.
export function isProjectLive(status: ProjectStatus | undefined): boolean {
  return !isProjectClosed(status)
}
