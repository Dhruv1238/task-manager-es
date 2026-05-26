import { useEffect, useState } from 'react'
import {  onSnapshot, orderBy, query } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Comment } from '../types/models'

export function useComments(taskId: string | undefined) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!taskId) {
      setComments([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      tenantCol('tasks', taskId, 'comments'),
      orderBy('createdAt', 'asc'),
    )
    return onSnapshot(
      q,
      (snap) => {
        setComments(snap.docs.map((d) => ({ ...(d.data() as Comment), id: d.id })))
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [taskId])

  return { comments, loading }
}