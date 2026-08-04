import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, Check } from 'lucide-react'
import type { Timestamp } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/AppConfigContext'
import { useMyNotifications } from '../hooks/useMyNotifications'
import { useDesktopNotifications } from '../hooks/useDesktopNotifications'
import { pruneOldNotifications, resolveAllNotifications, resolveNotifications } from '../lib/firestore'
import { setNotificationPref, type NotificationPrefKey } from '../lib/notifications'
import type { AppNotification, NotificationType } from '../types/models'

function initialsFor(name: string): string {
  const parts = (name || '?').split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function formatWhen(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return 'just now'
  const diffMs = Date.now() - ts.toDate().getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const VERB: Record<NotificationType, string> = {
  mention: 'mentioned you in',
  assignment: 'assigned you',
  status_update: 'updated',
  role_assignment: 'assigned you to',
}

const PREF_ROWS: { key: NotificationPrefKey; label: string }[] = [
  { key: 'mention', label: 'Mentions' },
  { key: 'assignment', label: 'Task assignments' },
  { key: 'statusUpdate', label: 'Status updates on your tasks' },
  { key: 'roleAssignment', label: 'Project roles assigned to you' },
]

function NotificationRow({
  n,
  onNavigate,
  onToggleResolve,
}: {
  n: AppNotification
  onNavigate: () => void
  onToggleResolve: (id: string, resolved: boolean) => void
}) {
  const location = useLocation()
  // Task-scoped rows open the task modal over the current page; project-scoped
  // rows (role_assignment) navigate to the project. backgroundLocation must NOT
  // be set for those — the overlay <Routes> only matches /tasks/:taskId, so the
  // main outlet would keep rendering the background page and the click would
  // appear to do nothing.
  return (
    <Link
      to={n.taskId ? `/tasks/${n.taskId}` : `/projects/${n.projectId}`}
      state={n.taskId ? { backgroundLocation: location } : undefined}
      onClick={() => {
        // Opening a notification resolves it (unless already resolved).
        if (!n.resolved) onToggleResolve(n.id, true)
        onNavigate()
      }}
      className={`group flex gap-2.5 px-3 py-2.5 transition hover:bg-fill-2 ${
        n.resolved ? 'opacity-60' : 'bg-brand-soft/40'
      }`}
    >
      <div
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient-br text-[10px] font-semibold text-white"
      >
        {initialsFor(n.actorName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg">
          <span className="font-medium">{n.actorName}</span>{' '}
          <span className="text-fg-muted">{VERB[n.type]}</span>{' '}
          <span className="font-medium">{n.taskTitle}</span>
        </div>
        {n.snippet && (
          <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">{n.snippet}</div>
        )}
        <div className="mt-0.5 text-[11px] text-fg-faint">{formatWhen(n.createdAt)}</div>
      </div>
      <button
        type="button"
        aria-label={n.resolved ? 'Mark as unresolved' : 'Mark as resolved'}
        title={n.resolved ? 'Resolved — click to undo' : 'Mark as resolved'}
        onClick={(e) => {
          // Row is a Link — don't navigate when toggling resolve.
          e.preventDefault()
          e.stopPropagation()
          onToggleResolve(n.id, !n.resolved)
        }}
        className={`ml-0.5 shrink-0 self-start rounded-md p-1 transition ${
          n.resolved
            ? 'text-tone-success-fg hover:bg-fill-3'
            : 'text-fg-faint opacity-0 hover:bg-fill-3 hover:text-tone-success-fg focus:opacity-100 group-hover:opacity-100'
        }`}
      >
        <Check size={14} aria-hidden />
      </button>
    </Link>
  )
}

export default function NotificationBell() {
  const enabled = useFeature('notifications')
  const { user, profile } = useAuth()
  const { notifications, unresolvedCount, loading, error } = useMyNotifications()
  const { supported: desktopSupported, permission, requestPermission } = useDesktopNotifications({
    notifications,
    loading,
    enabled,
  })
  const [open, setOpen] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Opening no longer auto-resolves anything (resolving is an explicit action).
  // Just opportunistically prune very old rows.
  function handleOpen() {
    const next = !open
    setOpen(next)
    setShowPrefs(false)
    if (next && user) void pruneOldNotifications(user.uid)
  }

  function toggleResolve(id: string, resolved: boolean) {
    void resolveNotifications([id], resolved)
  }

  function markAllResolved() {
    if (user) void resolveAllNotifications(user.uid)
  }

  if (!enabled || !user) return null

  const prefs = profile?.notificationPrefs
  const desktopLabel =
    permission === 'granted'
      ? 'On'
      : permission === 'denied'
        ? 'Blocked in browser'
        : 'Enable'

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Notifications${unresolvedCount ? ` (${unresolvedCount} unresolved)` : ''}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-fill-2 text-fg-muted transition hover:bg-fill-3 hover:text-fg"
      >
        <Bell size={17} aria-hidden />
        {unresolvedCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-brand-gradient px-1 text-[10px] font-semibold leading-4 text-white">
            {unresolvedCount > 9 ? '9+' : unresolvedCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-17 z-50 overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-2rem)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium text-fg">
              {showPrefs ? 'Notification settings' : 'Notifications'}
            </span>
            <div className="flex items-center gap-1">
              {!showPrefs && unresolvedCount > 0 && (
                <button
                  type="button"
                  onClick={markAllResolved}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted transition hover:bg-fill-2 hover:text-fg"
                >
                  <Check size={12} aria-hidden />
                  Mark all resolved
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPrefs((s) => !s)}
                className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:bg-fill-2 hover:text-fg"
              >
                {showPrefs ? 'Back' : 'Settings'}
              </button>
            </div>
          </div>

          {showPrefs ? (
            <div className="space-y-1 p-2">
              {PREF_ROWS.map((row) => {
                const on = prefs?.[row.key] !== false
                return (
                  <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
                    <span className="text-sm text-fg">{row.label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => user && void setNotificationPref(user.uid, row.key, !on)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                        on ? 'bg-brand-edge' : 'bg-fill-4'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                          on ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                )
              })}

              {/* Desktop notifications: browser-permission gated, fires only while
                  the app is open in a tab (no background/mobile push without a
                  server to send it). */}
              {desktopSupported && (
                <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border-t border-line-subtle px-2 pt-3 pb-2">
                  <div className="min-w-0">
                    <div className="text-sm text-fg">Desktop notifications</div>
                    <div className="text-[11px] text-fg-subtle">
                      Pop-ups while this app is open in a tab.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={permission !== 'default'}
                    onClick={() => void requestPermission()}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      permission === 'granted'
                        ? 'border-tone-success-bd bg-tone-success-bg text-tone-success-fg'
                        : permission === 'denied'
                          ? 'cursor-not-allowed border-line bg-fill-2 text-fg-faint'
                          : 'border-brand-edge bg-brand-soft text-brand hover:opacity-90'
                    }`}
                  >
                    {desktopLabel}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {error ? (
                <div className="px-3 py-6 text-center text-sm text-tone-danger-fg">
                  Couldn&rsquo;t load notifications.
                  <div className="mt-1 text-xs text-tone-danger-fg/70">{error}</div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-fg-subtle">
                  You&rsquo;re all caught up.
                </div>
              ) : (
                <div className="divide-y divide-line-subtle">
                  {notifications.map((n) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      onNavigate={() => setOpen(false)}
                      onToggleResolve={toggleResolve}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
