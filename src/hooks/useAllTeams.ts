import { useEffect, useState } from 'react'
import {  onSnapshot, orderBy, query } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Team } from '../types/models'

export function useAllTeams() {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(tenantCol('teams'), orderBy('name'))
    return onSnapshot(
      q,
      (snap) => {
        setTeams(snap.docs.map((d) => ({ ...(d.data() as Team), id: d.id })))
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  return { teams, loading }
}