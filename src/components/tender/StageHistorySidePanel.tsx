import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Timestamp } from 'firebase/firestore'
import type {
  EligibilityNotePayload,
  EscalationPayload,
  IterationPayload,
  Project,
  StageEvent,
  StatusUpdatePayload,
} from '../../types/models'
import { STAGE_NAMES } from '../../types/models'
import { useAllUsers } from '../../hooks/useAllUsers'
import { STAGE_TONE } from './stageStyle'
import { STATUS_DISPLAY } from '../../lib/projectStatus'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

function isLoopBackEvent(stage: StageEvent['stage']): boolean {
  return stage === 3 || stage === 9
}

function fmtRelative(ts: Timestamp | null | undefined): string {
  if (!ts) return ''
  const date = ts.toDate()
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function isEscalation(p: StageEvent['payload']): p is EscalationPayload {
  return !!p && typeof (p as EscalationPayload).reason === 'string' && 'priority' in (p as object) && !('iteration' in (p as object))
}
function isIteration(p: StageEvent['payload']): p is IterationPayload {
  return !!p && typeof (p as IterationPayload).iteration === 'number'
}
function isStatusUpdate(p: StageEvent['payload']): p is StatusUpdatePayload {
  return !!p && 'from' in (p as object) && 'to' in (p as object) && 'note' in (p as object)
}
function isEligibilityNote(p: StageEvent['payload']): p is EligibilityNotePayload {
  // Distinct from StatusUpdate (also has `note`) by the absence of from/to.
  return !!p && 'note' in (p as object) && !('from' in (p as object))
}

// Slide-over side panel rendering project.stageHistory as a vertical timeline (delta §6.4).
// Loop-back events (stage 3 escalation, stage 9 rework) get a red left border + ↺ icon.
export default function StageHistorySidePanel({ open, onClose, project }: Props) {
  const { users } = useAllUsers()
  const userById = new Map(users.map((u) => [u.uid, u]))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const events = project.stageHistory ?? []
  // Render newest-first.
  const ordered = [...events].reverse()

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project history"
        className="relative ml-auto flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Project history</h2>
            <p className="text-xs text-fg-subtle">
              {events.length} event{events.length === 1 ? '' : 's'} · escalated{' '}
              {project.escalationCount ?? 0}× · iterations {project.vhIterationCount ?? 0}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-strong"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {ordered.length === 0 ? (
            <p className="text-sm text-fg-subtle">No history yet.</p>
          ) : (
            <ul className="space-y-3">
              {ordered.map((e, idx) => {
                const tone = STAGE_TONE[e.stage]
                const loopBack = isLoopBackEvent(e.stage)
                const actor = userById.get(e.enteredBy)
                return (
                  <li
                    key={idx}
                    className={`relative rounded-xl border bg-fill-1 p-4 ${
                      loopBack ? 'border-tone-danger-bd border-l-4' : 'border-line'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone?.pill}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${tone?.dot}`} aria-hidden />
                        {STAGE_NAMES[e.stage]}
                      </span>
                      <span className="ml-auto text-[11px] text-fg-subtle">
                        {loopBack ? '↺ ' : '→ '}
                        {fmtRelative(e.enteredAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-fg-subtle">
                      by {actor?.displayName ?? 'system'}
                    </div>
                    {isEscalation(e.payload) && (
                      <div className="mt-3 space-y-1 text-sm">
                        <div className="text-fg-strong">{e.payload.reason}</div>
                        <div className="text-xs text-fg-subtle">
                          Priority: {e.payload.priority}
                          {e.payload.eta && ` · ETA ${e.payload.eta.toDate().toLocaleDateString()}`}
                        </div>
                      </div>
                    )}
                    {isIteration(e.payload) && (
                      <div className="mt-3 space-y-1 text-sm">
                        <div className="text-xs text-fg-subtle">Iteration {e.payload.iteration}</div>
                        <div className="text-fg-strong">{e.payload.feedback}</div>
                        <div className="text-xs text-fg-subtle">
                          Priority: {e.payload.priority}
                          {e.payload.eta && ` · ETA ${e.payload.eta.toDate().toLocaleDateString()}`}
                        </div>
                      </div>
                    )}
                    {isStatusUpdate(e.payload) && (
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_DISPLAY[e.payload.from]?.pill}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DISPLAY[e.payload.from]?.dot}`} aria-hidden />
                            {STATUS_DISPLAY[e.payload.from]?.label}
                          </span>
                          <span className="text-fg-subtle" aria-hidden>→</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_DISPLAY[e.payload.to]?.pill}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DISPLAY[e.payload.to]?.dot}`} aria-hidden />
                            {STATUS_DISPLAY[e.payload.to]?.label}
                          </span>
                        </div>
                        <p className="text-fg-strong">{e.payload.note}</p>
                      </div>
                    )}
                    {isEligibilityNote(e.payload) && (
                      <blockquote className="mt-3 rounded-lg border-l-2 border-tone-cool-bd bg-tone-cool-bg px-3 py-2 text-sm text-fg-strong">
                        <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
                          VH's eligibility assessment
                        </span>
                        <span className="mt-1 block">{e.payload.note}</span>
                      </blockquote>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
