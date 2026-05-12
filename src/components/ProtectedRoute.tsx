import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Navbar from './Navbar'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-fg-subtle">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-fg">
      <div className="pointer-events-none absolute -left-40 -top-40 h-135 w-135 rounded-full bg-orb-a blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-130 w-130 rounded-full bg-orb-b blur-3xl" />
      <div className="relative z-10">
        <Navbar />
        <Outlet />
      </div>
    </div>
  )
}