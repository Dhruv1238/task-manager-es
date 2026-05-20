import { useMemo } from 'react'
import UserPicker from '../ui/UserPicker'
import { useAllUsers } from '../../hooks/useAllUsers'
import type { User } from '../../types/models'

interface Props {
  id?: string
  value: string | null
  onChange: (uid: string | null) => void
  // Uids the workflow surfaces as "Recommended" — soft hint, not a filter.
  recommendedUids: string[]
  // The full candidate pool (pickerScope-resolved). When empty / undefined,
  // the underlying UserPicker uses its default (all users).
  candidateUids?: string[]
  placeholder?: string
}

// Lead picker that surfaces a workflow's recommended leads as one-click
// chips ABOVE a standard UserPicker. The chips are a quick-pick affordance;
// the picker below remains the source of truth and any candidate-pool user
// is still selectable. Phase 2b — multi-workflow tenants benefit from
// per-workflow recommendation hints without losing flexibility.
export default function LeadPickerWithRecommendations({
  id,
  value,
  onChange,
  recommendedUids,
  candidateUids,
  placeholder,
}: Props) {
  const { users } = useAllUsers()

  // Intersection of recommended uids and the candidate pool (so we never
  // surface a chip the picker would refuse). Preserves recommendedUids
  // ordering so admins control the visual order via Manage Recommended Leads.
  const recommendedUsers = useMemo<User[]>(() => {
    if (recommendedUids.length === 0) return []
    const candidateSet = candidateUids ? new Set(candidateUids) : null
    const usersById = new Map(users.map((u) => [u.uid, u]))
    return recommendedUids
      .filter((uid) => (candidateSet ? candidateSet.has(uid) : true))
      .map((uid) => usersById.get(uid))
      .filter((u): u is User => Boolean(u))
  }, [recommendedUids, candidateUids, users])

  return (
    <div className="space-y-2">
      {recommendedUsers.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Recommended</p>
          <div className="flex flex-wrap gap-1.5">
            {recommendedUsers.map((u) => {
              const active = value === u.uid
              return (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => onChange(active ? null : u.uid)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                    active
                      ? 'border-brand-edge bg-brand-soft text-fg-strong ring-2 ring-brand-ring'
                      : 'border-line bg-fill-1 text-fg-muted hover:border-line-strong hover:bg-fill-2'
                  }`}
                >
                  <Initial user={u} />
                  {u.displayName || u.email}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <UserPicker
        id={id}
        mode="single"
        value={value}
        onChange={onChange}
        includeUids={candidateUids}
        placeholder={placeholder ?? 'Choose someone…'}
      />
    </div>
  )
}

function Initial({ user }: { user: User }) {
  const src = user.displayName || user.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-gradient-br text-[8px] font-semibold text-white"
      aria-hidden
    >
      {initials}
    </span>
  )
}
