import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Timestamp } from 'firebase/firestore'
import type { Project, StageEvent } from '../../types/models'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useActiveWorkflow, useOrgStructure } from '../../contexts/AppConfigContext'
import { stageTone } from './stageStyle'
import { STATUS_DISPLAY } from '../../lib/projectStatus'
import type { ActionInput, Stage, Workflow } from '../../types/workflow'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
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

// "eligibilityNote" → "Eligibility Note". Used as the fallback label when
// the payload key has no matching input declaration in the workflow doc.
function humaniseKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

function isTimestampLike(v: unknown): v is Timestamp {
  if (v instanceof Timestamp) return true
  return Boolean(
    v &&
      typeof v === 'object' &&
      typeof (v as { toDate?: unknown }).toDate === 'function',
  )
}

function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isTimestampLike(value)) {
    return value.toDate().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  // Status update payloads write {seconds, nanoseconds}-shaped Timestamps
  // when the underlying value was a Date — recover gracefully.
  if (
    typeof value === 'object' &&
    'seconds' in (value as Record<string, unknown>) &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  ) {
    const seconds = (value as { seconds: number }).seconds
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  return JSON.stringify(value)
}

// Build a map of input id → full ActionInput by walking every action's
// inputs across the WHOLE workflow. Events are recorded at the destination
// stage, but inputs are authored on the source stage's actions — so scoping
// to the event's stage alone would miss declarations (e.g. an
// `eligibilityNote` event at `eligibility_review` was authored on
// `allocated`'s accept action). Walking every action keeps lookups robust;
// input id collisions across the workflow are unusual in practice and the
// first match wins deterministically.
function buildWorkflowInputMap(
  workflow: Workflow | null,
): Record<string, ActionInput> {
  if (!workflow) return {}
  const out: Record<string, ActionInput> = {}
  for (const stage of workflow.stages) {
    for (const action of stage.actions) {
      for (const input of action.inputs) {
        if (!(input.id in out)) {
          out[input.id] = input
        }
      }
    }
  }
  return out
}

// Pick a label for a payload key:
//   1. Status update events from the legacy updateProjectStatus path label
//      `from`/`to`/`note` directly so they read naturally.
//   2. Otherwise, prefer the workflow doc's input label.
//   3. Fall back to humanising the raw key.
function labelForKey(
  key: string,
  input: ActionInput | undefined,
  isStatusUpdate: boolean,
  leadRoleName: string,
): string {
  if (isStatusUpdate) {
    if (key === 'from') return 'Previous status'
    if (key === 'to') return 'New status'
    if (key === 'note') return 'Note'
  }
  if (input) return input.label.replace(/\{leadRoleName\}/g, leadRoleName)
  return humaniseKey(key)
}

function isStatusUpdatePayload(p: Record<string, unknown>): boolean {
  return 'from' in p && 'to' in p
}

// Render the project-status pill for from/to fields on a status-update event.
function StatusPill({ value }: { value: unknown }) {
  if (typeof value !== 'string') return <>{formatPayloadValue(value)}</>
  const meta = STATUS_DISPLAY[value as keyof typeof STATUS_DISPLAY]
  if (!meta) return <>{value}</>
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  )
}

// Type-aware payload field renderer. Picks layout based on the input's
// declared type:
//   - user_picker → resolve uid → user display name (never show raw uid)
//   - textarea    → blockquote with cool-blue left border for long-form text
//   - status_select / from / to on status-update → coloured status pill
//   - date        → localised date
//   - default     → compact label / value
interface PayloadFieldProps {
  keyName: string
  value: unknown
  input: ActionInput | undefined
  isStatusUpdate: boolean
  leadRoleName: string
  userById: Map<string, { displayName: string; email: string }>
}

