import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'

export interface AdminNavItem {
  to: string
  end?: boolean
  label: string
}

// The three admin destinations (Members / Analytics / Config) collapse into a
// single top-level "Admin" entry so the primary nav stays roomy. Click-to-open
// (not hover) so it works on touch and for keyboard users.
export default function NavbarAdminMenu({ items }: { items: AdminNavItem[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

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

  // Any /admin route lights up the trigger (mirrors the individual links' active state).
  const active = location.pathname.startsWith('/admin')

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md py-1.5 pl-3 pr-2 text-sm font-medium transition ${
          active || open
            ? 'bg-fill-4 text-fg'
            : 'text-fg-muted hover:bg-fill-2 hover:text-fg-strong'
        }`}
      >
        Admin
        <ChevronDown
          size={14}
          aria-hidden
          className={`transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-elevated p-1 shadow-2xl"
        >
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-fill-3 text-fg' : 'text-fg-muted hover:bg-fill-2 hover:text-fg'
                }`
              }
            >
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
