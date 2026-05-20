import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Timestamp } from 'firebase/firestore'
import type { Project } from '../../types/models'
import type {
  ActionInput,
  ProjectHistoryEvent,
  Stage,
  StageEvent,
  Workflow,
  WorkflowAssignmentEvent,
  WorkflowChangeEvent,
} from '../../types/workflow'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAppConfigContext, useOrgStructure, useWorkflow } from '../../contexts/AppConfigContext'
import { stageTone } from './stageStyle'
import { STATUS_DISPLAY } from '../../lib/projectStatus'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
}

// Phase 2b rename + rewrite of StageHistorySidePanel. Reads
// `project.projectHistory` (the discriminated-union timeline) and dispatches
// per event kind:
//   - 'stage'               → stage transitions; renders inputs payload
//   - 'workflow_assignment' → first event for every project; "Pinned to X"
//   - 'workflow_change'     → reserved for 2c (no UI to produce it in 2b)

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

// Build a map of input id → full ActionInput by walking every action's inputs
// across the workflow. Events are recorded at the destination stage, but
// inputs are authored on the source stage's actions — walking every action
// keeps lookups robust. First match wins deterministically.
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

  if (input?.type === 'user_picker' && typeof value === 'string') {
    const user = userById.get(value)
    const display = user?.displayName ?? user?.email ?? '— (user not found)'
    return (
      <FieldRow label={label}>
        <span className="text-fg-strong">{display}</span>
      </FieldRow>
    )
  }

  if (input?.type === 'textarea' && typeof value === 'string') {
    return (
      <blockquote className="rounded-lg border-l-2 border-tone-cool-bd bg-tone-cool-bg px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
        <div className="mt-1 whitespace-pre-line text-sm text-fg-strong">{value}</div>
      </blockquote>
    )
  }

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

// Iteration / escalation markers carry a counter and visually loop back — give
// them the danger border so they stand out in the timeline. Payload heuristic:
// stage events with `iteration` / `reason` / `feedback` keys mark a counter
// bump, regardless of which action drove it.
function isLoopBackStageEvent(e: StageEvent): boolean {
  const p = e.payload as Record<string, unknown> | null | undefined
  if (!p) return false
  return 'iteration' in p || 'reason' in p || 'feedback' in p
}

