import type { Project } from '../../types/models'
import type { Stage } from '../../types/workflow'
import { useProjectWorkflow } from '../../contexts/AppConfigContext'
import { stageTone } from '../workflow/stageStyle'

// Compact stage pill for project list rows. Reads the *project's* pinned
// workflow snapshot (or falls back to live workflow for legacy projects) so
// multi-workflow tenants see stages labelled in their own workflow's
// vocabulary. After Phase 2c snapshot-pin migration, this is always the
// snapshot — workflow edits never alter labels on in-flight projects.
export default function StagePill({ project }: { project: Project }) {
  const workflow = useProjectWorkflow(project)

  if (!workflow) {
    // Workflow not loaded yet (lazy fetch in flight) — render nothing.
    // Returning a skeleton would mostly be visual noise in dense list rows.
    return null
  }

  const stage: Stage | undefined =
    (project.currentStageId
      ? workflow.stages.find((s) => s.id === project.currentStageId)
      : undefined) ??
    [...workflow.stages].sort((a, b) => a.order - b.order)[0]
  if (!stage) return null

  const tone = stageTone(stage.order, stage.isTerminal)
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={stage.displayName}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {stage.displayName}
    </span>
  )
}
