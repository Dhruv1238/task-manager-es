import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '../contexts/ThemeContext'

const THEME_LABEL: Record<ThemeMode, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
}

const THEME_NEXT: Record<ThemeMode, string> = {
  dark: 'Switch to light theme',
  light: 'Switch to system theme',
  system: 'Switch to dark theme',
}

// Consolidates the account cluster (identity + theme + sign out) into a single
// avatar dropdown, freeing the ~290px the email pill + sign-out button used to
// take on the desktop bar. Click-to-open, outside-click / Escape to dismiss.
export default function NavbarAccountMenu({
  displayName,
  email,
  initials,
  onSignOut,
  className,
}: {
  displayName?: string | null
  email?: string | null
  initials: string
  onSignOut: () => void
  className?: string
}) {
  const { mode, cycle } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

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

  const ThemeIcon = mode === 'system' ? Monitor : mode === 'light' ? Sun : Moon

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1.5 rounded-full border border-line bg-fill-2 py-1 pl-1 pr-2 text-fg-muted transition hover:bg-fill-3 hover:text-fg"
      >
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient-br text-[11px] font-semibold text-white"
        >
          {initials}
        </span>
        <ChevronDown size={14} aria-hidden className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl"
        >
          <div className="flex items-center gap-3 border-b border-line px-3 py-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient-br text-xs font-semibold text-white"
            >
              {initials}
            </span>
            <div className="min-w-0">
              {displayName && (
                <div className="truncate text-sm font-medium text-fg-strong">{displayName}</div>
              )}
              <div className="truncate text-xs text-fg-subtle" title={email ?? undefined}>
                {email}
              </div>
            </div>
          </div>

          <div className="p-1">
            {/* Theme cycles in place — menu stays open so you can see the change. */}
            <button
              type="button"
              role="menuitem"
              onClick={cycle}
              title={THEME_NEXT[mode]}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-fg-muted transition hover:bg-fill-2 hover:text-fg"
            >
              <span className="flex items-center gap-2.5">
                <ThemeIcon size={16} aria-hidden />
                Theme
              </span>
              <span className="text-xs text-fg-subtle">{THEME_LABEL[mode]}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-muted transition hover:bg-fill-2 hover:text-fg"
            >
              <LogOut size={16} aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
