import type { Project } from '../../types/models'
import { STAGE_TONE, displayedPhase } from '../tender/stageStyle'

export default function StagePill({ project }: { project: Project }) {
  const phase = displayedPhase(project)
  const tone = STAGE_TONE[phase.toneStage] ?? STAGE_TONE[1]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
      title={phase.label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {phase.shortLabel}
    </span>
  )
}
