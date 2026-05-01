import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Task } from '../types/models'

// Tasks where I am the named reviewer and the task is in_review (delta §7.1).
// Single-collection query; rendering happens in the /me "Awaiting my review" section.
// Add the index manually in Firebase console: tasks (reviewerId asc, status asc).
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
      collection(db, 'tasks'),
      where('reviewerId', '==', uid),
      where('status', '==', 'in_review'),
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
