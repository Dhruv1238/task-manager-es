import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Task } from '../types/models'

// Live subscription to every task in Firestore. Used only by the admin dashboard
// (Flow 9 / §10.4) where org-wide aggregation is required. Don't use elsewhere —
// scoped hooks keep reads bounded everywhere else.
export function useAllTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    return onSnapshot(
      collection(db, 'tasks'),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id })))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
  }, [])

  return { tasks, loading, error }
}