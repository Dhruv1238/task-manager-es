import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Task } from '../types/models'

// Firestore will prompt (once) for a composite index on: parentTaskId, createdAt.
export function useSubtasks(parentTaskId: string | undefined) {
  const [subtasks, setSubtasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!parentTaskId) {
      setSubtasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      collection(db, 'tasks'),
      where('parentTaskId', '==', parentTaskId),
      orderBy('createdAt', 'asc'),
    )
    return onSnapshot(
      q,
      (snap) => {
        setSubtasks(snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id })))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
  }, [parentTaskId])

  return { subtasks, loading, error }
}