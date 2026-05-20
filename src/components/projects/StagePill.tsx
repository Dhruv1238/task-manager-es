import type { Project } from '../../types/models'
import { useActiveWorkflow } from '../../contexts/AppConfigContext'
import { stageTone } from '../workflow/stageStyle'

// Compact stage pill for project list rows. Reads the active workflow doc to
// resolve the display name. Falls back to a numeric label for legacy projects
// whose currentStageId hasn't been backfilled yet.
export default function StagePill({ project }: { project: Project }) {
  const { workflow } = useActiveWorkflow()

  if (!workflow) {
    return null
  }

  const stage =
    (project.currentStageId
      ? workflow.stages.find((s) => s.id === project.currentStageId)
      : null) ??
    [...workflow.stages].sort((a, b) => a.order - b.order)[0]
  if (!stage) return null

  const tone = stageTone(stage.order, stage.isTerminal)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={stage.displayName}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {stage.displayName}
    </span>
  )
}
