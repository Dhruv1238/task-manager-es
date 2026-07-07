/**
 * Pure KPI computation over EXISTING project/audit/user data. No writes, no
 * Firestore access — every function takes plain arrays so it's unit-testable and
 * agnostic to whether inputs are raw docs or (later) pre-aggregated summaries.
 *
 * The backbone is `statusChangeEvents`: a project's `projectHistory` carries
 * `StageEvent`s, and a *status change* is recorded as a stage event whose
 * `payload` holds `{ from, to, note }` (see workflowEvaluator set_status). A
 * genuine *stage transition* carries the action's inputs (or null) instead — so
 * the presence of a string `payload.to` is the discriminator between the two.
 *
 * Scope: collaborative flow only (callers pre-filter to COLLAB_DEFAULT_WORKFLOW_ID).
 */
import type { AuditEvent, Project } from '../../types/models'
import type { StageEvent } from '../../types/workflow'
import { isProjectClosed } from '../projectStatus'

// Collab-seed stages where work is actively being touched (vs queued/waiting).
// created/allocated (awaiting accept) and delivered (awaiting client) are
// waiting stages; on_hold is excluded separately as a status interval.
export const COLLAB_ACTIVE_STAGES = new Set([
  'eligibility_review',
  'task_setup',
  'in_execution',
  'lead_review',
])
const COLLAB_WAITING_STAGES = new Set(['created', 'allocated', 'delivered'])

// Active-vs-waiting classification. Seed stage ids use the curated sets above;
// authored-workflow stage ids fall back to a structural heuristic read from the
// pinned workflow: the entry stage (queue before anyone accepts) and terminal
// stages are waiting, everything between is touch time.
function stageIsActive(stageId: string, project: Project): boolean {
  if (COLLAB_ACTIVE_STAGES.has(stageId)) return true
  if (COLLAB_WAITING_STAGES.has(stageId)) return false
  const wf = project.pinnedWorkflow
  const stage = wf?.stages?.find((s) => s.id === stageId)
  if (!stage || stage.isTerminal) return false
  const entryId =
    wf?.entryStageId ?? [...(wf?.stages ?? [])].sort((a, b) => a.order - b.order)[0]?.id
  return stageId !== entryId
}

const DAY_MS = 86_400_000

export interface StatusChange {
  from: string
  to: string
  at: number // ms epoch
  by: string
}

// Firestore Timestamp | plain {seconds} | null → ms epoch (or null).
function tsToMs(ts: unknown): number | null {
  if (!ts) return null
  const t = ts as { toMillis?: () => number; seconds?: number }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return null
}

function isStatusEvent(e: StageEvent): boolean {
  const p = e.payload
  return Boolean(p && typeof p === 'object' && typeof (p as Record<string, unknown>).to === 'string')
}

// Ordered status-change timeline for a project. Two sources, disjoint by
// construction:
//  - Legacy path (workflowEvaluator.performAction set_status): a StageEvent
//    whose payload holds { from, to, note }.
//  - v2 path (executeOutcome): NO such event is appended — the status change
//    lives in project.outcomeLog. Each entry is resolved against the pinned
//    workflow: a `close` outcome's terminalStatusId, or the status_select input
//    on a hold/close outcome. Authored workflows only ever take this path.
export function statusChangeEvents(project: Project): StatusChange[] {
  const out: StatusChange[] = []
  for (const ev of project.projectHistory ?? []) {
    if (ev.kind !== 'stage' || !isStatusEvent(ev)) continue
    const at = tsToMs(ev.enteredAt)
    if (at == null) continue
    const p = ev.payload as Record<string, unknown>
    out.push({
      from: typeof p.from === 'string' ? p.from : '',
      to: p.to as string,
      at,
      by: ev.enteredBy,
    })
  }
  const wf = project.pinnedWorkflow
  for (const entry of project.outcomeLog ?? []) {
    const at = tsToMs(entry.at)
    if (at == null) continue
    const outcome = wf?.stages
      ?.flatMap((s) => s.actions ?? [])
      .find((a) => a.id === entry.actionId)
      ?.outcomes?.find((o) => o.id === entry.outcomeId)
    const inputStatus = entry.inputs?.status ?? entry.inputs?.outcome
    let to: string | null = null
    if (outcome?.terminalStatusId) to = outcome.terminalStatusId
    else if (
      (entry.shape === 'hold' || entry.shape === 'close') &&
      typeof inputStatus === 'string'
    )
      to = inputStatus
    if (to) out.push({ from: '', to, at, by: entry.by })
  }
  return out.sort((a, b) => a.at - b.at)
}

