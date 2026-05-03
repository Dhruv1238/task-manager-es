import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { updateProjectStatus } from '../../lib/firestore'
import { STATUS_DISPLAY, STATUS_OPTIONS } from '../../lib/projectStatus'
import type { Project, ProjectStatus, Stage } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// Single source of truth for changing project.status. VH and CS can open this
// from the project header pill or from the stage-10 banner action button.
// Records every change in stageHistory with a required note.
export default function UpdateProjectStatusModal({ open, onClose, project }: Props) {
  const { user, profile } = useAuth()
  const currentStatus = (project.status ?? 'in_progress') as ProjectStatus
  const [next, setNext] = useState<ProjectStatus>(currentStatus)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      // Default-suggest the most likely transition: at stage 10 it's "Submitted",
      // anywhere else keep the current status selected.
      const stage = project.stage
      if (stage === 10 && currentStatus === 'in_progress') {
        setNext('submitted')
      } else {
        setNext(currentStatus)
      }
      setNote('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, currentStatus, project.stage])

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
        stage: (project.stage ?? 1) as Stage,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update project status"
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
          <p className="text-sm font-medium text-white/80">Status</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {STATUS_OPTIONS.map((opt) => {
              const meta = STATUS_DISPLAY[opt]
              const active = next === opt
              const isCurrent = currentStatus === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setNext(opt)}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-purple-400/60 bg-purple-500/10 ring-2 ring-purple-500/30'
                      : 'border-white/10 bg-white/2 hover:border-white/20 hover:bg-white/4'
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
                      <span className="text-[10px] uppercase tracking-wider text-white/45">current</span>
                    )}
                  </div>
                  <p className="text-xs text-white/55">{meta.description}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="status-note" className="text-sm font-medium text-white/80">
            Note <span className="text-white/40">(required)</span>
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
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-white/10 bg-white/4 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !note.trim() || next === currentStatus}
            className="flex-1 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-purple-900/40 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Updating…' : 'Update status'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
