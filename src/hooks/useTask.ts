import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Task } from '../types/models'

export function useTask(taskId: string | undefined) {
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      setLoading(false)
      return
    }
    setLoading(true)
    return onSnapshot(
      doc(db, 'tasks', taskId),
      (snap) => {
        setTask(snap.exists() ? ({ ...(snap.data() as Task), id: snap.id }) : null)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [taskId])

  return { task, loading }
}