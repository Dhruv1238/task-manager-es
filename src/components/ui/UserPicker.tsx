import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '../../types/models'
import { useAllUsers } from '../../hooks/useAllUsers'
import { useAuth } from '../../contexts/AuthContext'
import NewMemberModal from '../admin/NewMemberModal'
import type { CreateMemberResult } from '../../lib/createMember'

type SingleProps = {
  mode: 'single'
  value: string | null
  onChange: (uid: string | null) => void
}
type MultiProps = {
  mode: 'multi'
  value: string[]
  onChange: (uids: string[]) => void
}

type Props = (SingleProps | MultiProps) & {
  placeholder?: string
  excludeUids?: string[]
  // When provided, only users whose uid is in this list are shown.
  // Useful for constraining to team.memberIds, project participants, etc.
  includeUids?: string[]
  allowCreate?: boolean
  id?: string
}

// Dropdown layout: search (~52) + 3 rows (~168) + create button (~48) + borders/padding.
const APPROX_POPOVER_HEIGHT = 300
const POPOVER_GAP = 8

type PopoverPos =
  | { mode: 'below'; top: number; left: number; width: number }
  | { mode: 'above'; bottom: number; left: number; width: number }

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 24 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

export default function UserPicker(props: Props) {
  const { placeholder, excludeUids = [], includeUids, allowCreate = false, id } = props
  const { users } = useAllUsers()
  const { profile } = useAuth()
  const canCreate =
    allowCreate &&
    (profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin')

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [newMemberOpen, setNewMemberOpen] = useState(false)
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
  }, [open])

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const includeSet = includeUids ? new Set(includeUids) : null
    return users
      .filter((u) => (includeSet ? includeSet.has(u.uid) : true))
      .filter((u) => !excludeUids.includes(u.uid))
      .filter((u) => {
        if (!s) return true
        return (
          u.displayName.toLowerCase().includes(s) ||
          u.email.toLowerCase().includes(s)
        )
      })
  }, [users, excludeUids, includeUids, search])

  const isSelected = (uid: string) =>
    props.mode === 'single' ? props.value === uid : props.value.includes(uid)

  function handleSelect(uid: string) {
    if (props.mode === 'single') {
      props.onChange(uid)
      setOpen(false)
    } else {
      const next = props.value.includes(uid)
        ? props.value.filter((v) => v !== uid)
        : [...props.value, uid]
      props.onChange(next)
    }
  }

  function handleCreated(result: CreateMemberResult) {
    if (props.mode === 'single') {
      props.onChange(result.uid)
    } else if (!props.value.includes(result.uid)) {
      props.onChange([...props.value, result.uid])
    }
  }

  const selectedSingle =
    props.mode === 'single' && props.value ? userById.get(props.value) ?? null : null
  const selectedMulti =
    props.mode === 'multi'
      ? (props.value.map((uid) => userById.get(uid)).filter(Boolean) as User[])
      : []

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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {props.mode === 'single' ? (
              selectedSingle ? (
                <span className="inline-flex items-center gap-2">
                  <Avatar user={selectedSingle} size={22} />
                  <span className="truncate text-fg-strong">{selectedSingle.displayName}</span>
                  <span className="truncate text-xs text-fg-subtle">{selectedSingle.email}</span>
                </span>
              ) : (
                <span className="text-fg-subtle">{placeholder ?? 'Select a user'}</span>
              )
            ) : selectedMulti.length === 0 ? (
              <span className="text-fg-subtle">{placeholder ?? 'Select users'}</span>
            ) : (
              selectedMulti.map((u) => (
                <span
                  key={u.uid}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-fill-4 py-0.5 pl-0.5 pr-2 text-xs text-fg-strong"
                >
                  <Avatar user={u} size={18} />
                  <span className="truncate">{u.displayName}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelect(u.uid)
                    }}
                    className="ml-0.5 rounded p-0.5 text-fg-subtle transition hover:bg-fill-4 hover:text-fg"
                    aria-label={`Remove ${u.displayName}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))
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
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email"
                className="w-full rounded-md bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
              />
            </div>
            <div className="max-h-44 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-fg-subtle">
                  No users found.
                </div>
              ) : (
                filtered.map((u) => {
                  const selected = isSelected(u.uid)
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => handleSelect(u.uid)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition ${
                        selected ? 'bg-brand-soft text-fg' : 'text-fg-strong hover:bg-fill-2'
                      }`}
                    >
                      <Avatar user={u} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{u.displayName}</div>
                        <div className="truncate text-xs text-fg-subtle">{u.email}</div>
                      </div>
                      {selected && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })
              )}
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setNewMemberOpen(true)
                }}
                className="flex shrink-0 w-full items-center gap-2 border-t border-line bg-fill-1 px-4 py-3 text-sm font-medium text-brand transition hover:bg-fill-2 hover:text-brand"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create new member
              </button>
            )}
          </div>,
          document.body,
        )}

      {canCreate && (
        <NewMemberModal
          open={newMemberOpen}
          onClose={() => setNewMemberOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  )
}