import { useCallback, useEffect, useState } from 'react'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { setUserRole } from '../lib/firestore'
import { createMember, generateTempPassword } from '../lib/createMember'
import { usePaginatedQuery } from '../hooks/usePaginatedQuery'
import type { GlobalRole, User } from '../types/models'
import AdminActionBar from '../components/admin/AdminActionBar'
import SearchInput from '../components/ui/SearchInput'
// DEV-ONLY: one-shot onboarding reset. Delete this import + the block below
// (search for "DEV-ONLY") after running once.
import usersToImport from '../scripts/users_to_import.json'

const SUPER_ADMIN_EMAIL = 'dhruv.sharma1@eventstrat.ai'
const PRESERVE_EMAILS = new Set(
  [SUPER_ADMIN_EMAIL, 'test1@yahoo.com', 'csa@es.com'].map((e) => e.toLowerCase()),
)

const PAGE_SIZE = 25

const ROLE_OPTIONS: { value: GlobalRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin (VH pool)' },
  { value: 'horizontal_lead', label: 'Horizontal Lead' },
  { value: 'user', label: 'User' },
]

function rolePillClass(role: GlobalRole): string {
  switch (role) {
    case 'super_admin':
      return 'border-tone-warn-bd bg-tone-warn-bg text-tone-warn-fg'
    case 'admin':
      return 'border-brand-edge bg-brand-soft text-brand'
    case 'horizontal_lead':
      return 'border-tone-cool-bd bg-tone-cool-bg text-tone-cool-fg'
    default:
      return 'border-line bg-fill-2 text-fg-muted'
  }
}

function roleLabel(role: GlobalRole): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role
}

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

