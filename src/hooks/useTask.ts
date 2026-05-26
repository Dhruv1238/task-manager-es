import { useEffect, useState } from 'react'
import {  onSnapshot } from 'firebase/firestore'
import { tenantDoc } from '../lib/firestore'
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
      tenantDoc('tasks', taskId),
      (snap) => {
        setTask(snap.exists() ? ({ ...(snap.data() as Task), id: snap.id }) : null)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [taskId])

  return { task, loading }
}