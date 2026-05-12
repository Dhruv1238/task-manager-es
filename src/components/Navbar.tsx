import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { useAuth } from '../contexts/AuthContext'

const APP_NAME = 'Task Manager'

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
  const isAdmin = profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin'
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
              {isAdmin && (
                <>
                  <NavLink to="/admin/members" className={navLinkCls}>
                    Members
                  </NavLink>
                  <NavLink to="/admin" end className={navLinkCls}>
                    Admin Analytics
                  </NavLink>
                </>
              )}
            </nav>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />

            <div className="hidden items-center gap-3 rounded-full border border-line bg-fill-2 py-1.5 pl-1.5 pr-3 sm:flex">
              <div
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient-br text-[11px] font-semibold text-white"
              >
                {initialsFor(user)}
              </div>
              <span className="text-sm text-fg-muted">{user.email}</span>
            </div>

            <div
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient-br text-xs font-semibold text-white sm:hidden"
              title={user.email ?? undefined}
            >
              {initialsFor(user)}
            </div>

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
              {isAdmin && (
                <>
                  <NavLink to="/admin/members" className={mobileLinkCls}>
                    Members
                  </NavLink>
                  <NavLink to="/admin" end className={mobileLinkCls}>
                    Admin Analytics
                  </NavLink>
                </>
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
