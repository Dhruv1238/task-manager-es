import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function AdminRoute() {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-fg-subtle">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
      </div>
    )
  }

  // Admin surfaces (members, dashboards, team management) are open to both
  // admins (the lead-role pool) and super_admins (the tender team).
  if (profile?.globalRole !== 'admin' && profile?.globalRole !== 'super_admin') {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

// Strict super-admin gate (tender-only screens — currently unused but ready
// for any future super-admin-only routes).
export function SuperAdminRoute() {
  const { profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-fg-subtle">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
      </div>
    )
  }
  if (profile?.globalRole !== 'super_admin') return <Navigate to="/" replace />
  return <Outlet />
}
