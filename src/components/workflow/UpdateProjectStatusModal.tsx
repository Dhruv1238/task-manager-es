import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectWorkflow } from '../../contexts/AppConfigContext'
import { updateProjectStatus } from '../../lib/firestore'
import {
  SIMPLE_STATUS_OPTIONS,
  STATUS_OPTIONS,
  resolveStatusDisplay,
} from '../../lib/projectStatus'
import type { Project, ProjectStatus } from '../../types/models'
import type { FlowType } from '../../types/workflow'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  // Optional: constrain the status cards to a workflow-declared subset (used
  // when the modal is opened from a `set_status` action on the banner). When
  // omitted (status-pill click on ProjectDetail), the per-flowType default set
  // is shown.
  allowedStatuses?: ProjectStatus[]
  // Override the modal title — `record_outcome` wants "Record outcome".
  titleOverride?: string
  submitLabelOverride?: string
}

// Per-flowType default status set for the status-pill-driven path. The
// `set_status` workflow action overrides this with its declared `statuses`
// array when the modal is opened from the banner instead.
const INDIVIDUAL_STATUS_OPTIONS: ProjectStatus[] = [
  'in_progress',
  'awarded',
  'lost',
  'on_hold',
  'completed',
]

function statusOptionsForFlowType(flowType: FlowType | undefined): ProjectStatus[] {
  if (flowType === 'collaborative') return STATUS_OPTIONS
  if (flowType === 'individual') return INDIVIDUAL_STATUS_OPTIONS
  if (flowType === 'basic') return SIMPLE_STATUS_OPTIONS
  // Unknown / workflow still loading — fall back to the simple set so the
  // pill stays usable but the user sees a conservative menu.
  return SIMPLE_STATUS_OPTIONS
}

// Single source of truth for direct status updates (the status-pill click
// path) and for workflow-driven `set_status` actions. Records every change
// in projectHistory with a required note.
export default function UpdateProjectStatusModal({
  open,
  onClose,
  project,
  allowedStatuses,
  titleOverride,
  submitLabelOverride,
}: Props) {
  const { user, profile } = useAuth()
  const workflow = useProjectWorkflow(project)
  const currentStatus = String(project.status ?? 'in_progress')
  // Phase 2d: prefer the workflow's author-configured statusOptions; otherwise
  // fall back to the per-flowType canonical defaults.
  const authorIds = workflow?.statusOptions?.length
    ? [...workflow.statusOptions].sort((a, b) => a.order - b.order).map((o) => o.id)
    : null
  // When opened from a `set_status` action, allowedStatuses carries canonical
  // ProjectStatus ids — source from the canonical flow-type set so the
  // intersection below isn't emptied by author-renamed status ids. The direct
  // pill-click path (no allowedStatuses) uses the author-configured set.
  const baseOptions: string[] = allowedStatuses
    ? statusOptionsForFlowType(workflow?.flowType)
    : (authorIds ?? statusOptionsForFlowType(workflow?.flowType))
  // Filter to the workflow-declared outcomes when provided. Keep the current
  // status visible even if it isn't in the allowed list, so the user sees what
  // they're changing from.
  const options = allowedStatuses
    ? baseOptions.filter(
        (s) => allowedStatuses.includes(s as ProjectStatus) || s === currentStatus,
      )
    : baseOptions
  const [next, setNext] = useState<string>(currentStatus)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setNext(currentStatus)
      setNote('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, currentStatus])

  async function handleSubmit() {
    if (!user) return
    if (!note.trim()) {
      setError('Add a short note so the team understands the change.')
      return
    }
    if (next === currentStatus) {
      setError('Pick a different status, or update the note and pick another option.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await updateProjectStatus({
        projectId: project.id,
        projectTitle: project.title,
        fromStatus: currentStatus,
        toStatus: next,
        note: note.trim(),
        enteredBy: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
        // The status change anchors to the project's current stage so the
        // timeline shows it in context.
        stageId: project.currentStageId,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-4 py-3 text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titleOverride ?? 'Update project status'}
      description="Pick the new status and add a note. The change appears in the project history."
      size="lg"
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="space-y-5"
      >
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg-muted">Status</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((opt) => {
              const meta = resolveStatusDisplay(opt, workflow)
              const active = next === opt
              const isCurrent = currentStatus === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setNext(opt)}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-brand-edge bg-brand-soft ring-2 ring-brand-ring'
                      : 'border-line bg-fill-1 hover:border-line-strong hover:bg-fill-2'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                      {meta.label}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] uppercase tracking-wider text-fg-subtle">current</span>
                    )}
                  </div>
                  <p className="text-xs text-fg-subtle">{meta.description}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="status-note" className="text-sm font-medium text-fg-muted">
            Note <span className="text-fg-subtle">(required)</span>
          </label>
          <textarea
            id="status-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is the status changing? What's the context?"
            rows={3}
            className={`${inputCls} resize-none`}
            required
          />
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-3 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !note.trim() || next === currentStatus}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Updating…' : (submitLabelOverride ?? 'Update status')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
