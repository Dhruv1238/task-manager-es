import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Team } from '../../types/models'
import { useAllTeams } from '../../hooks/useAllTeams'

interface Props {
  value: string | null
  onChange: (teamId: string | null) => void
  placeholder?: string
  // When provided, only teams whose id is in this list are shown.
  includeIds?: string[]
  id?: string
}

// Search bar (~52) + ~5 rows (~180) + borders/padding.
const APPROX_POPOVER_HEIGHT = 280
const POPOVER_GAP = 8

type PopoverPos =
  | { mode: 'below'; top: number; left: number; width: number }
  | { mode: 'above'; bottom: number; left: number; width: number }

// Search-based team picker that matches UserPicker's UX. Single-select only.
export default function TeamPicker({ value, onChange, placeholder, includeIds, id }: Props) {
  const { teams } = useAllTeams()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<PopoverPos | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (!open) setSearch('')
    else setTimeout(() => searchRef.current?.focus(), 0)
  }, [open])

  const teamById = useMemo(() => {
    const m = new Map<string, Team>()
    for (const t of teams) m.set(t.id, t)
    return m
  }, [teams])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const includeSet = includeIds ? new Set(includeIds) : null
    return teams
      .filter((t) => (includeSet ? includeSet.has(t.id) : true))
      .filter((t) => {
        if (!s) return true
        return (
          t.name.toLowerCase().includes(s) ||
          (t.description ?? '').toLowerCase().includes(s)
        )
      })
  }, [teams, includeIds, search])

  function handleSelect(teamId: string) {
    onChange(teamId)
    setOpen(false)
  }

  const selected = value ? teamById.get(value) ?? null : null

  const triggerCls =
    'flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-fill-2 px-3 py-2.5 text-left text-sm text-fg outline-none transition focus-within:border-brand-edge focus-within:bg-fill-3 focus-within:ring-2 focus-within:ring-brand-ring hover:bg-fill-3'

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
      <div className="relative">
        <button
          id={id}
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={triggerCls}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {selected ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[10px] font-semibold text-fg-strong">
                  {selected.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((p) => p[0]?.toUpperCase() ?? '')
                    .join('')}
                </span>
                <span className="truncate text-fg-strong">{selected.name}</span>
              </span>
            ) : (
              <span className="text-fg-subtle">{placeholder ?? 'Select a team'}</span>
            )}
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-fg-subtle transition ${open ? 'rotate-180' : ''}`}
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
            className="flex flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl"
          >
            <div className="shrink-0 border-b border-line p-2">
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams…"
                className="w-full rounded-md bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-fg-subtle">
                  No teams match.
                </div>
              ) : (
                filtered.map((t) => {
                  const active = value === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelect(t.id)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                        active ? 'bg-fill-3' : 'hover:bg-fill-2'
                      }`}
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[11px] font-semibold text-fg-strong">
                        {t.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((p) => p[0]?.toUpperCase() ?? '')
                          .join('')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-fg-strong">{t.name}</span>
                        {t.description && (
                          <span className="block truncate text-xs text-fg-subtle">
                            {t.description}
                          </span>
                        )}
                      </span>
                      {active && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="shrink-0 text-brand"
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
