// Phase 2d: dependency-free reorder helper backing the up/down chevron controls
// in the roles / fields / statuses editors (the codebase deliberately ships no
// drag-and-drop dependency — see StageFlow's nudge buttons). Returns a NEW array
// with the item at `index` moved by `dir` (-1 up, +1 down) and every element's
// `order` renumbered to its 0-based position. No-op when the move falls off an
// end.
export function reorder<T extends { order: number }>(arr: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir
  if (target < 0 || target >= arr.length) return arr
  const next = [...arr]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next.map((item, i) => ({ ...item, order: i }))
}