export default function AdminMembers() {
  const { user: firebaseUser, profile } = useAuth()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingRoleUid, setPendingRoleUid] = useState<string | null>(null)
  const canEditRoles = profile?.globalRole === 'super_admin'

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 600)
    return () => clearTimeout(t)
  }, [search])

  const buildQuery = useCallback(
    (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      const usersRef = collection(db, 'users')
      const constraints = []
      if (debouncedSearch) {
        constraints.push(where('displayNameLower', '>=', debouncedSearch))
        constraints.push(where('displayNameLower', '<=', debouncedSearch + ''))
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

  const { items: users, setItems: setUsers, loading, loadingMore, hasMore, loadMore, error } = usePaginatedQuery<User>(
    buildQuery,
    PAGE_SIZE,
    [debouncedSearch],
    (snap) => snap.data() as User,
  )

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

  // ─── DEV-ONLY: onboarding reset (remove after running once) ───────────────
  const [resetBusy, setResetBusy] = useState<null | 'users' | 'teams'>(null)

  async function handleResetAndImportUsers() {
    if (!firebaseUser || !profile) return
    if (profile.email?.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
      alert(`Sign in as ${SUPER_ADMIN_EMAIL} before running this.`)
      return
    }
    if (
      !window.confirm(
        `This will DELETE all users except ${SUPER_ADMIN_EMAIL} and import ${usersToImport.length} new users. Continue?`,
      )
    )
      return
    if (!window.confirm('Last chance. This cannot be undone. Proceed?')) return

    setResetBusy('users')
    console.log('=== Reset & import users: starting ===')
    try {
      const snap = await getDocs(collection(db, 'users'))
      const toDelete = snap.docs.filter(
        (d) => !PRESERVE_EMAILS.has(String(d.data().email ?? '').toLowerCase()),
      )
      console.log(
        `Found ${snap.size} users; deleting ${toDelete.length}; preserving ${snap.size - toDelete.length}`,
      )

      let batchNum = 0
      const queue = [...toDelete]
      while (queue.length > 0) {
        const chunk = queue.splice(0, 400)
        const batch = writeBatch(db)
        chunk.forEach((d) => batch.delete(d.ref))
        await batch.commit()
        batchNum++
        console.log(`Delete batch ${batchNum}: ${chunk.length} docs committed`)
      }

      const adminName = profile.displayName ?? firebaseUser.email ?? 'Admin'
      const results: { email: string; ok: boolean; error?: string }[] = []
      for (let i = 0; i < usersToImport.length; i++) {
        const u = usersToImport[i] as { email: string; displayName: string }
        try {
          await createMember(
            u.email,
            u.displayName,
            generateTempPassword(),
            firebaseUser.uid,
            adminName,
            'user',
          )
          results.push({ email: u.email, ok: true })
          console.log(`OK  [${i + 1}/${usersToImport.length}] ${u.email}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          results.push({ email: u.email, ok: false, error: msg })
          console.error(`ERR [${i + 1}/${usersToImport.length}] ${u.email}: ${msg}`)
        }
      }

      const okCount = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      console.log(`=== Done. ${okCount} created, ${failed.length} failed. ===`)
      if (failed.length > 0) console.table(failed)
      alert(
        `Done. ${okCount} created, ${failed.length} failed.\nCheck console for per-row detail.`,
      )
    } catch (err) {
      console.error('Reset failed:', err)
      alert('Reset failed. Check console.')
    } finally {
      setResetBusy(null)
    }
  }

  async function handleResumeImport() {
    if (!firebaseUser || !profile) return
    if (profile.email?.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
      alert(`Sign in as ${SUPER_ADMIN_EMAIL} before running this.`)
      return
    }

    setResetBusy('users')
    console.log('=== Resume import: starting ===')
    try {
      // Skip emails that already exist in Firestore (idempotent resume).
      const snap = await getDocs(collection(db, 'users'))
      const existing = new Set<string>()
      snap.docs.forEach((d) => {
        const e = String(d.data().email ?? '').toLowerCase()
        if (e) existing.add(e)
      })
      const remaining = (usersToImport as { email: string; displayName: string }[]).filter(
        (u) => !existing.has(u.email.toLowerCase()),
      )
      console.log(
        `${existing.size} users already in Firestore; ${remaining.length} to import.`,
      )
      if (remaining.length === 0) {
        alert('Nothing to import — all roster users already exist.')
        return
      }
      if (!window.confirm(`Import ${remaining.length} missing users? Continue?`)) return

      const adminName = profile.displayName ?? firebaseUser.email ?? 'Admin'
      const results: { email: string; ok: boolean; error?: string }[] = []
      let rateLimited = false

      for (let i = 0; i < remaining.length; i++) {
        const u = remaining[i]
        try {
          await createMember(
            u.email,
            u.displayName,
            generateTempPassword(),
            firebaseUser.uid,
            adminName,
            'user',
          )
          results.push({ email: u.email, ok: true })
          console.log(`OK  [${i + 1}/${remaining.length}] ${u.email}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          results.push({ email: u.email, ok: false, error: msg })
          console.error(`ERR [${i + 1}/${remaining.length}] ${u.email}: ${msg}`)
          // Firebase Auth rate-limits createUser at ~100/hour per IP.
          // Once we hit it, every subsequent call fails — abort instead of burning the list.
          if (msg.includes('too-many-requests')) {
            rateLimited = true
            console.warn('Hit auth/too-many-requests — aborting. Wait ~1 hour and click Resume Import again.')
            break
          }
        }
        // Light throttle to spread calls and avoid bursty patterns
        await new Promise((r) => setTimeout(r, 500))
      }

      const okCount = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      console.log(`=== Done. ${okCount} created, ${failed.length} failed. ===`)
      if (failed.length > 0) console.table(failed)
      alert(
        rateLimited
          ? `Rate-limited by Firebase. ${okCount} created this run. Wait ~1 hour, then click Resume Import again.`
          : `Done. ${okCount} created, ${failed.length} failed.\nCheck console for per-row detail.`,
      )
    } catch (err) {
      console.error('Resume import failed:', err)
      alert('Resume import failed. Check console.')
    } finally {
      setResetBusy(null)
    }
  }

  async function handleDeleteAllTeams() {
    if (!window.confirm('This will DELETE all teams. Continue?')) return
    if (!window.confirm('Last chance. This cannot be undone. Proceed?')) return

    setResetBusy('teams')
    console.log('=== Delete all teams: starting ===')
    try {
      const snap = await getDocs(collection(db, 'teams'))
      console.log(`Found ${snap.size} teams to delete`)

      const docs = [...snap.docs]
      const total = docs.length
      let batchNum = 0
      while (docs.length > 0) {
        const chunk = docs.splice(0, 400)
        const batch = writeBatch(db)
        chunk.forEach((d) => batch.delete(d.ref))
        await batch.commit()
        batchNum++
        console.log(`Delete batch ${batchNum}: ${chunk.length} teams committed`)
      }

      console.log(`=== Done. ${total} teams deleted. ===`)
      alert(`Deleted ${total} teams.`)
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Delete failed. Check console.')
    } finally {
      setResetBusy(null)
    }
  }
  // ─── /DEV-ONLY ─────────────────────────────────────────────────────────────

  async function changeRole(u: User, nextRole: GlobalRole) {
    if (firebaseUser?.uid === u.uid) return // can't change your own role
    if (u.globalRole === nextRole) return
    if (!firebaseUser) return
    setPendingRoleUid(u.uid)
    try {
      await setUserRole({
        uid: u.uid,
        fromRole: u.globalRole,
        toRole: nextRole,
        actorId: firebaseUser.uid,
        actorName: profile?.displayName ?? firebaseUser.email ?? 'Admin',
        targetName: u.displayName,
      })
      setUsers((prev) => prev.map((m) => (m.uid === u.uid ? { ...m, globalRole: nextRole } : m)))
    } finally {
      setPendingRoleUid(null)
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

      {/* ─── DEV-ONLY: onboarding reset (remove this block after running once) ─── */}
      {/* {profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-tone-danger-fg">
            Temp admin tools
          </span>
          <button
            type="button"
            onClick={handleDeleteAllTeams}
            disabled={resetBusy !== null}
            style={{ background: '#dc2626', color: '#fff', padding: '8px 16px', borderRadius: 6, fontWeight: 600 }}
            className="text-sm disabled:opacity-60"
          >
            {resetBusy === 'teams' ? 'Deleting teams…' : 'TEMP: Delete All Teams'}
          </button>
          <button
            type="button"
            onClick={handleResetAndImportUsers}
            disabled={resetBusy !== null}
            style={{ background: '#dc2626', color: '#fff', padding: '8px 16px', borderRadius: 6, fontWeight: 600 }}
            className="text-sm disabled:opacity-60"
          >
            {resetBusy === 'users'
              ? 'Resetting users…'
              : `TEMP: Reset & Import Users (${usersToImport.length})`}
          </button>
          <button
            type="button"
            onClick={handleResumeImport}
            disabled={resetBusy !== null}
            style={{ background: '#7c3aed', color: '#fff', padding: '8px 16px', borderRadius: 6, fontWeight: 600 }}
            className="text-sm disabled:opacity-60"
            title="Idempotent — skips emails already in Firestore. Use after auth/too-many-requests cooldown."
          >
            {resetBusy === 'users' ? 'Importing…' : 'TEMP: Resume Import (skip existing)'}
          </button>
          <span className="ml-auto text-xs text-tone-danger-fg/80">
            Destructive. Open DevTools console first.
          </span>
        </div>
      )} */}
      {/* ─── /DEV-ONLY ─────────────────────────────────────────────────────────── */}

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
                  const roleUpdating = pendingRoleUid === u.uid
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
                        <span
                          className={`inline-flex min-w-24 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${rolePillClass(u.globalRole)}`}
                        >
                          {roleLabel(u.globalRole)}
                        </span>
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
                        <div className="flex items-center justify-end gap-2">
                          {u.tempPassword && (
                            <button
                              type="button"
                              onClick={() => copyCredentials(u)}
                              title='Copy User Credentials'
                              className="inline-flex min-w-20 items-center justify-center whitespace-nowrap rounded-md border border-line bg-fill-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-fill-4"
                            >
                              {isCopied ? 'Copied' : 'Copy'}
                            </button>
                          )}
                          {canEditRoles && !isSelf ? (
                            <div className="relative">
                              <select
                                value={u.globalRole}
                                onChange={(e) => changeRole(u, e.target.value as GlobalRole)}
                                disabled={roleUpdating}
                                title="Change role"
                                className="appearance-none rounded-md border border-line bg-fill-2 px-2.5 py-1.5 pr-7 text-xs font-medium text-fg-muted outline-none transition hover:bg-fill-4 focus:border-brand-edge focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value} className="bg-overlay">
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <svg
                                className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                              {roleUpdating && (
                                <span className="ml-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg-strong align-middle" />
                              )}
                            </div>
                          ) : (
                            <span
                              className="inline-flex min-w-20 items-center justify-center whitespace-nowrap rounded-md border border-line bg-fill-2 px-2.5 py-1.5 text-xs font-medium text-fg-subtle"
                              title={isSelf ? "You can't change your own role" : 'Only super admins can change roles'}
                            >
                              {isSelf ? 'You' : 'Locked'}
                            </span>
                          )}
                        </div>
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
    </div>
  )
}