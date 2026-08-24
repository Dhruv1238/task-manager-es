import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
// RELEASE(kpi-reports): uncomment with the KPI Reports navbar entries below.
// import { TrendingUp } from 'lucide-react'
import Logo from './Logo'
import { lazy, Suspense } from 'react'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'
import NavbarAdminMenu, { type AdminNavItem } from './NavbarAdminMenu'
import NavbarAccountMenu from './NavbarAccountMenu'
import { useFeature } from '../contexts/AppConfigContext'
import { acquireScrollLock } from '../lib/scrollLock'

// Sandbox slots — lazy-loaded so production bundles never fetch them.
const SandboxMenu = __IS_SANDBOX__
  ? lazy(() => import('./sandbox/SandboxMenu'))
  : null
const SandboxIdentityPill = __IS_SANDBOX__
  ? lazy(() => import('./sandbox/SandboxIdentityPill'))
  : null
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'

const APP_NAME = 'Show Runner'

function initialsFor(user: { displayName?: string | null; email?: string | null }): string {
  const source = user.displayName || user.email || '?'
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}

const navLinkCls = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-fill-4 text-fg'
      : 'text-fg-muted hover:bg-fill-2 hover:text-fg-strong'
  }`

const mobileLinkCls = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-fill-4 text-fg' : 'text-fg-muted hover:bg-fill-2 hover:text-fg'
  }`

