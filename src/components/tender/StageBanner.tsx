import { useState } from 'react'
import type { Project, Stage } from '../../types/models'
import { STAGE_HEADLINE } from '../../types/models'
import { usePermissions } from '../../hooks/usePermissions'
import { isProjectClosed } from '../../lib/projectStatus'
import { STAGE_TONE, displayedPhase } from './stageStyle'
import AllocateVhModal from './AllocateVhModal'
import EscalateBackModal from './EscalateBackModal'
import AcceptProjectModal from './AcceptProjectModal'
import EligibilityReviewModal from './EligibilityReviewModal'
import StageHistorySidePanel from './StageHistorySidePanel'
import SignOffValidationModal from './SignOffValidationModal'
import VhReviewModal from './VhReviewModal'
import UpdateProjectStatusModal from './UpdateProjectStatusModal'

interface Props {
  project: Project
}

// Banner pinned to the top of every project page. Reads the project's stage and
// renders stage-aware action buttons gated by role/stage flags from usePermissions.
// Buttons render-only-when-allowed; no greyed-out states.
export default function StageBanner({ project }: Props) {
  const stage = (project.stage ?? 1) as Stage
  const phase = displayedPhase(project)
  const tone = STAGE_TONE[phase.toneStage] ?? STAGE_TONE[1]

  const perms = usePermissions(project.id)

  const [allocateOpen, setAllocateOpen] = useState(false)
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [signOffOpen, setSignOffOpen] = useState(false)
  const [vhDecision, setVhDecision] = useState<'approve' | 'reject' | null>(null)
  const [eligibilityDecision, setEligibilityDecision] = useState<'approve' | 'reject' | null>(null)
  const [statusUpdateOpen, setStatusUpdateOpen] = useState(false)

  const iterations = project.vhIterationCount ?? 0

  // Compose primary CTAs for the banner. Each button is present only when the
  // permission check passes and the current stage matches.
  const actionButtons: React.ReactNode[] = []

  if (perms.canAllocateVh) {
    actionButtons.push(
      <button
        key="allocate"
        type="button"
        onClick={() => setAllocateOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient"
      >
        Allocate to VH
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>,
    )
  }

  if (perms.canAcceptOrEscalate) {
    actionButtons.push(
      <button
        key="accept"
        type="button"
        onClick={() => setAcceptOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-success-bd bg-tone-success-bg px-4 py-2 text-sm font-medium text-tone-success-fg transition hover:opacity-90"
      >
        Accept
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>,
      <button
        key="escalate"
        type="button"
        onClick={() => setEscalateOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-2 text-sm font-medium text-tone-danger-fg transition hover:opacity-90"
      >
        Escalate Back
      </button>,
    )
  }

  if (perms.canReviewEligibility) {
    actionButtons.push(
      <button
        key="eligibility-approve"
        type="button"
        onClick={() => setEligibilityDecision('approve')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-success-bd bg-tone-success-bg px-4 py-2 text-sm font-medium text-tone-success-fg transition hover:opacity-90"
      >
        Approve & continue
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>,
      <button
        key="eligibility-reject"
        type="button"
        onClick={() => setEligibilityDecision('reject')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-2 text-sm font-medium text-tone-danger-fg transition hover:opacity-90"
      >
        Reject — close tender
      </button>,
    )
  }

  if (perms.canAddFanoutTask) {
    // Stage 6 is transient — execution begins automatically when the first task is
    // added. Show a quiet hint so the VH knows what's expected, no CTA button.
    actionButtons.push(
      <span
        key="add-tasks-hint"
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm text-fg-subtle"
      >
        Use “+ New Task” to assign work to teams.
      </span>,
    )
  }

  if (perms.canSignOffValidation) {
    actionButtons.push(
      <button
        key="signoff"
        type="button"
        onClick={() => setSignOffOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient"
      >
        Validation complete — sign off
      </button>,
    )
  }

  if (perms.canApproveOrReject) {
    actionButtons.push(
      <button
        key="vh-approve"
        type="button"
        onClick={() => setVhDecision('approve')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-success-bd bg-tone-success-bg px-4 py-2 text-sm font-medium text-tone-success-fg transition hover:opacity-90"
      >
        Approve
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>,
      <button
        key="vh-reject"
        type="button"
        onClick={() => setVhDecision('reject')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-2 text-sm font-medium text-tone-danger-fg transition hover:opacity-90"
      >
        Reject — Send Back
      </button>,
    )
  }

  if (perms.canMarkDelivered) {
    actionButtons.push(
      <button
        key="update-status"
        type="button"
        onClick={() => setStatusUpdateOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-tone-success-bd bg-tone-success-bg px-4 py-2 text-sm font-medium text-tone-success-fg transition hover:opacity-90"
      >
        Update status
      </button>,
    )
  }

  // Project considered closed once the outcome is conclusive (completed/lost/not_submitted).
  // 'awarded' is intentionally excluded — delivery work continues until 'completed'.
  const closedTone = isProjectClosed(project.status)
  const headline = closedTone
    ? `Closed — ${project.status?.replace('_', ' ')}`
    : STAGE_HEADLINE[stage]

  return (
    <div
      className={`mb-6 rounded-2xl border ${tone.ring} bg-fill-1 p-5`}
      role="status"
      aria-label={`Project phase: ${phase.label}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
              {phase.label}
            </span>
            {/* Iteration badge stays — it reflects the *current* iteration in
                flight, which is actionable context. The escalation counter is
                an audit fact only — it lives in Project history, not the banner. */}
            {iterations > 0 && (
              <span className="inline-flex items-center rounded-full border border-tone-accent-bd bg-tone-accent-bg px-2 py-0.5 text-[11px] font-medium text-tone-accent-fg">
                Iteration {iterations + 1}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            {phase.isEscalated ? phase.hint : headline}
          </p>
          {!closedTone && !phase.isEscalated && actionButtons.length === 0 && (
            <p className="mt-1 text-xs text-fg-subtle">{phase.hint}</p>
          )}
          {stage === 5 && project.eligibilityNote && (
            <blockquote className="mt-3 rounded-lg border-l-2 border-tone-cool-bd bg-tone-cool-bg px-3 py-2 text-sm text-fg-muted">
              <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
                VH's assessment
              </span>
              <span className="mt-1 block">{project.eligibilityNote}</span>
            </blockquote>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actionButtons}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Project history
          </button>
        </div>
      </div>

      <AllocateVhModal
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        project={project}
      />
      <EscalateBackModal
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        project={project}
      />
      <AcceptProjectModal
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        project={project}
      />
      <EligibilityReviewModal
        open={eligibilityDecision !== null}
        decision={eligibilityDecision ?? 'approve'}
        onClose={() => setEligibilityDecision(null)}
        project={project}
      />
      <SignOffValidationModal
        open={signOffOpen}
        onClose={() => setSignOffOpen(false)}
        project={project}
      />
      <VhReviewModal
        open={vhDecision !== null}
        decision={vhDecision ?? 'approve'}
        onClose={() => setVhDecision(null)}
        project={project}
      />
      <UpdateProjectStatusModal
        open={statusUpdateOpen}
        onClose={() => setStatusUpdateOpen(false)}
        project={project}
      />
      <StageHistorySidePanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        project={project}
      />
    </div>
  )
}