// ─── On-hold interval reconstruction ────────────────────────────────────────
// Each transition into on_hold opens an interval; the next status change closes
// it. An unclosed hold is clamped to `endMs`.
export function onHoldIntervals(changes: StatusChange[], endMs: number): Array<[number, number]> {
  const intervals: Array<[number, number]> = []
  let holdStart: number | null = null
  for (const c of changes) {
    if (c.to === 'on_hold') {
      if (holdStart == null) holdStart = c.at
    } else if (holdStart != null) {
      intervals.push([holdStart, c.at])
      holdStart = null
    }
  }
  if (holdStart != null) intervals.push([holdStart, endMs])
  return intervals
}

function overlapMs(a0: number, a1: number, intervals: Array<[number, number]>): number {
  let o = 0
  for (const [b0, b1] of intervals) o += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  return o
}

// ─── Per-project primitives ─────────────────────────────────────────────────

// A tender win: the project ever reached 'awarded' OR 'completed'. Completed
// means awarded work was delivered, and outcome recording can jump straight to
// it without an intermediate awarded event — both must count. (Collab-only
// scope; in the basic flow 'completed' is ordinary completion, not a win.)
export function isWin(project: Project): boolean {
  return (
    statusChangeEvents(project).some((c) => c.to === 'awarded' || c.to === 'completed') ||
    project.status === 'awarded' ||
    project.status === 'completed'
  )
}

// created → first `submitted` (else first terminal/closed status), minus on-hold.
export function cycleTime(
  project: Project,
): { startMs: number; endMs: number; adjustedMs: number } | null {
  const startMs = tsToMs(project.createdAt)
  if (startMs == null) return null
  const changes = statusChangeEvents(project)
  const submitted = changes.find((c) => c.to === 'submitted')
  const closed = changes.find((c) => isProjectClosed(c.to))
  const endMs = submitted?.at ?? closed?.at ?? null
  if (endMs == null || endMs < startMs) return null
  const hold = onHoldIntervals(changes, endMs).reduce(
    (sum, [a, b]) => sum + Math.max(0, Math.min(b, endMs) - Math.max(a, startMs)),
    0,
  )
  return { startMs, endMs, adjustedMs: Math.max(0, endMs - startMs - hold) }
}

// Ordered stage windows [(stageId, start, end)] from genuine stage transitions
// (status-change events excluded). The open final stage ends at `endMs`.
function stageWindows(
  project: Project,
  endMs: number,
): Array<{ stageId: string; start: number; end: number }> {
  const trans = (project.projectHistory ?? [])
    .filter((e): e is StageEvent => e.kind === 'stage' && !isStatusEvent(e))
    .map((e) => ({ stageId: e.stageId, at: tsToMs(e.enteredAt) }))
    .filter((e): e is { stageId: string; at: number } => e.at != null)
    .sort((a, b) => a.at - b.at)
  const windows: Array<{ stageId: string; start: number; end: number }> = []
  for (let i = 0; i < trans.length; i++) {
    const start = trans[i].at
    const end = i + 1 < trans.length ? trans[i + 1].at : endMs
    if (end > start) windows.push({ stageId: trans[i].stageId, start, end })
  }
  return windows
}

// Active (touch) time vs total elapsed, both excluding on-hold. Elapsed runs
// from first stage entry to close (or `nowMs` if still live).
export function flowEfficiency(project: Project, nowMs: number): { activeMs: number; totalMs: number } {
  const changes = statusChangeEvents(project)
  const closed = changes.find((c) => isProjectClosed(c.to))
  const endMs = closed?.at ?? nowMs
  const holds = onHoldIntervals(changes, endMs)
  let activeMs = 0
  let totalMs = 0
  for (const w of stageWindows(project, endMs)) {
    const net = Math.max(0, w.end - w.start - overlapMs(w.start, w.end, holds))
    totalMs += net
    if (stageIsActive(w.stageId, project)) activeMs += net
  }
  return { activeMs, totalMs }
}

// ─── Bucket keys ─────────────────────────────────────────────────────────────
export function quarterKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}
export function monthKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ─── Series builders (bucket across many projects) ───────────────────────────

export interface QuarterPoint {
  quarter: string
  value: number
}

// #1 Cycle-time: median adjusted cycle (days) per quarterly cohort (by createdAt).
export function cycleTimeSeries(projects: Project[]): QuarterPoint[] {
  const buckets = new Map<string, number[]>()
  for (const p of projects) {
    const ct = cycleTime(p)
    const created = tsToMs(p.createdAt)
    if (!ct || created == null) continue
    const k = quarterKey(created)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(ct.adjustedMs / DAY_MS)
  }
  return sortedKeys(buckets).map((quarter) => ({
    quarter,
    value: Math.round((median(buckets.get(quarter)!) ?? 0) * 10) / 10,
  }))
}

