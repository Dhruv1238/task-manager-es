import { useEffect, useState } from 'react'
import { getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { AuditEvent } from '../types/models'

const FETCH_LIMIT = 30

/**
 * One-time reader for a single task's audit trail (its Activity timeline).
 * Reuses the append-only auditEvents collection — no new writes. Fetches only
 * when `enabled` flips true (i.e. the Activity section is expanded), so the
 * cost is one getDocs of <=30 docs per task-detail open, and zero before that.
 *
 * Needs the composite index auditEvents(targetId ASC, createdAt DESC); until it
 * is deployed the query throws failed-precondition (surfaced as an error state).
 */
export function useTaskAuditEvents(taskId: string, enabled: boolean) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const q = query(
      tenantCol('auditEvents'),
      where('targetId', '==', taskId),
      orderBy('createdAt', 'desc'),
      limit(FETCH_LIMIT),
    )
    getDocs(q)
      .then((snap) => {
        if (cancelled) return
        setEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditEvent, 'id'>) })))
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load activity')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId, enabled])

  return { events, loading, error }
}
