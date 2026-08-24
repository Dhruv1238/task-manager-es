import { useCallback, useEffect, useState } from 'react'
import { getDocs, orderBy, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { TimeEntry } from '../types/models'

/**
 * Windowed, one-time reader for the time report (features.timeTracking).
 *
 * Reports are not real-time, so this is a `getDocs` fetch rather than a
 * subscription — the same reasoning as useAuditEvents: a listener would
 * re-stream and re-pivot the whole window on every unrelated write.
 *
 * The date range is the ONLY server-side filter. Person, project and all five
 * group-by modes are applied in memory by lib/timeReport, so changing any of
 * them costs zero further reads; only moving the window refetches.
 *
 * `dateKey` is a plain 'YYYY-MM-DD' string, so the range plus its orderBy is a
 * single-field query — no composite index required.
 */
export function useTimeReport(from: string, to: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped to refetch the same window on demand (after the report's own writes
  // land, or via Refresh) without widening the query.
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    // An inverted or half-entered range would scan nothing useful; skip the trip.
    if (!from || !to || from > to) {
      setEntries([])
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const q = query(
      tenantCol('timeEntries'),
      where('dateKey', '>=', from),
      where('dateKey', '<=', to),
      orderBy('dateKey', 'desc'),
    )
    getDocs(q)
      .then((snap) => {
        if (cancelled) return
        setEntries(snap.docs.map((d) => ({ ...(d.data() as Omit<TimeEntry, 'id'>), id: d.id })))
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load time entries')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to, nonce])

  return { entries, loading, error, refresh }
}
