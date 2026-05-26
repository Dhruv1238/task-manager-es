import { useEffect, useState } from 'react'
import {  onSnapshot, orderBy, query } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { User } from '../types/models'

export function useAllUsers() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(tenantCol('users'), orderBy('displayName'))
    return onSnapshot(
      q,
      (snap) => {
        setUsers(snap.docs.map((d) => d.data() as User))
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  return { users, loading }
}
