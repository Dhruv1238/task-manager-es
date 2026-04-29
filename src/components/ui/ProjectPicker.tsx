import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '../../types/models'

interface Props {
  value: string | null
  onChange: (next: string) => void
  projects: Project[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

// Search bar (~52) + 6 rows (~216) + borders/padding.
const APPROX_POPOVER_HEIGHT = 320
const POPOVER_GAP = 8

type PopoverPos =
  | { mode: 'below'; top: number; left: number; width: number }
  | { mode: 'above'; bottom: number; left: number; width: number }

export default function ProjectPicker({
  value,
  onChange,
  projects,
  placeholder = 'Select a project',
  disabled = false,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return projects
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(s) ||
        p.status.toLowerCase().includes(s),
    )
  }, [projects, search])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const measure = () => {
      const t = triggerRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const spaceAbove = r.top
      const flip = spaceBelow < APPROX_POPOVER_HEIGHT + POPOVER_GAP && spaceAbove > spaceBelow
      if (flip) {
        setPos({
          mode: 'above',
          bottom: window.innerHeight - r.top,
          left: r.left,
          width: r.width,
        })
      } else {
        setPos({
          mode: 'below',
          top: r.bottom,
          left: r.left,
          width: r.width,
        })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node
      const insideTrigger = triggerRef.current?.contains(t)
      const insidePopover = popoverRef.current?.contains(t)
      if (!insideTrigger && !insidePopover) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = value ? projects.find((p) => p.id === value) : null
  const emptyDisabled = disabled || projects.length === 0

  const popoverStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos?.left,
    width: pos?.width,
    zIndex: 60,
    ...(pos?.mode === 'above'
      ? { bottom: pos.bottom + POPOVER_GAP }
      : pos?.mode === 'below'
        ? { top: pos.top + POPOVER_GAP }
        : {}),
  }

  return (
    <>
      <div className={`relative ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => !emptyDisabled && setOpen((o) => !o)}
          disabled={emptyDisabled}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm transition ${
            emptyDisabled
              ? 'cursor-not-allowed text-white/30'
              : 'text-white/85 hover:bg-white/6'
          }`}
        >
          <span className="min-w-0 truncate text-left">
            {current ? current.title : placeholder}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-white/40 transition ${open ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {open && pos &&
        createPortal(
          <div
            ref={popoverRef}
            style={popoverStyle}
            className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0e0e16] shadow-2xl"
          >
            <div className="shrink-0 border-b border-white/10 p-2">
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects"
                className="w-full rounded-md bg-white/4 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
              />
            </div>
            <div className="scrollbar-dark max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-white/40">
                  No projects match.
                </div>
              ) : (
                filtered.map((p) => {
                  const active = value === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onChange(p.id)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                        active ? 'bg-purple-500/10 text-white' : 'text-white/80 hover:bg-white/4'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/40">
                        {p.status}
                      </span>
                      {active && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-purple-300"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
