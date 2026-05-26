import { useEffect, useState } from 'react'
import {  onSnapshot, orderBy, query } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Project } from '../types/models'

export function useAllProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(tenantCol('projects'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      (snap) => {
        setProjects(snap.docs.map((d) => ({ ...(d.data() as Project), id: d.id })))
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  return { projects, loading }
}