export interface OnTimePoint {
  month: string
  rate: number // 0..1
  onTime: number
  total: number
}

// #2 On-time submission: on-time / pursued, by month of submission.
// target = submissionDate ?? deadline. Projects with no target are unmeasurable.
export function onTimeSeries(projects: Project[]): { points: OnTimePoint[]; unmeasurable: number } {
  const buckets = new Map<string, { onTime: number; total: number }>()
  let unmeasurable = 0
  for (const p of projects) {
    const submitted = statusChangeEvents(p).find((c) => c.to === 'submitted')
    if (!submitted) continue
    const target = tsToMs(p.submissionDate) ?? tsToMs(p.deadline)
    if (target == null) {
      unmeasurable++
      continue
    }
    const k = monthKey(submitted.at)
    const b = buckets.get(k) ?? { onTime: 0, total: 0 }
    b.total++
    if (submitted.at <= target) b.onTime++
    buckets.set(k, b)
  }
  const points = sortedKeys(buckets).map((month) => {
    const b = buckets.get(month)!
    return { month, onTime: b.onTime, total: b.total, rate: b.total ? b.onTime / b.total : 0 }
  })
  return { points, unmeasurable }
}

// #3 Throughput per head: closings / distinct active actors, by quarter.
// Quarters come from the union of closings + audit activity, so early
// (pre-launch / dev-era) audit actors alone would render a leading flat-zero
// segment — leading quarters with no closings are trimmed, mirroring
// activeUsersSeries. (The project-bucketed series — cycle time, on-time,
// rework, win rate — only emit buckets that contain projects, so they never
// need this.)
export function throughputSeries(
  projects: Project[],
  audit: AuditEvent[],
): Array<{ quarter: string; closed: number; heads: number; perHead: number }> {
  const closedByQuarter = new Map<string, number>()
  for (const p of projects) {
    const closed = statusChangeEvents(p).find((c) => isProjectClosed(c.to))
    if (!closed) continue
    const k = quarterKey(closed.at)
    closedByQuarter.set(k, (closedByQuarter.get(k) ?? 0) + 1)
  }
  const headsByQuarter = new Map<string, Set<string>>()
  for (const e of audit) {
    const at = tsToMs(e.createdAt)
    if (at == null) continue
    const k = quarterKey(at)
    if (!headsByQuarter.has(k)) headsByQuarter.set(k, new Set())
    headsByQuarter.get(k)!.add(e.actorId)
  }
  const quarters = new Set([...closedByQuarter.keys(), ...headsByQuarter.keys()])
  const series = [...quarters].sort().map((quarter) => {
    const closed = closedByQuarter.get(quarter) ?? 0
    const heads = headsByQuarter.get(quarter)?.size ?? 0
    return { quarter, closed, heads, perHead: heads ? Math.round((closed / heads) * 100) / 100 : 0 }
  })
  const firstClosed = series.findIndex((p) => p.closed > 0)
  return firstClosed <= 0 ? series : series.slice(firstClosed)
}

// #4 Rework rate: mean send-backs per closed project, by quarter of close.
export function reworkSeries(projects: Project[], includeEscalations: boolean): QuarterPoint[] {
  const buckets = new Map<string, number[]>()
  for (const p of projects) {
    const closed = statusChangeEvents(p).find((c) => isProjectClosed(c.to))
    if (!closed) continue
    const sendBacks = (p.iterationCount ?? 0) + (includeEscalations ? p.escalationCount ?? 0 : 0)
    const k = quarterKey(closed.at)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(sendBacks)
  }
  return sortedKeys(buckets).map((quarter) => {
    const arr = buckets.get(quarter)!
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    return { quarter, value: Math.round(mean * 100) / 100 }
  })
}

export interface WinRatePoint {
  quarter: string
  awarded: number
  lost: number
  rate: number // 0..1
}

