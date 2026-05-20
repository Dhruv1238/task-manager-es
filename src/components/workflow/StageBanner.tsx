import { useMemo, useState } from 'react'
import type { Project } from '../../types/models'
import { usePermissions } from '../../hooks/usePermissions'
import {
  useOrgStructure,
  useProjectWorkflow,
} from '../../contexts/AppConfigContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import { isProjectClosed } from '../../lib/projectStatus'
import {
  getCurrentStage,
  renderStageHeadline,
} from '../../lib/workflowEvaluator'
import type { StageAction } from '../../types/workflow'
import { stageTone } from './stageStyle'
import ActionModal from './ActionModal'
import ProjectHistorySidePanel from './ProjectHistorySidePanel'
import UpdateProjectStatusModal from './UpdateProjectStatusModal'

interface Props {
  project: Project
}

// Generic stage banner. Reads the workflow doc + project state + viewer perms,
// renders one button per allowed action. No knowledge of specific action ids
// or stage names — everything comes from /workflows/{id}.
//
// Phase 2b: reads the project's pinned workflow (not "the active one"); the
// banner renders consistently regardless of which workflow the tenant pinned
// at creation. Basic-flow projects have a single-stage banner that just shows
// "Mark complete"; the banner doesn't pretend stages exist when they don't.
export default function StageBanner({ project }: Props) {
  const workflow = useProjectWorkflow(project)
  const org = useOrgStructure()
  const { teams } = useAllTeams()
  const perms = usePermissions(project.id)
  const [openAction, setOpenAction] = useState<StageAction | null>(null)
  // Separate state for set_status actions — these route to the rich
  // UpdateProjectStatusModal instead of the generic ActionModal so the
  // operator gets the card-based status picker.
  const [statusAction, setStatusAction] = useState<StageAction | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const stage = useMemo(() => {
    if (!workflow) return null
    return getCurrentStage(project, workflow)
  }, [project, workflow])

  const headline = useMemo(() => {
    if (!workflow || !stage) return { headline: '', hint: undefined as string | undefined }
    return renderStageHeadline(stage, project, workflow, org, teams)
  }, [stage, project, workflow, org, teams])

  if (!workflow || !stage) {
    return (
      <div
        className="mb-6 rounded-2xl border border-line bg-fill-1 p-5"
        role="status"
        aria-label="Loading workflow"
      >
        <p className="text-sm text-fg-subtle">Loading workflow…</p>
      </div>
    )
  }

  const closed = isProjectClosed(project.status)
  const tone = stageTone(stage.order)
  const iterations = project.iterationCount ?? 0

  // One button per allowed action. canPerform short-circuits to false when
  // closed, so terminal stages emit no buttons.
  const allowedActions = closed
    ? []
    : stage.actions.filter((a) => perms.canPerform(a.id))

  const closedHeadline = closed
    ? `Closed — ${(project.status ?? '').replace(/_/g, ' ')}`
    : headline.headline

  // Ad-hoc status changes happen via the clickable pill on ProjectDetail —
  // not via a always-visible button on the banner. The only status-update
  // affordance the banner exposes is the workflow's set_status action (e.g.
  // `record_outcome` at delivered), and that's rendered through the same
  // action-button loop as every other action.

  function handleActionClick(action: StageAction) {
    if (action.effect.kind === 'set_status') {
      setStatusAction(action)
    } else {
      setOpenAction(action)
    }
  }

  return (
    <div
      className={`mb-6 rounded-2xl border ${tone.ring} bg-fill-1 p-5`}
      role="status"
      aria-label={`Project stage: ${stage.displayName}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
              {stage.displayName}
            </span>
            {iterations > 0 && (
              <span className="inline-flex items-center rounded-full border border-tone-accent-bd bg-tone-accent-bg px-2 py-0.5 text-[11px] font-medium text-tone-accent-fg">
                Iteration {iterations + 1}
              </span>
            )}
            {(project.escalationCount ?? 0) > 0 && (
              <span className="inline-flex items-center rounded-full border border-tone-warn-bd bg-tone-warn-bg px-2 py-0.5 text-[11px] font-medium text-tone-warn-fg">
                Escalated × {project.escalationCount}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-fg-muted">{closedHeadline}</p>
          {!closed && headline.hint && (
            <p className="mt-1 text-xs text-fg-subtle">{headline.hint}</p>
          )}
          {project.eligibilityNote && stage.id === 'eligibility_review' && (
            <blockquote className="mt-3 rounded-lg border-l-2 border-tone-cool-bd bg-tone-cool-bg px-3 py-2 text-sm text-fg-muted">
              <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
                Lead&rsquo;s assessment
              </span>
              <span className="mt-1 block">{project.eligibilityNote}</span>
            </blockquote>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {allowedActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => handleActionClick(action)}
              className={buttonClasses(action.intent)}
            >
              {interpolateLabel(action.label, workflow.leadRoleName || org.leadRoleName)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Project history
          </button>
        </div>
      </div>

      <ActionModal
        open={Boolean(openAction)}
        onClose={() => setOpenAction(null)}
        project={project}
        action={openAction}
      />
      <UpdateProjectStatusModal
        open={Boolean(statusAction)}
        onClose={() => setStatusAction(null)}
        project={project}
        allowedStatuses={
          statusAction?.effect.kind === 'set_status'
            ? statusAction.effect.statuses
            : undefined
        }
        titleOverride={
          statusAction
            ? interpolateLabel(
                statusAction.label,
                workflow.leadRoleName || org.leadRoleName,
              )
            : undefined
        }
        submitLabelOverride={
          statusAction
            ? interpolateLabel(
                statusAction.label,
                workflow.leadRoleName || org.leadRoleName,
              )
            : undefined
        }
      />
      <ProjectHistorySidePanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        project={project}
      />
    </div>
  )
}

function buttonClasses(intent: StageAction['intent']): string {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition'
  switch (intent) {
    case 'success':
      return `${base} border border-tone-success-bd bg-tone-success-bg text-tone-success-fg hover:opacity-90`
    case 'danger':
      return `${base} border border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg hover:opacity-90`
    case 'neutral':
      return `${base} border border-line bg-fill-2 text-fg-muted hover:bg-fill-4`
    case 'primary':
    default:
      return `${base} bg-brand-gradient text-white shadow-lg shadow-purple-900/30 hover-brand-gradient`
  }
}

function interpolateLabel(label: string, leadRoleName: string): string {
  return label.replace(/\{leadRoleName\}/g, leadRoleName)
}
