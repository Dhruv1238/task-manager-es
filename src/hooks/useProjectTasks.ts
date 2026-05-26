import { useEffect, useState } from 'react'
import {  onSnapshot, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Task } from '../types/models'

// Live subscription to every team-level task (parentTaskId === null) on a given project.
// Used for project and per-team progress aggregation on the project page.
// Firestore may prompt for a composite index on (projectId, parentTaskId).
export function useProjectTasks(projectId: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      tenantCol('tasks'),
      where('projectId', '==', projectId),
      where('parentTaskId', '==', null),
    )
    return onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id })))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
  }, [projectId])

  return { tasks, loading, error }
}
