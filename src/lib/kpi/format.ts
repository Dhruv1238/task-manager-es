// Display formatters shared by the KPI surfaces. Kept out of the component
// files so those stay component-only exports (react-refresh).

// 0..1 → '82%'. Null/undefined render as an em dash rather than '0%', so "no
// data" never reads as a real zero.
export function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

// 'YYYY-MM' → 'Aug 2026'.
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' })
}

// ms → 'Aug 14, 3:12 PM'. Absolute, not relative: the active-users drill-down
// can be scoped to a past month, where "3d ago" would be nonsense.
export function dayTime(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// 'project.stage_transitioned' → 'Stage transitioned'. The audit action union is
// machine-facing; this is the shortest honest rendering for the drill-down's
// "last action" column.
export function auditActionLabel(action: string | undefined): string {
  if (!action) return '—'
  const leaf = action.slice(action.indexOf('.') + 1).replace(/_/g, ' ')
  return leaf.charAt(0).toUpperCase() + leaf.slice(1)
}
