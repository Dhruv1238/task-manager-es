import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import type { GlobalRole, User } from '../types/models'
import AdminActionBar from '../components/admin/AdminActionBar'

const ROLE_OPTIONS: { value: GlobalRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin (VH pool)' },
  { value: 'horizontal_lead', label: 'Horizontal Lead' },
  { value: 'user', label: 'User' },
]

function rolePillClass(role: GlobalRole): string {
  switch (role) {
    case 'super_admin':
      return 'border-amber-400/40 bg-amber-500/15 text-amber-200'
    case 'admin':
      return 'border-purple-400/40 bg-purple-500/15 text-purple-200'
    case 'horizontal_lead':
      return 'border-sky-400/40 bg-sky-500/15 text-sky-200'
    default:
      return 'border-white/10 bg-white/4 text-white/70'
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
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingRoleUid, setPendingRoleUid] = useState<string | null>(null)
  const canEditRoles = profile?.globalRole === 'super_admin'

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      (snap) => {
        setUsers(snap.docs.map((d) => d.data() as User))
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [users, search])

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

  async function changeRole(u: User, nextRole: GlobalRole) {
    if (firebaseUser?.uid === u.uid) return // can't change your own role
    if (u.globalRole === nextRole) return
    setPendingRoleUid(u.uid)
    try {
      await updateDoc(doc(db, 'users', u.uid), { globalRole: nextRole })
    } finally {
      setPendingRoleUid(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Members</h1>
          <p className="mt-1 text-sm text-white/50">
            {loading ? 'Loading…' : `${users.length} user${users.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <AdminActionBar />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-lg border border-white/10 bg-white/4 py-2.5 pl-9 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/2">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-white/3">
              <tr className="text-left text-xs uppercase tracking-wider text-white/40">
                <th className="px-6 py-3 font-medium">Member</th>
                <th className="px-6 py-3 font-medium">Role</th>
                <th className="px-6 py-3 font-medium">Teams</th>
                <th className="px-6 py-3 font-medium">Temp password</th>
                <th className="px-6 py-3 font-medium">Created</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/40">
                    Loading members…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/40">
                    {users.length === 0
                      ? 'No members yet. Click "+ New Member" to provision one.'
                      : 'No members match your search.'}
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const isSelf = firebaseUser?.uid === u.uid
                  const isRevealed = revealed.has(u.uid)
                  const isCopied = copiedId === u.uid
                  const roleUpdating = pendingRoleUid === u.uid
                  return (
                    <tr key={u.uid} className="transition hover:bg-white/2">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 text-xs font-semibold text-white">
                            {initials(u)}
                          </div>
                          <div>
                            <div className="font-medium text-white">
                              {u.displayName}
                              {isSelf && (
                                <span className="ml-2 text-xs font-normal text-white/40">(you)</span>
                              )}
                            </div>
                            <div className="text-xs text-white/50">{u.email}</div>
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
                      <td className="px-6 py-4 text-white/70">{u.teamIds?.length ?? 0}</td>
                      <td className="px-6 py-4">
                        {u.tempPassword ? (
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-white/4 px-2 py-1 font-mono text-xs text-white/80">
                              {isRevealed ? u.tempPassword : '••••••••••••'}
                            </code>
                            <button
                              type="button"
                              onClick={() => toggleReveal(u.uid)}
                              className="rounded p-1 text-white/40 transition hover:bg-white/5 hover:text-white/80"
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
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-white/60">{formatDate(u.createdAt)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {u.tempPassword && (
                            <button
                              type="button"
                              onClick={() => copyCredentials(u)}
                              title='Copy User Credentials'
                              className="inline-flex min-w-20 items-center justify-center whitespace-nowrap rounded-md border border-white/10 bg-white/4 px-2.5 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/8"
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
                                className="appearance-none rounded-md border border-white/10 bg-white/4 px-2.5 py-1.5 pr-7 text-xs font-medium text-white/80 outline-none transition hover:bg-white/8 focus:border-purple-400/60 focus:ring-2 focus:ring-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value} className="bg-[#11111a]">
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <svg
                                className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/40"
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
                                <span className="ml-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/90 align-middle" />
                              )}
                            </div>
                          ) : (
                            <span
                              className="inline-flex min-w-20 items-center justify-center whitespace-nowrap rounded-md border border-white/10 bg-white/4 px-2.5 py-1.5 text-xs font-medium text-white/40"
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
    </div>
  )
}