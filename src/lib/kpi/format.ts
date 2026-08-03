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
