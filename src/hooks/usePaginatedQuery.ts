import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocs,
  type Query,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'

type BuildQuery = (cursor: QueryDocumentSnapshot<DocumentData> | null) => Query<DocumentData> | null

interface Result<T> {
  items: T[]
  setItems: React.Dispatch<React.SetStateAction<T[]>>
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  error: Error | null
}

// Cursor-paginated query hook. The caller builds the Firestore query (including
// any limit(N), where(), orderBy(), and startAfter(cursor) clauses); we just
// stitch successive pages together and reset when `deps` change.
export function usePaginatedQuery<T>(
  buildQuery: BuildQuery,
  pageSize: number,
  deps: ReadonlyArray<unknown>,
  mapDoc: (snap: QueryDocumentSnapshot<DocumentData>) => T,
): Result<T> {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const reqIdRef = useRef(0)
  // Held in refs so the memoized fetchPage below always sees the latest
  // closures — otherwise the captured buildQuery goes stale on every search /
  // filter / sort change, and the query that actually fires is whatever the
  // caller's state was on first render.
  const buildQueryRef = useRef(buildQuery)
  const mapDocRef = useRef(mapDoc)
  useEffect(() => {
    buildQueryRef.current = buildQuery
    mapDocRef.current = mapDoc
  })

  const fetchPage = useCallback(
    async (mode: 'reset' | 'append') => {
      const reqId = ++reqIdRef.current
      const cursor = mode === 'append' ? cursorRef.current : null
      const q = buildQueryRef.current(cursor)
      if (!q) {
        if (mode === 'reset') {
          setItems([])
          setHasMore(false)
          setLoading(false)
        }
        return
      }
      if (mode === 'reset') {
        // Keep existing items rendered while the new query is in-flight to avoid
        // a flicker on every search/filter change. They get replaced atomically
        // when the new batch arrives in the try block below.
        setLoading(true)
        cursorRef.current = null
      } else {
        setLoadingMore(true)
      }
      try {
        const snap = await getDocs(q)
        if (reqId !== reqIdRef.current) return // a newer request superseded this one
        const next = snap.docs.map(mapDocRef.current)
        setItems((prev) => (mode === 'append' ? [...prev, ...next] : next))
        cursorRef.current = snap.docs.length ? snap.docs[snap.docs.length - 1] : cursorRef.current
        setHasMore(snap.docs.length === pageSize)
        setError(null)
      } catch (e) {
        if (reqId !== reqIdRef.current) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setHasMore(false)
      } finally {
        if (reqId === reqIdRef.current) {
          if (mode === 'reset') setLoading(false)
          else setLoadingMore(false)
        }
      }
    },
    // buildQuery is read through a ref (above) so deps only need pageSize.
    [pageSize],
  )

  useEffect(() => {
    // Data fetching driven by dep changes — set-state-in-effect is expected here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage('reset')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return
    fetchPage('append')
  }, [fetchPage, hasMore, loading, loadingMore])

  return { items, setItems, loading, loadingMore, hasMore, loadMore, error }
}
