import type { TaskStatus } from '../types/models'
import { useFeature } from '../contexts/AppConfigContext'

// Single source of truth for task statuses — order, labels, colours, and the
// open/active/blocked/terminal categories. Two fixed sets share one persisted
// id space: 'generic' (the original 5) and 'tech' (the 9-stage engineering
// pipeline), selected org-wide by features.techTaskStatuses. The 5 legacy ids
// are reused verbatim so flipping the flag never rewrites data; predicates and
// display metadata below are deliberately flag-INDEPENDENT so a doc written
// under either set renders correctly forever.
//
// Import-cycle note: pulling useFeature/isFeatureEnabled from AppConfigContext
// here mirrors the existing firestore.ts ↔ AppConfigContext cycle — all
// imports are functions invoked at call time, not module-init. Don't "fix"
// this by splitting the module.

export type TaskStatusCategory = 'open' | 'active' | 'blocked' | 'terminal'

export interface TaskStatusMeta {
  label: string
  // Literal Tailwind classes (never interpolate — same rule as fieldTokens.ts).
  dotCls: string
  pillCls: string
  category: TaskStatusCategory
  // Column/filter bucket this status folds into when the tech set is OFF
  // (identity for the 5 generic ids). See bucketForActiveSet.
  legacyBucket: TaskStatus
}

// TOTAL over the 9-member union — compile-enforced completeness. The 5 legacy
// entries are byte-identical to the classes/labels previously duplicated in
// StatusMenu/TaskDetailContent/Me/TeamOnProject, so flag-off UI is unchanged.
export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  todo: {
    label: 'Todo',
    dotCls: 'bg-neutral-dot',
    pillCls: 'border-line bg-fill-2 text-fg-muted',
    category: 'open',
    legacyBucket: 'todo',
  },
  in_progress: {
    label: 'In Progress',
    dotCls: 'bg-info-dot',
    pillCls: 'border-tone-info-bd bg-tone-info-bg text-tone-info-fg',
    category: 'active',
    legacyBucket: 'in_progress',
  },
  blocked: {
    label: 'Blocked',
    dotCls: 'bg-danger-dot',
    pillCls: 'border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg',
    category: 'blocked',
    legacyBucket: 'blocked',
  },
  dev_done: {
    label: 'Dev Done',
    dotCls: 'bg-mint-dot',
    pillCls: 'border-tone-mint-bd bg-tone-mint-bg text-tone-mint-fg',
    category: 'active',
    legacyBucket: 'in_review',
  },
  in_review: {
    label: 'In Review',
    dotCls: 'bg-brandtone-dot',
    pillCls: 'border-brand-edge bg-brand-soft text-brand',
    category: 'active',
    legacyBucket: 'in_review',
  },
  in_uat: {
    label: 'In UAT',
    dotCls: 'bg-yellow-dot',
    pillCls: 'border-tone-yellow-bd bg-tone-yellow-bg text-tone-yellow-fg',
    category: 'active',
    legacyBucket: 'in_review',
  },
  ready_for_prod: {
    label: 'Ready for Prod',
    dotCls: 'bg-orange-dot',
    pillCls: 'border-tone-orange-bd bg-tone-orange-bg text-tone-orange-fg',
    category: 'active',
    legacyBucket: 'in_review',
  },
  done: {
    label: 'Done',
    dotCls: 'bg-success-dot',
    pillCls: 'border-tone-success-bd bg-tone-success-bg text-tone-success-fg',
    category: 'terminal',
    legacyBucket: 'done',
  },
  cancelled: {
    label: 'Cancelled',
    dotCls: 'bg-pink-dot',
    pillCls: 'border-tone-pink-bd bg-tone-pink-bg text-tone-pink-fg',
    category: 'terminal',
    legacyBucket: 'done',
  },
}

// Column order = dropdown order = filter-pill order = chart stack/slice order.
export const GENERIC_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked']
export const TECH_STATUSES: TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'dev_done',
  'in_review',
  'in_uat',
  'ready_for_prod',
  'done',
  'cancelled',
]

export function activeTaskStatuses(techOn: boolean): TaskStatus[] {
  return techOn ? TECH_STATUSES : GENERIC_STATUSES
}

