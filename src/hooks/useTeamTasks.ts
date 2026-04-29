import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Task } from '../types/models'

// Every task for a given team, across all projects it's on. Used by the team dashboard.
// Firestore may prompt for an index on `teamId` (single-field, usually auto).
export function useTeamTasks(teamId: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!teamId) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(collection(db, 'tasks'), where('teamId', '==', teamId))
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
  }, [teamId])

  return { tasks, loading, error }
}