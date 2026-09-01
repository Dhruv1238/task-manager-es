import { useEffect, useState } from 'react'
import {  onSnapshot, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import { REVIEW_STATUSES } from '../lib/taskStatus'
import type { Task } from '../types/models'

// Tasks where I am the named reviewer and the task is in the review pipeline
// (in_review, or in_uat under the tech status set) — delta §7.1. Deliberately
// flag-independent: a leftover in_uat task must stay in its reviewer's queue
// after the tech set is switched off. Single-collection query; rendering
// happens in the /me "Awaiting my review" section.
// Add the index manually in Firebase console: tasks (reviewerId asc, status asc)
// — the same composite serves this `in` query.
export function useMyReviewQueue(uid: string | null | undefined): {
  tasks: Task[]
  loading: boolean
  error: string | null
} {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(uid))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      tenantCol('tasks'),
      where('reviewerId', '==', uid),
      where('status', 'in', REVIEW_STATUSES),
    )
    return onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id })))
        setLoading(false)
        setError(null)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
  }, [uid])

  return { tasks, loading, error }
}
