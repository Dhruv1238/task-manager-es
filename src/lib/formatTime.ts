import type { Timestamp } from 'firebase/firestore'

// Compact relative time formatter shared by chat, project history, etc.
// Falls back to absolute date once the gap crosses two weeks.
export function fmtRelative(ts: Timestamp | null | undefined): string {
  if (!ts) return ''
  const date = ts.toDate()
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Clock-style time for the same-day rendering inside a chat thread ("10:14 AM").
export function fmtClock(ts: Timestamp | null | undefined): string {
  if (!ts) return ''
  return ts
    .toDate()
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
