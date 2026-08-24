import { useEffect, useState } from 'react'
import { limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { TimeEntry } from '../types/models'

// A single task accumulates a handful of entries, not a feed. The cap is a
// runaway guard, not pagination.
const FETCH_LIMIT = 100

/**
 * Live reader for one task's time log (features.timeTracking).
 *
 * Subscribes rather than fetching once because this hook backs a section that
 * also *writes*: a just-logged entry, an edit and a delete all have to appear
 * without refetch plumbing. Cost is one listener per open task detail — the
 * same class as the comments listener the page already holds.
 *
 * The feature gate lives at the call site: TaskDetailContent only renders the
 * section (and so only mounts this hook) when the flag is on or the task
 * already has logged time, so a tenant with the flag off pays zero reads.
 *
 * Needs the composite index timeEntries(taskId ASC, createdAt DESC); until it
 * is deployed the query throws failed-precondition (surfaced as `error`).
 */
export function useTaskTimeEntries(taskId: string | undefined) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!taskId) {
      setEntries([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const q = query(
      tenantCol('timeEntries'),
      where('taskId', '==', taskId),
      orderBy('createdAt', 'desc'),
      limit(FETCH_LIMIT),
    )
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ ...(d.data() as Omit<TimeEntry, 'id'>), id: d.id })))
        setLoading(false)
      },
      (e) => {
        setError(e instanceof Error ? e.message : 'Failed to load time entries')
        setLoading(false)
      },
    )
  }, [taskId])

  return { entries, loading, error }
}
