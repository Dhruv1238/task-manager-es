import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Timestamp,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useOrgStructure } from '../contexts/AppConfigContext'
import { setUserRoles, tenantCol } from '../lib/firestore'
import { usePaginatedQuery } from '../hooks/usePaginatedQuery'
import type { User } from '../types/models'
import type { RoleDef } from '../types/v2'
import AdminActionBar from '../components/admin/AdminActionBar'
import SearchInput from '../components/ui/SearchInput'
import Modal from '../components/ui/Modal'

const PAGE_SIZE = 25

function initials(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  const d = ts.toDate()
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Read-only chips of the configured roles a user holds.
function RoleChips({ user, roles }: { user: User; roles: RoleDef[] }) {
  const held = roles.filter((r) => (user.roleIds ?? []).includes(r.id))
  if (held.length === 0) return <span className="text-fg-faint">— none —</span>
  return (
    <span className="flex flex-wrap gap-1">
      {held.map((r) => (
        <span
          key={r.id}
          className="inline-flex items-center rounded-full border border-brand-edge bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
        >
          {r.label}
        </span>
      ))}
    </span>
  )
}

// Modal checklist for assigning the configured roles a user holds. The platform
// tier (super-admin / admin) is derived from these — there's no separate role
// ladder anymore.
function RoleAssignModal({
  open,
  user,
  roles,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  user: User | null
  roles: RoleDef[]
  saving: boolean
  onClose: () => void
  onSave: (uid: string, roleIds: string[]) => void
}) {
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => {
    if (user) setSel(user.roleIds ?? [])
  }, [user])
  if (!user) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Roles · ${user.displayName}`}
      description="Assign the roles this person holds. Their access tier is derived from these roles."
      closeOnBackdrop={!saving}
    >
      <div className="space-y-1">
        {roles.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            No roles defined yet — set them up under Roles &amp; access first.
          </p>
        ) : (
          [...roles]
            .sort((a, b) => a.level - b.level || a.order - b.order)
            .map((r) => {
              const on = sel.includes(r.id)
              return (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-fg-muted transition hover:bg-fill-2"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setSel(on ? sel.filter((x) => x !== r.id) : [...sel, r.id])}
                  />
                  <span className="min-w-0 flex-1 truncate text-fg">{r.label}</span>
                  <span className="text-xs text-fg-subtle">Level {r.level}</span>
                </label>
              )
            })
        )}
      </div>
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="flex-1 rounded-lg border border-line bg-fill-2 px-4 py-2.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(user.uid, sel)}
          disabled={saving}
          className="flex-1 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save roles'}
        </button>
      </div>
    </Modal>
  )
}

export default function AdminMembers() {
  const { user: firebaseUser, profile } = useAuth()
  const org = useOrgStructure()
  const hierarchyRoles = useMemo(() => org.roleHierarchy ?? [], [org.roleHierarchy])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<User | null>(null)
  const [savingRoles, setSavingRoles] = useState(false)
  const canEditRoles = profile?.globalRole === 'super_admin'

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 600)
    return () => clearTimeout(t)
  }, [search])

  const buildQuery = useCallback(
    (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      const usersRef = tenantCol('users')
      const constraints = []
      if (debouncedSearch) {
        constraints.push(where('displayNameLower', '>=', debouncedSearch))
        constraints.push(where('displayNameLower', '<=', debouncedSearch + ''))
        constraints.push(orderBy('displayNameLower'))
      } else {
        constraints.push(orderBy('createdAt', 'desc'))
      }
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(PAGE_SIZE))
      return query(usersRef, ...constraints)
    },
    [debouncedSearch],
  )

  const { items: users, setItems: setUsers, loading, loadingMore, hasMore, loadMore, error } =
    usePaginatedQuery<User>(buildQuery, PAGE_SIZE, [debouncedSearch], (snap) => snap.data() as User)

  function toggleReveal(uid: string) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function copyCredentials(u: User) {
    if (!u.tempPassword) return
    await navigator.clipboard.writeText(`ID: ${u.email} \nPassword: ${u.tempPassword}`)
    setCopiedId(u.uid)
    setTimeout(() => setCopiedId((id) => (id === u.uid ? null : id)), 2000)
  }

  async function saveRoles(uid: string, nextRoleIds: string[]) {
    const target = users.find((u) => u.uid === uid)
    if (!firebaseUser || !target) return
    const fromRoleIds = target.roleIds ?? []
    setSavingRoles(true)
    try {
      await setUserRoles({
        uid,
        roleIds: nextRoleIds,
        fromRoleIds,
        actorId: firebaseUser.uid,
        actorName: profile?.displayName ?? firebaseUser.email ?? 'Admin',
        targetName: target.displayName,
      })
      setUsers((prev) => prev.map((m) => (m.uid === uid ? { ...m, roleIds: nextRoleIds } : m)))
      setEditing(null)
    } finally {
      setSavingRoles(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">Members</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-fg-subtle">
            {loading && users.length === 0 ? (
              'Loading…'
            ) : (
              <>
                <span>
                  Showing {users.length} user{users.length === 1 ? '' : 's'}
                  {hasMore ? '+' : ''}
                </span>
                {loading && (
                  <span
                    className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong"
                    aria-label="Refreshing"
                  />
                )}
              </>
            )}
          </p>
        </div>
        <AdminActionBar />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search members"
          infoText="Matches member names that start with what you type. Search is case-insensitive."
          className="flex-1 max-w-sm"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-fill-1">
              <tr className="text-left text-xs uppercase tracking-wider text-fg-subtle">
                <th className="px-6 py-3 font-medium">Member</th>
                <th className="px-6 py-3 font-medium">Role</th>
                <th className="px-6 py-3 font-medium">Teams</th>
                <th className="px-6 py-3 font-medium">Temp password</th>
                <th className="px-6 py-3 font-medium">Created</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-fg-subtle">
                    Loading members…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-tone-danger-fg/80">
                    Couldn't load members. {error.message}
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-fg-subtle">
                    {debouncedSearch
                      ? 'No members match your search.'
                      : 'No members yet. Click "+ New Member" to provision one.'}
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = firebaseUser?.uid === u.uid
                  const isRevealed = revealed.has(u.uid)
                  const isCopied = copiedId === u.uid
                  return (
                    <tr key={u.uid} className="transition hover:bg-fill-1">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient-br text-xs font-semibold text-white">
                            {initials(u)}
                          </div>
                          <div>
                            <div className="font-medium text-fg">
                              {u.displayName}
                              {isSelf && (
                                <span className="ml-2 text-xs font-normal text-fg-subtle">(you)</span>
                              )}
                            </div>
                            <div className="text-xs text-fg-subtle">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <RoleChips user={u} roles={hierarchyRoles} />
                          {canEditRoles && !isSelf && (
                            <button
                              type="button"
                              onClick={() => setEditing(u)}
                              className="shrink-0 text-xs text-brand transition hover:underline"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-fg-muted">{u.teamIds?.length ?? 0}</td>
                      <td className="px-6 py-4">
                        {u.tempPassword ? (
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-fill-2 px-2 py-1 font-mono text-xs text-fg-muted">
                              {isRevealed ? u.tempPassword : '••••••••••••'}
                            </code>
                            <button
                              type="button"
                              onClick={() => toggleReveal(u.uid)}
                              className="rounded p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-muted"
                              aria-label={isRevealed ? 'Hide password' : 'Reveal password'}
                            >
                              {isRevealed ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                  <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>
                              ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-fg-muted">{formatDate(u.createdAt)}</td>
                      <td className="px-6 py-4 text-right">
                        {u.tempPassword && (
                          <button
                            type="button"
                            onClick={() => copyCredentials(u)}
                            title="Copy user credentials"
                            className="inline-flex min-w-20 items-center justify-center whitespace-nowrap rounded-md border border-line bg-fill-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4"
                          >
                            {isCopied ? 'Copied' : 'Copy'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}

      <RoleAssignModal
        open={Boolean(editing)}
        user={editing}
        roles={hierarchyRoles}
        saving={savingRoles}
        onClose={() => setEditing(null)}
        onSave={saveRoles}
      />
    </div>
  )
}
