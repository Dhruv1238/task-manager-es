import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Emails permitted to reach /admin/config. Kept here (not in Firestore) so the
// gate survives any data corruption and so other super_admins a client might
// provision can't stumble onto the dev console.
export const DEV_CONFIG_EMAILS = ['dhruv.sharma1@eventstrat.ai','sarvesh@eventstrat.ai', 'abhishek@eventstrat.ai', 'parul.singh1@eventstrat.ai', 'rachet@eventstrat.ai']

export function isDevConfigUser(profile: { globalRole?: string; email?: string } | null | undefined): boolean {
  if (!profile) return false
  if (profile.globalRole !== 'super_admin') return false
  // Sandbox: any super_admin (i.e. the visitor in their own tenant) can reach
  // /admin/config — they need org + workflow editors to explore the platform.
  // Dev Tools are hidden inside the page itself via __IS_SANDBOX__. Production
  // keeps the email allowlist.
  if (__IS_SANDBOX__) return true
  return DEV_CONFIG_EMAILS.includes((profile.email ?? '').toLowerCase())
}

export default function DevConfigRoute() {
  const { profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-fg-subtle">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
      </div>
    )
  }
  if (!isDevConfigUser(profile)) return <Navigate to="/" replace />
  return <Outlet />
}
