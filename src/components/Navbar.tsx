import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Logo from './Logo'
import { lazy, Suspense } from 'react'
import ThemeToggle from './ThemeToggle'

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
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
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
  const canViewSettings = isSuperAdmin || can('settings', 'view')
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3 text-fg transition hover:opacity-90">
            <Logo height={26} />
            <span className="hidden h-6 w-px bg-line-strong sm:block" />
            <span className="hidden text-sm font-medium tracking-tight text-fg-strong sm:block">
              {APP_NAME}
            </span>
          </Link>

          {user && (
            <nav className="hidden items-center gap-1 md:flex">
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
              {canViewMembers && (
                <NavLink to="/admin/members" className={navLinkCls}>
                  Members
                </NavLink>
              )}
              {canViewReports && (
                <NavLink to="/admin" end className={navLinkCls}>
                  Admin Analytics
                </NavLink>
              )}
              {canViewSettings && (
                <NavLink
                  to="/admin/config"
                  className={navLinkCls}
                  aria-label="Configuration"
                  title="Configuration"
                >
                  <svg
                    width="16"
                    height="16"
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
                </NavLink>
              )}
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
            <ThemeToggle />

            {SandboxIdentityPill ? (
              <Suspense fallback={null}>
                <SandboxIdentityPill />
              </Suspense>
            ) : (
              <>
                <div className="hidden items-center gap-3 rounded-full border border-line bg-fill-2 py-1.5 pl-1.5 pr-3 sm:flex">
                  <div
                    aria-hidden
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient-br text-[11px] font-semibold text-white"
                  >
                    {initialsFor(user)}
                  </div>
                  <span
                    className="max-w-45 truncate text-sm text-fg-muted"
                    title={user.email ?? undefined}
                  >
                    {user.email}
                  </span>
                </div>

                <div
                  aria-hidden
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient-br text-xs font-semibold text-white sm:hidden"
                  title={user.email ?? undefined}
                >
                  {initialsFor(user)}
                </div>
              </>
            )}

            <button
              onClick={() => signOut()}
              className="hidden rounded-md border border-line bg-fill-2 px-3 py-1.5 text-sm text-fg-muted transition hover:bg-fill-3 hover:text-fg md:inline-flex"
            >
              Sign out
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-fill-2 text-fg-muted transition hover:bg-fill-3 hover:text-fg md:hidden"
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
        <div className="md:hidden">
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
