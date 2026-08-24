/**
 * Duration + calendar-day helpers for time tracking (features.timeTracking).
 *
 * Two deliberate choices encoded here:
 *
 * 1. Minutes are the canonical unit. The composer collects whole hours and
 *    whole minutes, so there is no free-form parsing to get wrong and no
 *    rounding to reconcile — `composeMinutes` is the only way a total is built.
 *
 * 2. A work day is a `dateKey` string ('YYYY-MM-DD'), never a Timestamp. It is
 *    a calendar day the user declared, not an instant, so it has no timezone to
 *    normalise. Every conversion here therefore goes through LOCAL date parts —
 *    `new Date('2026-08-24')` would parse as UTC midnight and render as the
 *    23rd for anyone west of UTC.
 */

const MINUTES_PER_HOUR = 60

/** Whole hours + whole minutes → canonical total. Clamps junk to 0. */
export function composeMinutes(hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.trunc(hours)) : 0
  const m = Number.isFinite(minutes) ? Math.max(0, Math.trunc(minutes)) : 0
  return h * MINUTES_PER_HOUR + m
}

/** Canonical total → the composer's two fields (used to prefill an edit). */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0
  return { hours: Math.floor(t / MINUTES_PER_HOUR), minutes: t % MINUTES_PER_HOUR }
}

/** 95 → '1h 35m', 60 → '1h', 45 → '45m', 0 → '0m'. */
export function formatDuration(total: number | null | undefined): string {
  const t = typeof total === 'number' && Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0
  const { hours, minutes } = splitMinutes(t)
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Local calendar day of `date` as 'YYYY-MM-DD'. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today in the viewer's own timezone — the composer's default work day. */
export function todayDateKey(): string {
  return toDateKey(new Date())
}

/** First day of the current local month — the report's default window start. */
export function monthStartDateKey(): string {
  const now = new Date()
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), 1))
}

/**
 * Shift a dateKey by whole days, honouring local DST via the Date constructor's
 * day overflow (e.g. shiftDateKey('2026-03-01', -1) → '2026-02-28').
 */
export function shiftDateKey(key: string, days: number): string {
  const parsed = parseDateKey(key)
  if (!parsed) return key
  parsed.setDate(parsed.getDate() + days)
  return toDateKey(parsed)
}

/** 'YYYY-MM-DD' → a LOCAL midnight Date, or null when malformed. */
export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  // Reject calendar-invalid input that Date would silently roll over
  // ('2026-02-31' → Mar 3).
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null
  return date
}

/**
 * 'Aug 24' for a day in the current year, 'Aug 24, 2025' otherwise — a report
 * window can span a year boundary, where a bare day is ambiguous. Malformed
 * keys render verbatim rather than as 'Invalid Date'.
 */
export function formatDateKey(key: string): string {
  const date = parseDateKey(key)
  if (!date) return key
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
