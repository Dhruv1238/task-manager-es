import { useEffect, useMemo, useState } from 'react'
import { limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/AppConfigContext'
import type { AppNotification, NotificationType, User } from '../types/models'

const FETCH_LIMIT = 50

// Maps a notification type to the user-pref key that mutes it.
const PREF_KEY: Record<NotificationType, keyof NonNullable<User['notificationPrefs']>> = {
  mention: 'mention',
  assignment: 'assignment',
  status_update: 'statusUpdate',
  role_assignment: 'roleAssignment',
}

// Server-side ordered + limited: fetches only the newest FETCH_LIMIT, ordered by
// Firestore. Needs the composite index (recipientId ASC + createdAt DESC) in
// firestore.indexes.json — deploy it (or click the console link) before use; the
// bell surfaces a load error if it's missing. (prune/resolveAll stay index-free.)
export function useMyNotifications() {
  const { user, profile } = useAuth()
  // Don't subscribe when the org has notifications off.
  const enabled = useFeature('notifications')
  const [all, setAll] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const uid = user?.uid
    if (!uid || !enabled) {
      setAll([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const q = query(
      tenantCol('notifications'),
      where('recipientId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(FETCH_LIMIT),
    )
    return onSnapshot(
      q,
      (snap) => {
        setAll(snap.docs.map((d) => ({ ...(d.data() as AppNotification), id: d.id })))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
  }, [user?.uid, enabled])

  // Filter by the viewer's own prefs at DISPLAY time (Discord-mute semantics),
  // so badge count and list can never disagree and un-muting is retroactive.
  const prefs = profile?.notificationPrefs
  const notifications = useMemo(
    () => all.filter((n) => prefs?.[PREF_KEY[n.type]] !== false),
    [all, prefs],
  )
  const unresolvedCount = useMemo(
    () => notifications.filter((n) => !n.resolved).length,
    [notifications],
  )

  return { notifications, unresolvedCount, loading, error }
}
