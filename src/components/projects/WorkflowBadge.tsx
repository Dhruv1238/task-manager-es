import type { Workflow } from '../../types/workflow'

// Compact pill displaying a workflow's displayName with a flowType-derived
// tone. Mirrors StagePill's shape so the two can sit side-by-side on a row
// without one dominating the other. Used by the projects table, /me inbox,
// project header — anywhere a project's workflow needs a glanceable label.

const TONE: Record<Workflow['flowType'] | 'unknown', { pill: string; dot: string }> = {
  // Collab tenants live in this palette already (stage pills cycle through
  // the same warm/cool tones); the cool variant gives the workflow badge
  // its own visual lane without clashing.
  collaborative: { pill: 'pill-info border', dot: 'bg-info-dot' },
  individual: { pill: 'pill-brandtone border', dot: 'bg-brandtone-dot' },
  basic: { pill: 'pill-neutral border', dot: 'bg-fg-subtle' },
  unknown: { pill: 'pill-neutral border', dot: 'bg-fg-subtle' },
}

interface Props {
  workflow: Workflow | null
  // Optional compact mode hides the leading dot — used in tight rows where
  // the badge sits adjacent to a status pill that already provides colour.
  compact?: boolean
}

export default function WorkflowBadge({ workflow, compact = false }: Props) {
  if (!workflow) return null
  const tone = TONE[workflow.flowType] ?? TONE.unknown
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={`Workflow: ${workflow.displayName}`}
    >
      {!compact && <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />}
      {workflow.displayName}
    </span>
  )
}
