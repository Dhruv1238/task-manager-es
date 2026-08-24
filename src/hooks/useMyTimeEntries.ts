import { useEffect, useState } from 'react'
import { getDocs, orderBy, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { TimeEntry } from '../types/models'

/**
 * One person's recent time log, for the "My time" section on /me
 * (features.timeTracking).
 *
 * Fetches only when `enabled` flips true (i.e. the section is expanded), so a
 * collapsed section costs nothing — the useTaskAuditEvents pattern. One-shot
 * rather than live: this is a summary of work already recorded, and the task
 * detail section is where entries get written.
 *
 * Callers pass the *effective* uid (AuthContext.effectiveUid) so a sandbox
 * persona sees that persona's own time rather than the signed-in visitor's.
 *
 * Needs the composite index timeEntries(uid ASC, dateKey DESC); until it is
 * deployed the query throws failed-precondition (surfaced as `error`).
 */
export function useMyTimeEntries(uid: string | null | undefined, from: string, enabled: boolean) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !uid || !from) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const q = query(
      tenantCol('timeEntries'),
      where('uid', '==', uid),
      where('dateKey', '>=', from),
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
        setError(e instanceof Error ? e.message : 'Failed to load your time entries')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [uid, from, enabled])

  return { entries, loading, error }
}
