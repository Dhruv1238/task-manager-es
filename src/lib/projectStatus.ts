import type { ProjectStatus } from '../types/models'
import type { PillColor, Workflow, WorkflowStatusOption } from '../types/workflow'
import { pillClassFor, dotClassFor } from './fieldTokens'

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

// Phase 2d: PillColor for each canonical status — the inverse of STATUS_DISPLAY's
// `pill-*` strings. Used to seed author-configurable statusOptions (and the
// StatusOptionsEditor's defaults) so the migration preserves today's colours.
export const STATUS_COLOR: Record<ProjectStatus, PillColor> = {
  in_progress: 'brandtone',
  submitted: 'info',
  not_submitted: 'neutral',
  awarded: 'success',
  completed: 'mint',
  lost: 'danger',
  on_hold: 'warn',
  archived: 'neutral',
}

// Build default WorkflowStatusOption[] for a flow from the canonical set. Seeds
// and the StatusOptionsEditor share this so author statuses start from today's
// labels/colours and reuse the legacy ids (keeping isProjectClosed valid).
export function defaultStatusOptions(
  statuses: ProjectStatus[] = STATUS_OPTIONS,
): WorkflowStatusOption[] {
  return statuses.map((id, i) => ({
    id,
    label: STATUS_DISPLAY[id].label,
    color: STATUS_COLOR[id],
    order: i,
    closing: isProjectClosed(id),
  }))
}

// Conclusive outcomes that lock the project for editing. 'awarded' is excluded
// because delivery work continues after the award until status flips to 'completed'.
// Phase 2d: param widened to string for author-configured status ids; the
// canonical closing set is unchanged (author statuses are non-closing unless
// they reuse a legacy closing id — see resolveStatusDisplay for the override).
export function isProjectClosed(status: ProjectStatus | string | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'lost' ||
    status === 'not_submitted' ||
    status === 'archived'
  )
}

// "Live" projects are anything that isn't a final outcome — used to filter
// at-risk lists, dashboards, etc.
export function isProjectLive(status: ProjectStatus | string | undefined): boolean {
  return !isProjectClosed(status)
}

// Phase 2d: resolve the display tokens for a project status. Prefers the pinned
// workflow's author-configured statusOptions (label + palette colour); falls
// back to the hardcoded STATUS_DISPLAY for the canonical set; finally a neutral
// default so an unknown id never crashes the pill. THE safe accessor — never
// index STATUS_DISPLAY[status] directly once statuses can be arbitrary strings.
export interface StatusDisplayMeta {
  label: string
  pill: string
  dot: string
  description: string
}

export function resolveStatusDisplay(
  status: ProjectStatus | string | undefined,
  workflow?: Workflow | null,
): StatusDisplayMeta {
  if (status) {
    const opt = workflow?.statusOptions?.find((o) => o.id === status)
    if (opt) {
      return {
        label: opt.label,
        pill: pillClassFor(opt.color),
        dot: dotClassFor(opt.color),
        // Preserve the canonical helper copy when the author kept a legacy id;
        // author-added custom statuses simply have no description.
        description: STATUS_DISPLAY[status as ProjectStatus]?.description ?? '',
      }
    }
    const meta = STATUS_DISPLAY[status as ProjectStatus]
    if (meta) return meta
  }
  return {
    label: status ? String(status) : '—',
    pill: 'pill-neutral border',
    dot: 'bg-neutral-dot',
    description: '',
  }
}
