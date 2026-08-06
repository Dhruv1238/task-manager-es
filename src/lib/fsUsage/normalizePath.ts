/**
 * Path attribution for the usage watchdog — pure, no firebase imports.
 *
 * Ops are attributed to a normalized COLLECTION PATTERN, never a concrete doc
 * path: doc-id segments become '*', doc paths collapse to their parent
 * collection, and the sandbox visitor prefix (sandbox/{uid}/…) is stripped so
 * sandbox traffic aggregates under the same keys as production.
 *
 * DocumentReference / CollectionReference expose `.path` publicly, so refs
 * need no bookkeeping — including refs obtained from snapshot.docs[i].ref and
 * inside transactions. Query objects expose no path, so the wrapper tags them
 * here (WeakMap: no leaks, queries are short-lived).
 */

const queryTags = new WeakMap<object, string>()

export function normalizePath(path: string): string {
  const raw = path.split('/').filter(Boolean)
  // sandbox/{visitorUid}/<real path…> → <real path…>
  const segs = raw[0] === 'sandbox' && raw.length >= 3 ? raw.slice(2) : raw
  const out = segs.map((s, i) => (i % 2 === 1 ? '*' : s))
  // Even segment count = a document path — attribute to the parent collection.
  if (out.length % 2 === 0 && out.length > 0) out.pop()
  return out.join('/') || '(root)'
}

export function tagQuery(q: object, tag: string): void {
  queryTags.set(q, tag)
}

/**
 * The collection pattern for any read/write target: a ref (has a public
 * string `.path`), a previously-tagged Query, or '(unknown)'.
 */
export function getTag(target: unknown): string {
  if (target && typeof target === 'object') {
    const path = (target as { path?: unknown }).path
    if (typeof path === 'string') return normalizePath(path)
    const tagged = queryTags.get(target)
    if (tagged) return tagged
  }
  return '(unknown)'
}
