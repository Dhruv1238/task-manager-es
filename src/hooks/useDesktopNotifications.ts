import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppNotification, NotificationType } from '../types/models'

// Client-side desktop notifications via the browser Notification API. These fire
// only while the app is open in a tab — TRUE background/mobile push needs a
// server to send (FCM/Web Push), i.e. a Cloud Function this project doesn't have.

const SUPPORTED = typeof window !== 'undefined' && 'Notification' in window

export type NotificationPermissionState = NotificationPermission | 'unsupported'

const VERB: Record<NotificationType, string> = {
  mention: 'mentioned you in',
  assignment: 'assigned you',
  status_update: 'updated',
  role_assignment: 'assigned you to',
}

function currentPermission(): NotificationPermissionState {
  return SUPPORTED ? Notification.permission : 'unsupported'
}

interface Args {
  notifications: AppNotification[]
  loading: boolean
  enabled: boolean
}

export function useDesktopNotifications({ notifications, loading, enabled }: Args) {
  const [permission, setPermission] = useState<NotificationPermissionState>(currentPermission)
  const seen = useRef<Set<string>>(new Set())
  const armed = useRef(false)

  const requestPermission = useCallback(async () => {
    if (!SUPPORTED) return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
    } catch {
      // some browsers reject if not from a user gesture — ignore
    }
  }, [])

  useEffect(() => {
    if (!SUPPORTED || !enabled || loading) return

    // First completed load: seed the seen-set without firing, so opening the app
    // never replays a backlog of existing notifications as desktop popups.
    if (!armed.current) {
      for (const n of notifications) seen.current.add(n.id)
      armed.current = true
      return
    }

    // New notifications since the last snapshot.
    const fresh = notifications.filter((n) => !seen.current.has(n.id))
    for (const n of notifications) seen.current.add(n.id)

    // Only pop for unresolved arrivals, and only with permission. If permission
    // isn't granted we still marked them seen above, so granting later won't dump
    // the backlog. Cap the burst so a bulk change can't spawn a wall of popups.
    if (permission !== 'granted') return
    for (const n of fresh.filter((n) => !n.resolved).slice(0, 3)) {
      try {
        const notice = new Notification(n.actorName, {
          body: `${VERB[n.type]} ${n.taskTitle}${n.snippet ? ` — ${n.snippet}` : ''}`,
          tag: n.id, // dedupe if the same notification re-renders
        })
        notice.onclick = () => window.focus()
      } catch {
        // ignore — Notification construction can throw on some platforms
      }
    }
  }, [notifications, loading, enabled, permission])

  return { supported: SUPPORTED, permission, requestPermission }
}
