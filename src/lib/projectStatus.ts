import type { ProjectStatus } from '../types/models'

// Visual + label tokens for the project status pill. Aligned with v1's chartTheme:
// muted slate for the implicit/in-progress state, blue for submitted (in-flight),
// emerald for awarded (positive terminal), red for lost (negative terminal),
// amber for on_hold, neutral for not_submitted (declined to send).
export const STATUS_DISPLAY: Record<
  ProjectStatus,
  { label: string; pill: string; dot: string; description: string }
> = {
  in_progress: {
    label: 'In progress',
    pill: 'border-white/15 bg-white/5 text-white/75',
    dot: 'bg-white/50',
    description: 'No outcome recorded yet — work is ongoing.',
  },
  submitted: {
    label: 'Submitted',
    pill: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
    dot: 'bg-blue-400',
    description: 'Pitch sent to client — awaiting their decision.',
  },
  not_submitted: {
    label: 'Not submitted',
    pill: 'border-white/20 bg-white/4 text-white/60',
    dot: 'bg-white/40',
    description: 'We chose not to submit this tender.',
  },
  awarded: {
    label: 'Awarded',
    pill: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
    dot: 'bg-emerald-400',
    description: 'Client awarded the work to us. 🎉',
  },
  lost: {
    label: 'Lost',
    pill: 'border-red-400/40 bg-red-500/15 text-red-200',
    dot: 'bg-red-400',
    description: 'Client did not award us the work.',
  },
  on_hold: {
    label: 'On hold',
    pill: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
    dot: 'bg-amber-400',
    description: 'Paused — waiting on the client or an internal blocker.',
  },
}

export const STATUS_OPTIONS: ProjectStatus[] = [
  'in_progress',
  'submitted',
  'on_hold',
  'awarded',
  'lost',
  'not_submitted',
]

// Conclusive outcomes that lock the project for editing.
export function isProjectClosed(status: ProjectStatus | undefined): boolean {
  return status === 'awarded' || status === 'lost' || status === 'not_submitted'
}

// "Live" projects are anything that isn't a final outcome — used to filter
// at-risk lists, dashboards, etc.
export function isProjectLive(status: ProjectStatus | undefined): boolean {
  return !isProjectClosed(status)
}
