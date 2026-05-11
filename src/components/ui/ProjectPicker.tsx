import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import { usePaginatedQuery } from '../../hooks/usePaginatedQuery'
import type { Project } from '../../types/models'

interface Props {
  value: string | null
  onChange: (next: string) => void
  // Optional pre-known title for `value`, so the trigger can render without an
  // extra round-trip when the caller already has the project loaded.
  selectedLabel?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  // When true and `value` is null, the picker fetches the first visible project
  // once and emits it via onChange. Useful for "default to most recent" UX.
  autoSelectFirst?: boolean
}

const PAGE_SIZE = 20

// Search bar (~52) + 6 rows (~216) + Load more (~44) + borders/padding.
const APPROX_POPOVER_HEIGHT = 360
const POPOVER_GAP = 8

type PopoverPos =
  | { mode: 'below'; top: number; left: number; width: number }
  | { mode: 'above'; bottom: number; left: number; width: number }

export default function ProjectPicker({
  value,
  onChange,
  selectedLabel,
  placeholder = 'Select a project',
  disabled = false,
  className = '',
  autoSelectFirst = false,
}: Props) {
  const { profile } = useAuth()
  const isAdmin = profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin'

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const [fetchedSelected, setFetchedSelected] = useState<{ id: string; title: string } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch('')
      setDebouncedSearch('')
    }
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 400)
    return () => clearTimeout(t)
  }, [search])

  // Fetch the selected project's title once, only if the caller didn't pre-supply
  // it. Handles the case where the selected project isn't on the current page of
  // results — the trigger should still show its name.
  useEffect(() => {
    if (!value || selectedLabel) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFetchedSelected(null)
      return
    }
    let cancelled = false
    getDoc(doc(db, 'projects', value))
      .then((snap) => {
        if (cancelled) return
        if (snap.exists()) {
          const data = snap.data() as Project
          setFetchedSelected({ id: snap.id, title: data.title })
        } else {
          setFetchedSelected(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setFetchedSelected(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, selectedLabel])

  const accessKeys = useMemo(() => {
    if (!profile) return []
    return [profile.uid, ...(profile.teamIds ?? [])].slice(0, 30)
  }, [profile])

  // Auto-select the first visible project when enabled and no value is set.
  // No ref/cancellation guards — once onChange fires, `value` becomes truthy
  // and the early-return at the top blocks re-runs. In StrictMode dev this
  // effect may run twice and fire getDocs twice; both resolve to the same id,
  // and onChange is idempotent for the parent's useState setter, so it's safe.
  // Ref-held onChange so we don't churn the effect on every parent render.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    if (!autoSelectFirst || value || !profile) return
    const projectsRef = collection(db, 'projects')
    const constraints = []
    if (!isAdmin) {
      if (accessKeys.length === 0) return
      constraints.push(where('accessKeys', 'array-contains-any', accessKeys))
    }
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(1))
    getDocs(query(projectsRef, ...constraints))
      .then((snap) => {
        const first = snap.docs[0]
        if (first) onChangeRef.current(first.id)
      })
      .catch(() => {
        // If the query fails we just leave value as null and let the user pick.
      })
  }, [autoSelectFirst, value, profile, isAdmin, accessKeys])

  const buildQuery = useCallback(
    (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!open || !profile) return null
      const projectsRef = collection(db, 'projects')
      const constraints = []
      if (!isAdmin) {
        if (accessKeys.length === 0) return null
        constraints.push(where('accessKeys', 'array-contains-any', accessKeys))
      }
      if (debouncedSearch) {
        constraints.push(where('titleLower', '>=', debouncedSearch))
        constraints.push(where('titleLower', '<=', debouncedSearch + '\uf8ff'))
        constraints.push(orderBy('titleLower'))
      } else {
        constraints.push(orderBy('createdAt', 'desc'))
      }
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(PAGE_SIZE))
      return query(projectsRef, ...constraints)
    },
    [accessKeys, debouncedSearch, isAdmin, open, profile],
  )

  const { items, loading, loadingMore, hasMore, loadMore } = usePaginatedQuery<Project>(
    buildQuery,
    PAGE_SIZE,
    [open, isAdmin, debouncedSearch, profile?.uid, (profile?.teamIds ?? []).join('|')],
    (snap) => ({ ...(snap.data() as Project), id: snap.id }),
  )

  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const triggerLabel = value
    ? selectedLabel ?? fetchedSelected?.title ?? '…'
    : placeholder
  const isDisabled = disabled || !profile

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
          onClick={() => !isDisabled && setOpen((o) => !o)}
          disabled={isDisabled}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm transition ${
            isDisabled
              ? 'cursor-not-allowed text-white/30'
              : 'text-white/85 hover:bg-white/6'
          }`}
        >
          <span className="min-w-0 truncate text-left">{triggerLabel}</span>
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
                placeholder="Start typing a project name…"
                className="w-full rounded-md bg-white/4 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
              />
            </div>
            <div className="scrollbar-dark max-h-64 overflow-y-auto py-1">
              {loading && items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-white/40">Loading…</div>
              ) : items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-white/40">
                  {debouncedSearch ? 'No projects match.' : 'No projects to show.'}
                </div>
              ) : (
                <>
                  {items.map((p) => {
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
                  })}
                  {hasMore && (
                    <div className="px-2 py-2">
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/4 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loadingMore ? (
                          <>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/90" />
                            Loading…
                          </>
                        ) : (
                          'Load more'
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
