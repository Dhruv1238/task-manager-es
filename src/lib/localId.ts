// Phase 2d: pure, collision-free local id for editor-created items (roles,
// fields, options, statuses). Scans existing ids for `<prefix>_<n>` and returns
// the next free number. Pure (no Math.random / Date) so it satisfies the
// react-hooks/purity rule, deterministic, and frozen at creation.
export function nextLocalId(prefix: string, existing: ReadonlyArray<{ id: string }>): string {
  let max = 0
  const re = new RegExp(`^${prefix}_(\\d+)$`)
  for (const e of existing) {
    const m = re.exec(e.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}_${max + 1}`
}
