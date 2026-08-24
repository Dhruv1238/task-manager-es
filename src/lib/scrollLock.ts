/**
 * Ref-counted body scroll lock, shared by every overlay that suppresses page
 * scrolling (Modal, the mobile nav drawer, ProjectHistorySidePanel).
 *
 * Why not save-and-restore (`const prev = body.style.overflow` … restore)?
 * Overlays here NEST — a task opened as an overlay route is a Modal, and
 * submit-for-review / add-subtask / duplicate open a second Modal on top of
 * it. With save-and-restore, the inner lock captures 'hidden' as its
 * "previous" value; release the locks in the wrong order (or let an effect
 * re-run mid-overlap — Modal's lock used to churn on every unstable onClose
 * identity) and the final cleanup restores 'hidden' onto <body>. That inline
 * style survives SPA navigation, so every page stops scrolling until a full
 * reload wipes it.
 *
 * Counting fixes all of it: the body locks when the first lock is acquired,
 * unlocks only when the LAST one releases, and release order is irrelevant.
 * Restoring to '' (not a captured value) is correct because nothing else in
 * the app writes an inline overflow on <body> — the stylesheet default takes
 * back over.
 */

let count = 0

export function acquireScrollLock(): () => void {
  count += 1
  if (count === 1) document.body.style.overflow = 'hidden'
  let released = false
  return () => {
    // Idempotent: React StrictMode double-invokes cleanups in dev, and a
    // double release must not steal another overlay's lock.
    if (released) return
    released = true
    count -= 1
    if (count === 0) document.body.style.overflow = ''
  }
}