// #5 Win rate: wins / (wins + lost), by quarter of decision date.
// "Win" = ever reached awarded OR completed (a project can be closed straight
// to completed, skipping the awarded step). Decision date = the EARLIEST
// win-signalling event, so awarded→completed counts once, in the awarded
// quarter.
export function winRateSeries(projects: Project[]): WinRatePoint[] {
  const buckets = new Map<string, { awarded: number; lost: number }>()
  for (const p of projects) {
    const changes = statusChangeEvents(p)
    const win = changes.find((c) => c.to === 'awarded' || c.to === 'completed')
    const lost = changes.find((c) => c.to === 'lost')
    if (win) {
      const b = buckets.get(quarterKey(win.at)) ?? { awarded: 0, lost: 0 }
      b.awarded++
      buckets.set(quarterKey(win.at), b)
    } else if (lost) {
      const b = buckets.get(quarterKey(lost.at)) ?? { awarded: 0, lost: 0 }
      b.lost++
      buckets.set(quarterKey(lost.at), b)
    }
  }
  return sortedKeys(buckets).map((quarter) => {
    const b = buckets.get(quarter)!
    const denom = b.awarded + b.lost
    return { quarter, awarded: b.awarded, lost: b.lost, rate: denom ? b.awarded / denom : 0 }
  })
}

// #6 Team flow efficiency: active% per team, aggregated over the window.
export function teamFlowEfficiency(
  projects: Project[],
  teams: Array<{ id: string; name: string }>,
  nowMs: number,
): Array<{ teamId: string; teamName: string; efficiency: number }> {
  const agg = new Map<string, { active: number; total: number }>()
  for (const p of projects) {
    const eff = flowEfficiency(p, nowMs)
    if (eff.totalMs <= 0) continue
    for (const teamId of p.teamIds ?? []) {
      const a = agg.get(teamId) ?? { active: 0, total: 0 }
      a.active += eff.activeMs
      a.total += eff.totalMs
      agg.set(teamId, a)
    }
  }
  const nameById = new Map(teams.map((t) => [t.id, t.name]))
  return [...agg.entries()]
    .map(([teamId, a]) => ({
      teamId,
      teamName: nameById.get(teamId) ?? teamId,
      efficiency: a.total ? a.active / a.total : 0,
    }))
    .sort((a, b) => b.efficiency - a.efficiency)
}

export interface UserStats {
  total: number
  active: number
  rate: number // 0..1
}

// #7 Total vs active users (current month).
// active = distinct auditEvents.actorId since monthStartMs that map to a real
// user doc.
export function userStats(
  users: Array<{ uid: string }>,
  audit: AuditEvent[],
  monthStartMs: number,
): UserStats {
  const uids = new Set(users.map((u) => u.uid))
  const active = new Set<string>()
  for (const e of audit) {
    const at = tsToMs(e.createdAt)
    if (at != null && at >= monthStartMs && uids.has(e.actorId)) active.add(e.actorId)
  }
  return {
    total: users.length,
    active: active.size,
    rate: users.length ? active.size / users.length : 0,
  }
}

export interface ActiveUsersPoint {
  month: string
  active: number
  onboarded: number
  rate: number // 0..1 — active ÷ users onboarded by that month's end
}

// #7 (trend) Adoption trajectory: distinct actors per month ÷ how many users
// were onboarded by that month's end (user.createdAt), over [windowStartMs, nowMs].
// LEADING months with no activity are trimmed — a portal that went live recently
// shouldn't render a dead flat-line back to the window start. Zero months AFTER
// first activity still appear (a real dip is signal, not noise).
export function activeUsersSeries(
  users: Array<{ uid: string; createdAt?: unknown }>,
  audit: AuditEvent[],
  windowStartMs: number,
  nowMs: number,
): ActiveUsersPoint[] {
  const uids = new Set(users.map((u) => u.uid))
  const activeByMonth = new Map<string, Set<string>>()
  for (const e of audit) {
    const at = tsToMs(e.createdAt)
    if (at == null || at < windowStartMs || !uids.has(e.actorId)) continue
    const k = monthKey(at)
    if (!activeByMonth.has(k)) activeByMonth.set(k, new Set())
    activeByMonth.get(k)!.add(e.actorId)
  }
  const onboardedAts = users
    .map((u) => tsToMs(u.createdAt))
    .filter((ms): ms is number => ms != null)

  const out: ActiveUsersPoint[] = []
  const cursor = new Date(windowStartMs)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= nowMs) {
    const k = monthKey(cursor.getTime())
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime()
    const onboarded = onboardedAts.filter((ms) => ms < monthEnd).length
    const active = activeByMonth.get(k)?.size ?? 0
    out.push({ month: k, active, onboarded, rate: onboarded ? active / onboarded : 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const firstActive = out.findIndex((p) => p.active > 0)
  return firstActive <= 0 ? out : out.slice(firstActive)
}

function sortedKeys<T>(m: Map<string, T>): string[] {
  return [...m.keys()].sort()
}