function PayloadField({
  keyName,
  value,
  input,
  isStatusUpdate,
  leadRoleName,
  userById,
}: PayloadFieldProps) {
  const label = labelForKey(keyName, input, isStatusUpdate, leadRoleName)

  // user_picker: resolve uid to display name. Don't ever fall through to the
  // raw uid — if lookup fails, show a graceful placeholder.
  if (input?.type === 'user_picker' && typeof value === 'string') {
    const user = userById.get(value)
    const display = user?.displayName ?? user?.email ?? '— (user not found)'
    return (
      <FieldRow label={label}>
        <span className="text-fg-strong">{display}</span>
      </FieldRow>
    )
  }

  // Textarea inputs get the rich blockquote treatment.
  if (input?.type === 'textarea' && typeof value === 'string') {
    return (
      <blockquote className="rounded-lg border-l-2 border-tone-cool-bd bg-tone-cool-bg px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          {label}
        </div>
        <div className="mt-1 whitespace-pre-line text-sm text-fg-strong">{value}</div>
      </blockquote>
    )
  }

  // Status pills for from/to on status-update events OR any status_select input.
  const showStatusPill =
    (isStatusUpdate && (keyName === 'from' || keyName === 'to')) ||
    input?.type === 'status_select'
  if (showStatusPill) {
    return (
      <FieldRow label={label}>
        <StatusPill value={value} />
      </FieldRow>
    )
  }

  return (
    <FieldRow label={label}>
      <span className="text-fg-strong">{formatPayloadValue(value)}</span>
    </FieldRow>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

// Side panel rendering project.stageHistory as a vertical timeline. Reads
// stage display names from the active workflow doc keyed by `stageId`, with a
// numeric-stage fallback for legacy entries written before Sprint 2.
export default function StageHistorySidePanel({ open, onClose, project }: Props) {
  const { users } = useAllUsers()
  const { workflow } = useActiveWorkflow()
  const org = useOrgStructure()
  const userById = useMemo(() => new Map(users.map((u) => [u.uid, u])), [users])
  const leadRoleName = workflow?.leadRoleName || org.leadRoleName

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

  // Build a stageId → Stage map once per workflow so each event resolves O(1).
  const stageById = useMemo(() => {
    if (!workflow) return new Map<string, Stage>()
    return new Map(workflow.stages.map((s) => [s.id, s]))
  }, [workflow])

  // Memo: input map across the entire workflow so the timeline can resolve
  // payload keys to authored ActionInput declarations in one lookup per event.
  const workflowInputMap = useMemo(() => buildWorkflowInputMap(workflow), [workflow])

  if (!open) return null

  const events = project.stageHistory ?? []
  const ordered = [...events].reverse()
  const iterations = (project.iterationCount ?? project.vhIterationCount) ?? 0

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
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
              {project.escalationCount ?? 0}× · iterations {iterations}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-strong"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
                const stageInfo = resolveStageForEvent(e, stageById)
                const tone = stageTone(stageInfo?.order ?? 1, stageInfo?.isTerminal ?? false)
                const loopBack = isLoopBackEvent(e)
                const actor = userById.get(e.enteredBy)
                const stageLabel = stageInfo?.displayName ?? '—'
                const payload = (e.payload ?? null) as Record<string, unknown> | null
                const payloadEntries =
                  payload && typeof payload === 'object'
                    ? Object.entries(payload).filter(
                        ([, v]) => v !== null && v !== undefined && v !== '',
                      )
                    : []
                const isStatus = payload ? isStatusUpdatePayload(payload) : false
                return (
                  <li
                    key={idx}
                    className={`relative rounded-xl border bg-fill-1 p-4 ${
                      loopBack ? 'border-tone-danger-bd border-l-4' : 'border-line'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                        {stageLabel}
                      </span>
                      <span className="ml-auto text-[11px] text-fg-subtle">
                        {loopBack ? '↺ ' : '→ '}
                        {fmtRelative(e.enteredAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-fg-subtle">
                      by {actor?.displayName ?? 'system'}
                    </div>
                    {payloadEntries.length > 0 && (
                      <div className="mt-3 space-y-2.5 text-sm">
                        {payloadEntries.map(([key, value]) => (
                          <PayloadField
                            key={key}
                            keyName={key}
                            value={value}
                            input={workflowInputMap[key]}
                            isStatusUpdate={isStatus}
                            leadRoleName={leadRoleName}
                            userById={userById}
                          />
                        ))}
                      </div>
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

function resolveStageForEvent(
  e: StageEvent,
  stageById: Map<string, Stage>,
): Stage | null {
  if (e.stageId) {
    const direct = stageById.get(e.stageId)
    if (direct) return direct
  }
  // Legacy fallback: pre-2a events store numeric `stage`. Best-effort label
  // map for the collab-default workflow's eight stages.
  const legacyName: Record<number, string> = {
    1: 'Project Created',
    2: 'Awaiting Lead Decision',
    3: 'Escalation',
    4: 'Lead Accepted',
    5: 'Eligibility Review',
    6: 'Task Setup',
    7: 'In Execution',
    8: 'Lead Review',
    9: 'Rework',
    10: 'Delivered',
  }
  if (typeof e.stage === 'number') {
    return {
      id: `legacy-${e.stage}`,
      displayName: legacyName[e.stage] ?? `Stage ${e.stage}`,
      order: e.stage,
      isTerminal: false,
      actions: [],
    }
  }
  return null
}

// Iteration / escalation markers carry a counter and visually loop back —
// give them the danger border so they stand out in the timeline. Payload
// heuristic kept for back-compat with the old `reason`/`iteration`/`feedback`
// keys; numeric stage 3/9 catches pre-Sprint-2 legacy markers.
function isLoopBackEvent(e: StageEvent): boolean {
  if (e.stage === 3 || e.stage === 9) return true
  const p = e.payload as Record<string, unknown> | null | undefined
  if (!p) return false
  return 'iteration' in p || 'reason' in p || 'feedback' in p
}

