import type { ReactNode } from 'react'
import { Printer } from 'lucide-react'

/**
 * Shared chrome for the KPI report pages: eyebrow + title + blurb, the demo
 * data toggle, and the warning banner demo mode raises. Kept in one place so
 * KPI Reports and Usage Analytics open identically.
 *
 * Pass `onPrint` to add a Print / PDF button. Both buttons are `no-print`, so
 * the PDF opens on the title rather than on a pair of dead controls.
 */
export default function KpiPageHeader({
  title,
  description,
  demoMode,
  onToggleDemo,
  onPrint,
}: {
  title: string
  description: ReactNode
  demoMode: boolean
  onToggleDemo: () => void
  onPrint?: () => void
}) {
  return (
    <>
      <div className="kpi-print-header mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-fg-subtle">Admin</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-2 max-w-2xl text-fg-muted">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="no-print flex shrink-0 items-center gap-2 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4"
            >
              <Printer size={16} aria-hidden />
              Print / PDF
            </button>
          )}
          <button
            type="button"
            onClick={onToggleDemo}
            className={
              demoMode
                ? 'no-print shrink-0 rounded-lg border border-tone-warn-bd bg-tone-warn-bg px-4 py-2 text-sm font-medium text-tone-warn-fg transition hover:opacity-90'
                : 'no-print shrink-0 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4'
            }
          >
            {demoMode ? 'Exit demo data' : 'Populate demo data'}
          </button>
        </div>
      </div>

      {demoMode && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-tone-warn-bd bg-tone-warn-bg px-4 py-3 text-sm text-tone-warn-fg">
          <span aria-hidden>⚠</span>
          <span>
            <b>Demo data.</b> Every number below is synthetic (generated in your browser — nothing
            is saved). Exit demo to return to real portal data.
          </span>
        </div>
      )}
    </>
  )
}
