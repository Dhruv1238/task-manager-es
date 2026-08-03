/**
 * Per-sheet footer: source URL, generation time and page number. Print-only —
 * hidden on screen by the `print-only` utility.
 *
 * Page numbers are passed in rather than derived. Chrome does not implement
 * CSS `@page` margin boxes, so `counter(page)` is unavailable, and the native
 * header/footer that would supply one only renders when the sheet has a page
 * margin — which would band the full-bleed report in white. Hardcoding is
 * sound here because pagination is deterministic: `.kpi-print-defs` carries
 * `break-before: page`, so the report is exactly one sheet of charts plus one
 * of definitions.
 */
export default function PrintFooter({
  page,
  of,
  generatedAt,
}: {
  page: number
  of: number
  generatedAt: string | null
}) {
  return (
    <div className="print-only kpi-print-footer mt-6 items-baseline justify-between gap-4 border-t border-line pt-2 text-[10px] text-fg-subtle">
      <span className="truncate">{window.location.href}</span>
      {generatedAt && <span className="shrink-0">Generated {generatedAt}</span>}
      <span className="shrink-0">
        Page {page} of {of}
      </span>
    </div>
  )
}
