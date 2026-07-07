import { useEffect, useState } from 'react'
import { getDocs, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { AuditEvent } from '../types/models'

/**
 * Windowed, one-time reader for the auditEvents collection. Reports are not
 * real-time, so a `getDocs` fetch (not an onSnapshot subscription) avoids
 * re-streaming + recomputing on every unrelated write. `windowStartMs` bounds
 * the read so this scales with the reporting window, not all-time history.
 */
export function useAuditEvents(windowStartMs: number) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const q = query(
      tenantCol('auditEvents'),
      where('createdAt', '>=', Timestamp.fromMillis(windowStartMs)),
      orderBy('createdAt', 'desc'),
    )
    getDocs(q)
      .then((snap) => {
        if (cancelled) return
        setEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditEvent, 'id'>) })))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [windowStartMs])

  return { events, loading }
}
