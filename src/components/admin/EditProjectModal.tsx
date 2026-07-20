import { useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectWorkflow } from '../../contexts/AppConfigContext'
import { updateProjectDetails } from '../../lib/firestore'
import type { Project } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// Date-only values are UTC-midnight; round-trip them in UTC to avoid ±1-day
// drift for non-UTC users (matches creation).
function toDateInput(ts: Timestamp | undefined): string {
  return ts ? ts.toDate().toISOString().slice(0, 10) : ''
}

// A timed submission value is a real LOCAL instant — prefill from local date/time
// parts so the round-trip is stable (UTC slicing would shift it for non-UTC users).
function toLocalDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function toLocalTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// Edit a project's core details (title, description, and the flow-appropriate
// dates). Mirrors the codebase's modal edit convention (UpdateProjectStatusModal).
// Never touches workflow-engine-owned fields — updateProjectDetails enforces that.
export default function EditProjectModal({ open, onClose, project }: Props) {
  const { user, profile } = useAuth()
  const workflow = useProjectWorkflow(project)
  const isCollab = workflow?.flowType === 'collaborative'
  // Show the date section only once the flow type is known. useProjectWorkflow
  // returns null while the workflow is still resolving (or if it can't resolve),
  // and until it's non-null we can't tell which date fields apply — guessing
  // would show the wrong field (e.g. a Deadline input on a collaborative project).
  const showDates = workflow !== null

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [submissionDate, setSubmissionDate] = useState('')
  const [submissionTime, setSubmissionTime] = useState('')
  const [presentationDate, setPresentationDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle(project.title)
      setDescription(project.description ?? '')
      setDeadline(toDateInput(project.deadline))
      // A timed submission prefills from local parts; a date-only one from UTC.
      if (project.submissionDate && project.submissionHasTime) {
        const d = project.submissionDate.toDate()
        setSubmissionDate(toLocalDateInput(d))
        setSubmissionTime(toLocalTimeInput(d))
      } else {
        setSubmissionDate(toDateInput(project.submissionDate))
        setSubmissionTime('')
      }
      setPresentationDate(toDateInput(project.presentationDate))
      setError(null)
      setSubmitting(false)
    }
    // Seed on open / when pointed at a different project — reads live values at
    // seed time only, so a concurrent edit can't clobber in-progress input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id])

  async function handleSubmit() {
    if (!user || submitting) return
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setError(null)
    setSubmitting(true)
    const toTs = (v: string): Timestamp | null => (v ? Timestamp.fromDate(new Date(v)) : null)
    // With a time, parse as a LOCAL instant; without, UTC-midnight date-only.
    const submissionTs = submissionDate
      ? Timestamp.fromDate(
          new Date(submissionTime ? `${submissionDate}T${submissionTime}` : submissionDate),
        )
      : null
    try {
      await updateProjectDetails({
        projectId: project.id,
        title,
        description,
        // Only pass the date keys relevant to this flow; omitted keys are left
        // untouched. While the workflow is still loading, edit only text.
        ...(showDates && isCollab
          ? {
              submissionDate: submissionTs,
              submissionHasTime: !!(submissionDate && submissionTime),
              presentationDate: toTs(presentationDate),
            }
          : {}),
        ...(showDates && !isCollab ? { deadline: toTs(deadline) } : {}),
        actorId: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes')
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-fill-2 px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring'
  const labelCls = 'text-sm font-medium text-fg-muted'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit project"
      description="Update the project's title, description, and dates."
      size="lg"
      closeOnBackdrop={!submitting}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <label htmlFor="edit-project-title" className={labelCls}>
            Title
          </label>
          <input
            id="edit-project-title"
            type="text"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="edit-project-desc" className={labelCls}>
            Description
          </label>
          <textarea
            id="edit-project-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`${inputCls} resize-none`}
          />
        </div>

        {showDates && isCollab && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="edit-project-submission" className={labelCls}>
                Submission date <span className="font-normal text-fg-subtle">(time optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="edit-project-submission"
                  type="date"
                  value={submissionDate}
                  onChange={(e) => setSubmissionDate(e.target.value)}
                  className={`${inputCls} scheme-dark flex-1`}
                />
                <input
                  type="time"
                  aria-label="Submission time (optional)"
                  value={submissionTime}
                  onChange={(e) => setSubmissionTime(e.target.value)}
                  disabled={!submissionDate}
                  className={`${inputCls} scheme-dark w-32 disabled:opacity-50`}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="edit-project-presentation" className={labelCls}>
                Presentation date
              </label>
              <input
                id="edit-project-presentation"
                type="date"
                value={presentationDate}
                onChange={(e) => setPresentationDate(e.target.value)}
                className={`${inputCls} scheme-dark`}
              />
            </div>
          </div>
        )}

        {showDates && !isCollab && (
          <div className="space-y-1.5">
            <label htmlFor="edit-project-deadline" className={labelCls}>
              Deadline
            </label>
            <input
              id="edit-project-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={`${inputCls} scheme-dark`}
            />
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg"
          >
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-2.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
