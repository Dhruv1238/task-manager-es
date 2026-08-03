import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

/**
 * How long the paper layout is held on screen before the dialog opens. The
 * page has to relayout at --print-w and Recharts has to re-measure and re-emit
 * its <svg> at the new size; none of that runs once the print pass starts.
 *
 * Chart animation is switched off for the duration (see usePrintMode), so this
 * only has to cover a reflow and a React commit — without that it would need
 * to outlast Recharts' 1500ms line transition, or the PDF would capture the
 * line mid-flight, part-way to its new position.
 */
const PREPARE_MS = 600

// ── Print-mode store ────────────────────────────────────────────────────────
// A module-level flag rather than context: the only consumers are leaf chart
// components, and threading a provider through every report page to tell them
// "we are printing" would be a lot of plumbing for one boolean.
let printing = false
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function getSnapshot() {
  return printing
}
function setPrinting(next: boolean) {
  if (printing === next) return
  printing = next
  listeners.forEach((fn) => fn())
}

/**
 * True while a print is being prepared. Charts read this to render their final
 * state immediately instead of animating into it — an animation that is still
 * running when the print pass begins is frozen mid-transition in the PDF.
 */
export function usePrintMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ── Timestamps ──────────────────────────────────────────────────────────────
// One Date, two renderings: a readable one for the footer and a
// filesystem-safe one for the download name (colons and slashes are illegal in
// filenames on Windows and awkward on macOS).
function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    display: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    file: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`,
  }
}

/**
 * Makes the current page print cleanly to the browser's PDF writer.
 *
 * Two things have to happen before the print pass that CSS alone can't do:
 *
 *  - **Force the light palette.** The default theme paints near-white text on a
 *    dark canvas, and browsers drop background colours when printing — a dark
 *    page comes out as invisible text on white paper. Swapping the existing
 *    `.light` class on <html> reuses the real light theme rather than a
 *    duplicated set of print-only tokens that would drift.
 *  - **Open every <details>.** A collapsed "How these are calculated" prints as
 *    a bare heading, silently dropping the methodology from the PDF.
 *
 * Both are undone as soon as the dialog closes. Listeners cover Ctrl/Cmd-P too,
 * not just the button — Safari fires neither beforeprint nor afterprint, so the
 * print media query is watched as well.
 *
 * `print()` adds the steps the events can't provide: it suppresses chart
 * animation, switches the page to the paper layout (`html.printing`) and waits
 * PREPARE_MS so Recharts can settle at the new geometry. Callers should render
 * a <PrintingOverlay /> while `preparing` is true — the wait is unavoidable, so
 * it may as well be legible, and the overlay also hides the reflow.
 *
 * `docTitle` names the download: browsers seed the Save-as-PDF filename from
 * document.title, so it is swapped to `<docTitle> <timestamp>` for the
 * duration and restored afterwards.
 *
 * Everything else (hiding chrome, page geometry, page breaks) is in the
 * `@media print` block in index.css. Mark on-screen-only controls `no-print`.
 */
export function usePrintable(docTitle: string): {
  print: () => void
  preparing: boolean
  generatedAt: string | null
} {
  const [preparing, setPreparing] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    const root = document.documentElement
    let restore: (() => void) | null = null

    const prepare = () => {
      if (restore) return // already prepared — events can double-fire
      const wasLight = root.classList.contains('light')
      root.classList.add('light')
      const opened = Array.from(document.querySelectorAll('details:not([open])'))
      opened.forEach((d) => d.setAttribute('open', ''))

      // Stamped here rather than in print() so Ctrl/Cmd-P gets a correct
      // filename and footer too. flushSync because beforeprint runs
      // immediately before the print pass — a batched update would not be
      // committed in time and the footer would print without its timestamp.
      const { display, file } = stamp(new Date())
      const prevTitle = document.title
      document.title = `${docTitle} ${file}`
      flushSync(() => setGeneratedAt(display))

      restore = () => {
        if (!wasLight) root.classList.remove('light')
        opened.forEach((d) => d.removeAttribute('open'))
        document.title = prevTitle
        restore = null
      }
    }
    const cleanup = () => restore?.()

    window.addEventListener('beforeprint', prepare)
    window.addEventListener('afterprint', cleanup)
    const mq = window.matchMedia('print')
    const onMq = (e: MediaQueryListEvent) => (e.matches ? prepare() : cleanup())
    mq.addEventListener('change', onMq)

    return () => {
      window.removeEventListener('beforeprint', prepare)
      window.removeEventListener('afterprint', cleanup)
      mq.removeEventListener('change', onMq)
      cleanup() // never leave a forced theme (or title) behind on unmount
      setPrinting(false)
    }
  }, [docTitle])

  const print = useCallback(async () => {
    if (printing) return
    const root = document.documentElement
    // Order matters: kill animation first, so the relayout that follows lands
    // the chart on its final geometry in a single commit.
    setPrinting(true)
    setPreparing(true)
    root.classList.add('printing')
    try {
      await new Promise((r) => setTimeout(r, PREPARE_MS))
      window.print() // blocks until the dialog is dismissed
    } finally {
      root.classList.remove('printing')
      setPreparing(false)
      setPrinting(false)
    }
  }, [])

  return { print, preparing, generatedAt }
}