// THE read for React surfaces (boards, menus, filters, charts).
export function useTaskStatuses(): { statuses: TaskStatus[]; techOn: boolean } {
  const techOn = useFeature('techTaskStatuses')
  return { statuses: activeTaskStatuses(techOn), techOn }
}

// ─── Pure, flag-independent predicates ──────────────────────────────────────
// Widened to string|undefined so persisted docs can be tested without casts.

// The one status that means "work delivered": drives completedAt, subtask
// done-rollups, and progress numerators. Cancelled is terminal but NOT complete.
export function isComplete(status: TaskStatus | string | undefined): boolean {
  return status === 'done'
}

// No further work will happen: done or cancelled. Drives "open work" queries,
// overdue badges, utilization denominators, and blocker gates.
export function isTerminal(status: TaskStatus | string | undefined): boolean {
  return status === 'done' || status === 'cancelled'
}

export function isOpenStatus(status: TaskStatus | string | undefined): boolean {
  return !isTerminal(status)
}

// Progress denominators exclude cancelled entirely (neither done nor
// outstanding) — see progress.ts.
export function countsForProgress(status: TaskStatus | string | undefined): boolean {
  return status !== 'cancelled'
}

// ─── Review pipeline ─────────────────────────────────────────────────────────
// Flag-INDEPENDENT on purpose: a leftover in_uat task must keep its review
// banner, Approve/Send-back actions and queue presence even after the tech set
// is switched off (data never loses behavior). Harmless for pure-generic
// tenants — no in_uat doc can exist there.
export const REVIEW_STATUSES: TaskStatus[] = ['in_review', 'in_uat']

export function isReviewStatus(status: TaskStatus | string | undefined): boolean {
  return status === 'in_review' || status === 'in_uat'
}

// Where "Approve" lands. Tech set: review approval covers UAT, so approve
// advances to ready_for_prod (completion side effects — completedAt, counter
// bumps, blocker gate — fire later on the manual → Done move). Generic set
// keeps today's behavior: approve completes the task.
export function reviewApproveTarget(
  _from: TaskStatus | string | undefined,
  techOn: boolean,
): TaskStatus {
  return techOn ? 'ready_for_prod' : 'done'
}

// "Send back" always returns the task to active work, from any review status.
export function reviewRejectTarget(): TaskStatus {
  return 'in_progress'
}

// ─── Safe accessors ──────────────────────────────────────────────────────────
// Never index TASK_STATUS_META with a raw persisted string (same rule as
// projectStatus.ts resolveStatusDisplay) — an unknown id must never crash a pill.

const FALLBACK_META: TaskStatusMeta = {
  label: '—',
  dotCls: 'bg-neutral-dot',
  pillCls: 'border-line bg-fill-2 text-fg-muted',
  category: 'open',
  legacyBucket: 'todo',
}

export function resolveTaskStatusMeta(status: TaskStatus | string | undefined): TaskStatusMeta {
  const meta = TASK_STATUS_META[status as TaskStatus]
  if (meta) return meta
  return status ? { ...FALLBACK_META, label: String(status) } : FALLBACK_META
}

export function taskStatusLabel(status: TaskStatus | string | undefined): string {
  return resolveTaskStatusMeta(status).label
}

// Human-readable "Todo → Done" line for notification snippets. Snippets are
// frozen display strings persisted at write time (models.ts AppNotification) —
// they are rendered verbatim and never re-parsed, so labels are safe here.
// Audit payloads keep raw ids instead (relabel-able at render).
export function statusChangeSnippet(
  from: TaskStatus | string | undefined,
  to: TaskStatus | string | undefined,
): string {
  return `${taskStatusLabel(from)} → ${taskStatusLabel(to)}`
}

// Which ACTIVE column/filter value a persisted status renders under. Identity
// while the status is in the active set; otherwise its legacy bucket
// (dev_done/in_uat/ready_for_prod → in_review, cancelled → done). Total —
// unknown strings fall back through the resolver — so boards and filters can
// never silently drop a task.
export function bucketForActiveSet(
  status: TaskStatus | string | undefined,
  techOn: boolean,
): TaskStatus {
  const meta = resolveTaskStatusMeta(status)
  if (techOn) {
    return TASK_STATUS_META[status as TaskStatus] ? (status as TaskStatus) : meta.legacyBucket
  }
  return meta.legacyBucket
}