export default function ProjectHistorySidePanel({ open, onClose, project }: Props) {
  const { users } = useAllUsers()
  const workflow = useWorkflow(project.workflowId)
  const { workflowsById, ensureWorkflow } = useAppConfigContext()
  const org = useOrgStructure()
  const userById = useMemo(() => new Map(users.map((u) => [u.uid, u])), [users])
  const leadRoleName = workflow?.leadRoleName || org.leadRoleName

  // Some events (workflow_change) reference workflows other than the project's
  // current one — kick off lazy fetches so their displayNames resolve. Stage
  // events use the project's workflow (already loaded above).
  useEffect(() => {
    if (!project.projectHistory) return
    for (const e of project.projectHistory) {
      if (e.kind === 'workflow_assignment' && !workflowsById[e.workflowId]) {
        void ensureWorkflow(e.workflowId)
      }
      if (e.kind === 'workflow_change') {
        if (!workflowsById[e.fromWorkflowId]) void ensureWorkflow(e.fromWorkflowId)
        if (!workflowsById[e.toWorkflowId]) void ensureWorkflow(e.toWorkflowId)
      }
    }
  }, [project.projectHistory, workflowsById, ensureWorkflow])

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

  const stageById = useMemo(() => {
    if (!workflow) return new Map<string, Stage>()
    return new Map(workflow.stages.map((s) => [s.id, s] as [string, Stage]))
  }, [workflow])

  const workflowInputMap = useMemo(() => buildWorkflowInputMap(workflow), [workflow])

  if (!open) return null

  const events: ProjectHistoryEvent[] = project.projectHistory ?? []
  const ordered = [...events].reverse()
  const iterations = project.iterationCount ?? 0
  const stageEventCount = events.filter((e) => e.kind === 'stage').length

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
              {stageEventCount} stage event{stageEventCount === 1 ? '' : 's'} · escalated{' '}
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
                switch (e.kind) {
                  case 'stage':
                    return (
                      <StageEventRow
                        key={idx}
                        event={e}
                        stageById={stageById}
                        userById={userById}
                        workflowInputMap={workflowInputMap}
                        leadRoleName={leadRoleName}
                      />
                    )
                  case 'workflow_assignment':
                    return (
                      <WorkflowAssignmentRow
                        key={idx}
                        event={e}
                        userById={userById}
                        workflowsById={workflowsById}
                      />
                    )
                  case 'workflow_change':
                    return (
                      <WorkflowChangeRow
                        key={idx}
                        event={e}
                        userById={userById}
                        workflowsById={workflowsById}
                      />
                    )
                }
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface StageRowProps {
  event: StageEvent
  stageById: Map<string, Stage>
  userById: Map<string, { displayName: string; email: string }>
  workflowInputMap: Record<string, ActionInput>
  leadRoleName: string
}

function StageEventRow({
  event,
  stageById,
  userById,
  workflowInputMap,
  leadRoleName,
}: StageRowProps) {
  const stageInfo = stageById.get(event.stageId)
  const tone = stageTone(stageInfo?.order ?? 1, stageInfo?.isTerminal ?? false)
  const loopBack = isLoopBackStageEvent(event)
  const actor = userById.get(event.enteredBy)
  const stageLabel = stageInfo?.displayName ?? event.stageId
  const payload = (event.payload ?? null) as Record<string, unknown> | null
  const payloadEntries =
    payload && typeof payload === 'object'
      ? Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && v !== '')
      : []
  const isStatus = payload ? isStatusUpdatePayload(payload) : false

  return (
    <li
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
          {fmtRelative(event.enteredAt)}
        </span>
      </div>
      <div className="mt-1 text-xs text-fg-subtle">by {actor?.displayName ?? 'system'}</div>
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
}

interface AssignmentRowProps {
  event: WorkflowAssignmentEvent
  userById: Map<string, { displayName: string; email: string }>
  workflowsById: Record<string, Workflow>
}

function WorkflowAssignmentRow({ event, userById, workflowsById }: AssignmentRowProps) {
  const wf = workflowsById[event.workflowId]
  const actor = userById.get(event.assignedBy)
  return (
    <li className="rounded-xl border border-line bg-fill-1 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-cool-bd bg-tone-cool-bg px-2 py-0.5 text-[11px] font-medium text-tone-cool-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-cool-dot" aria-hidden />
          Workflow pinned
        </span>
        <span className="ml-auto text-[11px] text-fg-subtle">
          → {fmtRelative(event.assignedAt)}
        </span>
      </div>
      <div className="mt-2 text-sm text-fg">
        Project pinned to{' '}
        <span className="font-medium text-fg-strong">{wf?.displayName ?? event.workflowId}</span>
      </div>
      <div className="mt-1 text-xs text-fg-subtle">by {actor?.displayName ?? 'system'}</div>
    </li>
  )
}

interface ChangeRowProps {
  event: WorkflowChangeEvent
  userById: Map<string, { displayName: string; email: string }>
  workflowsById: Record<string, Workflow>
}

function WorkflowChangeRow({ event, userById, workflowsById }: ChangeRowProps) {
  const fromWf = workflowsById[event.fromWorkflowId]
  const toWf = workflowsById[event.toWorkflowId]
  const actor = userById.get(event.changedBy)
  return (
    <li className="rounded-xl border-l-4 border-tone-accent-bd border bg-fill-1 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-tone-accent-bd bg-tone-accent-bg px-2 py-0.5 text-[11px] font-medium text-tone-accent-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-dot" aria-hidden />
          Workflow changed
        </span>
        <span className="ml-auto text-[11px] text-fg-subtle">
          → {fmtRelative(event.changedAt)}
        </span>
      </div>
      <div className="mt-2 text-sm text-fg">
        <span className="font-medium text-fg-strong">
          {fromWf?.displayName ?? event.fromWorkflowId}
        </span>{' '}
        →{' '}
        <span className="font-medium text-fg-strong">
          {toWf?.displayName ?? event.toWorkflowId}
        </span>
      </div>
      {event.reason && (
        <blockquote className="mt-2 rounded-lg border-l-2 border-tone-accent-bd bg-tone-accent-bg px-3 py-2 text-sm text-fg-muted">
          {event.reason}
        </blockquote>
      )}
      <div className="mt-1 text-xs text-fg-subtle">by {actor?.displayName ?? 'system'}</div>
    </li>
  )
}
