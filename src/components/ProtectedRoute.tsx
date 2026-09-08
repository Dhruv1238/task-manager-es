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
    <div className="relative min-h-screen bg-canvas text-fg">
      {/* The ambient orbs clip on their OWN layer. `overflow-hidden` on the page
        * shell makes it the nearest scroll container, which silently defeats
        * position:sticky for every page inside it (the /me chart column stuck
        * to a box that never scrolls, so it never moved). Same inset-0 clip
        * layer the Modal shell uses. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-135 w-135 rounded-full bg-orb-a blur-3xl" />
        <div className="absolute -bottom-40 -right-32 h-130 w-130 rounded-full bg-orb-b blur-3xl" />
      </div>
      <div className="relative z-10">
        <Navbar />
        <Outlet />
      </div>
    </div>
  )
}