import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAppConfigContext } from '../contexts/AppConfigContext'
import { usePermissions } from '../hooks/usePermissions'
import type { ModuleOp } from '../types/v2'

interface Props {
  module: string
  op?: ModuleOp
}

// Config-driven route guard. Admits a user when the Role-Hierarchy module grid
// grants can(module, op). super_admin is an explicit, hierarchy-INDEPENDENT
// baseline (isSuperAdmin reads globalRole, not the grid) that ALWAYS passes —
// so editing or breaking the hierarchy can never lock the owner out of the
// admin surfaces, including /admin/roles (the screen that fixes it).
//
// isSuperAdmin/can come from usePermissions, which resolves the EFFECTIVE
// (persona-switched) profile in the sandbox, so impersonating a non-admin
// correctly restricts access. Sits inside <ProtectedRoute>, so the user is
// already authenticated.
export default function RequireAccess({ module, op = 'view' }: Props) {
  const { loading } = useAuth()
  const { bootLoaded } = useAppConfigContext()
  const { isSuperAdmin, can } = usePermissions()

  // Wait on auth + boot so we never evaluate can() against the DEFAULT (empty)
  // org and bounce a legitimately-permitted user mid-hydration.
  if (loading || !bootLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-fg-subtle">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
      </div>
    )
  }

  if (isSuperAdmin || can(module, op)) return <Outlet />
  return <Navigate to="/" replace />
}
