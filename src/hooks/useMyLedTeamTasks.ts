import { useEffect, useState } from 'react'
import {
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Task } from '../types/models'

// Team-level tasks (parentTaskId === null) for every team where this user is the lead.
// Used on /me to surface team-owned work to the accountable person.
// Firestore will prompt for a composite index on (teamId, parentTaskId).
export function useMyLedTeamTasks(uid: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    let taskUnsub: Unsubscribe | null = null

    const teamsUnsub = onSnapshot(
      query(tenantCol('teams'), where('leadId', '==', uid)),
      (teamsSnap) => {
        const ledIds = teamsSnap.docs.map((d) => d.id)

        if (taskUnsub) {
          taskUnsub()
          taskUnsub = null
        }

        if (ledIds.length === 0) {
          setTasks([])
          setLoading(false)
          return
        }

        taskUnsub = onSnapshot(
          query(
            tenantCol('tasks'),
            where('teamId', 'in', ledIds.slice(0, 30)),
            where('parentTaskId', '==', null),
          ),
          (snap) => {
            setTasks(snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id })))
            setLoading(false)
          },
          (err) => {
            setError(err.message)
            setLoading(false)
          },
        )
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )

    return () => {
      if (taskUnsub) taskUnsub()
      teamsUnsub()
    }
  }, [uid])

  return { tasks, loading, error }
}