export default function Navbar() {
  const { user, profile, signOut } = useAuth()
  const { isSuperAdmin, can } = usePermissions()
  // Nav links mirror the route guards: the Role-Hierarchy module grid governs
  // access, with super_admin as the always-pass baseline.
  const canViewMembers = isSuperAdmin || can('members', 'view')
  const canViewReports = isSuperAdmin || can('reports', 'view')
  // RELEASE(kpi-reports): uncomment with the KPI Reports navbar entries below.
  // const canViewKpiReports = isSuperAdmin || can('kpi_reports', 'view')
  const canViewSettings = isSuperAdmin || can('settings', 'view')
  const timeTrackingOn = useFeature('timeTracking')
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Admin destinations collapse into a single "Admin" dropdown on desktop; only
  // the ones this user can reach are listed, and the group hides entirely if none.
  const adminItems: AdminNavItem[] = [
    canViewMembers && { to: '/admin/members', label: 'Members' },
    canViewReports && { to: '/admin', end: true, label: 'Admin Analytics' },
    // Flag-gated as well as permission-gated: no point advertising a report
    // that has nothing in it until an admin turns time tracking on.
    canViewReports && timeTrackingOn && { to: '/admin/time', label: 'Time Report' },
    canViewSettings && { to: '/admin/config', label: 'Configuration' },
  ].filter(Boolean) as AdminNavItem[]

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // The drawer markup and its toggle are both lg:hidden, so if the viewport
  // crosses the lg breakpoint (tablet rotation, window resize) while the
  // drawer is open, the overlay AND its only close control disappear — but
  // mobileOpen would stay true, keeping the scroll lock below held with
  // nothing visible holding it. Close it the moment the desktop layout kicks in.
  useEffect(() => {
    if (!mobileOpen) return
    // No synchronous matches check needed: the toggle is itself lg:hidden, so
    // the drawer can only ever OPEN below the breakpoint — only a resize
    // while open can cross it, and the change listener catches that.
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    // Ref-counted shared lock (lib/scrollLock.ts): overlays can overlap, and a
    // save-and-restore here could re-apply a stale 'hidden' on cleanup.
    return acquireScrollLock()
  }, [mobileOpen])

  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-3 text-fg transition hover:opacity-90"
          >
            <Logo height={26} />
            <span className="hidden h-6 w-px bg-line-strong sm:block" />
            <span className="hidden whitespace-nowrap text-sm font-medium tracking-tight text-fg-strong sm:block">
              {APP_NAME}
            </span>
          </Link>

          {user && (
            <nav className="hidden items-center gap-1.5 lg:flex">
              <NavLink to="/" end className={navLinkCls}>
                Home
              </NavLink>
              <NavLink to="/me" className={navLinkCls}>
                My Tasks
              </NavLink>
              <NavLink to="/projects" className={navLinkCls}>
                Projects
              </NavLink>
              <NavLink to="/teams" className={navLinkCls}>
                Teams
              </NavLink>
              {/* RELEASE(kpi-reports): to restore the KPI Reports entry, add
                  `canViewKpiReports && { to: '/admin/reports', label: 'KPI Reports' }`
                  to the `adminItems` array above and restore the flag. */}
              {adminItems.length > 0 && <NavbarAdminMenu items={adminItems} />}
            </nav>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2 sm:gap-3">
            {SandboxMenu ? (
              <Suspense fallback={null}>
                <SandboxMenu />
              </Suspense>
            ) : null}
            <NotificationBell />

            {SandboxIdentityPill ? (
              /* Sandbox build keeps its dedicated identity switcher + inline
                 controls — not consolidated into the account menu. */
              <>
                <ThemeToggle />
                <Suspense fallback={null}>
                  <SandboxIdentityPill />
                </Suspense>
                <button
                  onClick={() => signOut()}
                  className="hidden rounded-md border border-line bg-fill-2 px-3 py-1.5 text-sm text-fg-muted transition hover:bg-fill-3 hover:text-fg lg:inline-flex"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                {/* Mobile: one-tap theme (on desktop it lives in the account menu). */}
                <span className="lg:hidden">
                  <ThemeToggle />
                </span>
                {/* Desktop: identity + theme + sign out consolidated behind the avatar. */}
                <NavbarAccountMenu
                  className="hidden lg:block"
                  displayName={profile?.displayName}
                  email={user.email}
                  initials={initialsFor(user)}
                  onSignOut={signOut}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-fill-2 text-fg-muted transition hover:bg-fill-3 hover:text-fg lg:hidden"
            >
              {mobileOpen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {user && mobileOpen && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 top-16 z-30 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <nav className="relative z-40 border-t border-line bg-surface/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3 border-b border-line-subtle pb-3">
              <div
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient-br text-xs font-semibold text-white"
              >
                {initialsFor(user)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-fg-strong">
                  {profile?.displayName || user.email}
                </div>
                {profile?.displayName && (
                  <div className="truncate text-xs text-fg-subtle">{user.email}</div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 py-2">
              <NavLink to="/" end className={mobileLinkCls}>
                Home
              </NavLink>
              <NavLink to="/me" className={mobileLinkCls}>
                My Tasks
              </NavLink>
              <NavLink to="/projects" className={mobileLinkCls}>
                Projects
              </NavLink>
              <NavLink to="/teams" className={mobileLinkCls}>
                Teams
              </NavLink>
              {canViewMembers && (
                <NavLink to="/admin/members" className={mobileLinkCls}>
                  Members
                </NavLink>
              )}
              {canViewReports && (
                <NavLink to="/admin" end className={mobileLinkCls}>
                  Admin Analytics
                </NavLink>
              )}
              {canViewReports && timeTrackingOn && (
                <NavLink to="/admin/time" className={mobileLinkCls}>
                  Time Report
                </NavLink>
              )}
              {/* RELEASE(kpi-reports): uncomment to restore the mobile entry.
              {canViewKpiReports && (
                <NavLink to="/admin/reports" className={mobileLinkCls}>
                  KPI Reports
                </NavLink>
              )}
              */}
              {canViewSettings && (
                <NavLink
                  to="/admin/config"
                  className={mobileLinkCls}
                  aria-label="Configuration"
                >
                  <span className="inline-flex items-center gap-2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.2 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.2l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    Configuration
                  </span>
                </NavLink>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setMobileOpen(false)
                signOut()
              }}
              className="mt-2 w-full rounded-md border border-line bg-fill-2 px-3 py-2 text-left text-sm text-fg-muted transition hover:bg-fill-3 hover:text-fg"
            >
              Sign out
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
