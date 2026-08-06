import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
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
import { tenantCol, tenantDoc } from '../../lib/firestore'
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
    getDoc(tenantDoc('projects', value))
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

  // Single uid match — accessKeys is a flat set of user uids; team membership is
  // no longer an access vector, so there's no team-id expansion or 30-key cap.
  const accessUid = profile?.uid ?? null

  // Auto-select the first visible project when enabled and no value is set.
  // Ref-held onChange so we don't churn the effect on every parent render.
  // The once-per-mount latch matters twice over: (a) the deps are primitives
  // (accessUid, not the profile object) so a users/{uid} write elsewhere can't
  // re-fire this query, and (b) when the query returns EMPTY, `value` stays
  // null forever — without the latch that combination re-ran the getDocs on
  // every profile snapshot for the life of the mount.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  const autoSelectRanRef = useRef(false)
  useEffect(() => {
    // accessUid doubles as the "profile loaded" gate (uid is always set once
    // the profile doc arrives) — a primitive, unlike the profile object.
    if (!autoSelectFirst || value || !accessUid || autoSelectRanRef.current) return
    autoSelectRanRef.current = true
    const projectsRef = tenantCol('projects')
    const constraints = []
    if (!isAdmin) {
      constraints.push(where('accessKeys', 'array-contains', accessUid))
    }
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(1))
    getDocs(query(projectsRef, ...constraints))
      .then((snap) => {
        const first = snap.docs[0]
        if (first) onChangeRef.current(first.id)
      })
      .catch(() => {
        // Release the latch so a genuine dep change can retry. Safe: the
        // profile object is no longer a dep, so profile snapshots can't
        // re-fire this — which is what caused the read churn. An empty
        // result still latches (via .then), so we don't re-query forever.
        autoSelectRanRef.current = false
      })
  }, [autoSelectFirst, value, isAdmin, accessUid])

  const buildQuery = useCallback(
    (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!open || !profile) return null
      const projectsRef = tenantCol('projects')
      const constraints = []
      if (!isAdmin) {
        if (!accessUid) return null
        constraints.push(where('accessKeys', 'array-contains', accessUid))
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
    [accessUid, debouncedSearch, isAdmin, open, profile],
  )

  const { items, loading, loadingMore, hasMore, loadMore } = usePaginatedQuery<Project>(
    buildQuery,
    PAGE_SIZE,
    [open, isAdmin, debouncedSearch, profile?.uid],
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
          className={`flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm transition ${
            isDisabled
              ? 'cursor-not-allowed text-fg-faint'
              : 'text-fg-strong hover:bg-fill-3'
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
            className="flex flex-col overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl"
          >
            <div className="shrink-0 border-b border-line p-2">
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Start typing a project name…"
                className="w-full rounded-md bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
              />
            </div>
            <div className="scrollbar-themed max-h-64 overflow-y-auto py-1">
              {loading && items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-fg-subtle">Loading…</div>
              ) : items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-fg-subtle">
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
                          active ? 'bg-brand-soft text-fg' : 'text-fg-muted hover:bg-fill-2'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{p.title}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-subtle">
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
                            className="text-brand"
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
                        className="flex w-full items-center justify-center gap-2 rounded-md border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loadingMore ? (
                          <>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong" />
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
