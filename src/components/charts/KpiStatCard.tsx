import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

// Single headline number (no plot) — the hero tile for a KPI. Delta and tone
// are optional; tone tints only the delta, never the main value. `info` adds an
// ⓘ affordance whose plain-language definition surfaces on hover/focus, and
// `control` takes a compact per-tile scope picker (e.g. a month <select>) in
// the header, left of that ⓘ. `action` sits under the sub-label for a
// drill-down affordance (e.g. "View the 41 people") — kept out of the card's
// click target so it never fights the header control.
interface Props {
  label: string
  value: string
  sub?: string
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean }
  info?: string
  control?: ReactNode
  action?: ReactNode
}

export default function KpiStatCard({
  label,
  value,
  sub,
  delta,
  info,
  control,
  action,
}: Props) {
  const deltaColor =
    delta?.good === undefined
      ? 'text-fg-subtle'
      : delta.good
        ? 'text-success-dot'
        : 'text-danger-dot'
  const arrow = delta?.direction === 'up' ? '▲' : delta?.direction === 'down' ? '▼' : '→'
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</h3>
        <div className="flex shrink-0 items-start gap-1.5">
          {control}
          {info && (
            <span className="group relative shrink-0">
              <button
                type="button"
                aria-label={`What does ${label} mean?`}
                className="rounded-full p-0.5 text-fg-faint transition hover:text-fg-muted focus-visible:text-fg-muted"
              >
                <Info size={14} aria-hidden />
              </button>
              <span className="pointer-events-none absolute right-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-line bg-elevated p-3 text-xs font-normal normal-case tracking-normal text-fg-muted opacity-0 shadow-2xl transition group-hover:opacity-100 group-focus-within:opacity-100">
                {info}
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-fg">{value}</span>
        {delta && (
          <span className={`text-xs font-medium ${deltaColor}`}>
            {arrow} {delta.value}
          </span>
        )}
      </div>
      {sub && <p className="mt-1 text-xs text-fg-subtle">{sub}</p>}
      {action && <div className="no-print mt-2.5">{action}</div>}
    </div>
  )
}
