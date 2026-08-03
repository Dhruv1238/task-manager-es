import type { ReactNode } from 'react'

/**
 * Shared chrome for the "How these are calculated" disclosure — the shell only.
 * Each page supplies its own <li> entries, in the order its cards appear above,
 * so the two report pages can explain different card sets.
 */
export default function KpiDefinitions({
  children,
  footer,
}: {
  children: ReactNode
  // Rendered inside the print wrapper, after the card — so the per-sheet
  // footer is pinned to the bottom of the definitions sheet, not trapped
  // inside the <ul> with the definition entries.
  footer?: ReactNode
}) {
  return (
    // The wrapper exists for print: it starts a fresh sheet and its padding-top
    // becomes the gap above the card. A margin would be dropped at the page
    // break; padding on a box that begins the page is kept.
    <div className="kpi-print-defs">
      <details className="mt-6 rounded-2xl border border-line bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-fg-muted">
          How these are calculated
        </summary>
        <p className="mt-3 text-xs text-fg-subtle">
          Scope: collaborative (tender) projects only. All timings come from each project's own
          history — the timestamp recorded every time its status or stage changed.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg-subtle">{children}</ul>
      </details>
      {footer}
    </div>
  )
}
