/**
 * Shown while usePrintable holds the page in its paper layout waiting for the
 * charts to settle. Two jobs: tell the user the pause is deliberate, and hide
 * the reflow to print geometry happening underneath — the scrim is heavy
 * enough that the page visibly resizing behind it doesn't read as a glitch,
 * which a light blur alone did not achieve.
 *
 * `no-print` is load-bearing: without it the overlay would land in the PDF.
 */
export default function PrintingOverlay() {
  return (
    <div
      className="no-print fixed inset-0 z-100 flex items-center justify-center bg-canvas/90 backdrop-blur-2xl backdrop-saturate-150"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-elevated px-5 py-4 shadow-2xl">
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong"
          aria-hidden
        />
        <span className="text-sm font-medium text-fg">Generating PDF…</span>
      </div>
    </div>
  )
}
