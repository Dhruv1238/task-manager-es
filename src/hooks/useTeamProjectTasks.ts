import { useEffect, useState } from 'react'
import {
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Task } from '../types/models'

// Live subscription to every task (team-level parent + subtasks) for a given (project, team) pair.
// Firestore will prompt (once) to create a composite index on: projectId, teamId, createdAt.
export function useTeamProjectTasks(
  projectId: string | undefined,
  teamId: string | undefined,
) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !teamId) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      tenantCol('tasks'),
      where('projectId', '==', projectId),
      where('teamId', '==', teamId),
      orderBy('createdAt', 'desc'),
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
  }, [projectId, teamId])

  return { tasks, loading, error }
}