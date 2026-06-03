import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck, Save, Sparkles, ArrowRight, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useOrgStructure, useAppConfigContext } from '../contexts/AppConfigContext'
import { useAllUsers } from '../hooks/useAllUsers'
import RoleHierarchyBuilder from '../components/authoring/RoleHierarchyBuilder'
import ModuleAccessGrid from '../components/authoring/ModuleAccessGrid'
import UserPicker from '../components/ui/UserPicker'
import {
  saveRoleHierarchy,
  starterHierarchy,
} from '../lib/permissions/roleHierarchyAuthoring'
import { setUserRoles } from '../lib/firestore'
import type { HierarchyLevel, RoleDef } from '../types/v2'

// Phase 3: the "who and what they can touch" surface — N-level hierarchy +
// module × CRUD access. Additive: it writes roleHierarchy/hierarchyLevels onto
// the orgStructure doc and never touches setupCompleted / leadRoleName /
// teamRoles, so the sandbox Phase-B gate and seeded team_role actors are
// untouched (no-break minimum). Reachable at /admin/roles.
export default function RolesHierarchy() {
  const { user, profile } = useAuth()
  const org = useOrgStructure()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const onboarding = search.get('onboarding') === '1'
  const { setOrgStructureOptimistic } = useAppConfigContext()
  const { users } = useAllUsers()

  // Membership is assigned against the PERSISTED roles (a stable id must exist on
  // a user's roleIds), independent of the in-progress hierarchy edit above.
  const savedRoles = useMemo(() => org.roleHierarchy ?? [], [org.roleHierarchy])

  // Add/remove members for one role by rewriting each affected user's roleIds.
  // useAllUsers is a live snapshot, so the lists refresh on commit.
  async function saveRoleMembers(roleId: string, nextUids: string[]) {
    if (!user) return
    const actorName = profile?.displayName ?? user.email ?? 'Admin'
    const current = users.filter((u) => (u.roleIds ?? []).includes(roleId)).map((u) => u.uid)
    const nextSet = new Set(nextUids)
    const curSet = new Set(current)
    const added = nextUids.filter((uid) => !curSet.has(uid))
    const removed = current.filter((uid) => !nextSet.has(uid))
    for (const uid of [...added, ...removed]) {
      const u = users.find((x) => x.uid === uid)
      if (!u) continue
      const from = u.roleIds ?? []
      const to = added.includes(uid) ? [...from, roleId] : from.filter((r) => r !== roleId)
      await setUserRoles({
        uid,
        roleIds: to,
        fromRoleIds: from,
        actorId: user.uid,
        actorName,
        targetName: u.displayName,
      })
    }
  }

  const seeded = useMemo(() => starterHierarchy(org), [org])
  const [levels, setLevels] = useState<HierarchyLevel[]>(org.hierarchyLevels ?? seeded.levels)
  const [roles, setRoles] = useState<RoleDef[]>(org.roleHierarchy ?? seeded.roles)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed from org when it loads in (cache hydrate after mount).
  useEffect(() => {
    if (org.roleHierarchy?.length) {
      setRoles(org.roleHierarchy)
      setLevels(org.hierarchyLevels ?? seeded.levels)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.roleHierarchy])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      await saveRoleHierarchy(user.uid, levels, roles)
      setOrgStructureOptimistic({
        ...org,
        roleHierarchy: roles,
        hierarchyLevels: levels,
      })
      if (onboarding) {
        // Hand off to flow authoring — the next gated onboarding step.
        navigate('/admin/workflows/new?onboarding=1', { replace: true })
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the hierarchy.')
    } finally {
      setSaving(false)
    }
  }

  function applyStarter() {
    setLevels(seeded.levels)
    setRoles(seeded.roles)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md shadow-purple-900/30">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">Roles &amp; access</h1>
            <p className="text-xs text-fg-subtle">
              Define your authority levels and what each role can touch. Higher levels inherit lower
              levels&rsquo; access.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!roles.length && (
            <button
              type="button"
              onClick={applyStarter}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg-muted transition hover:bg-fill-3 hover:text-fg"
            >
              <Sparkles size={14} /> Suggest a starter
            </button>
          )}
          {onboarding && (
            <button
              type="button"
              onClick={() => navigate('/admin/workflows/new?onboarding=1', { replace: true })}
              className="text-sm text-fg-subtle transition hover:text-fg"
            >
              Skip for now
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient disabled:opacity-60"
          >
            {onboarding ? <ArrowRight size={15} /> : <Save size={15} />}{' '}
            {saving ? 'Saving…' : onboarding ? 'Save & continue' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          {error}
        </div>
      )}

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
            Hierarchy
          </h2>
          <RoleHierarchyBuilder
            levels={levels}
            roles={roles}
            onChangeLevels={setLevels}
            onChangeRoles={setRoles}
          />
        </section>

        {roles.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
              Module access
            </h2>
            <ModuleAccessGrid roles={roles} onChange={setRoles} />
          </section>
        )}

        {!onboarding && savedRoles.length > 0 && users.length > 0 && (
          <section>
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-fg-subtle">
              <Users size={14} /> Members
            </h2>
            <p className="mb-3 text-xs text-fg-subtle">
              Assign people to each role. A person also inherits every lower-authority role&rsquo;s
              access. {savedRoles.length !== roles.length && 'Save the hierarchy above to assign members to new roles.'}
            </p>
            <div className="space-y-3 rounded-2xl border border-line bg-card p-5">
              {[...savedRoles]
                .sort((a, b) => a.level - b.level || a.order - b.order)
                .map((role) => {
                  const holders = users
                    .filter((u) => (u.roleIds ?? []).includes(role.id))
                    .map((u) => u.uid)
                  return (
                    <div
                      key={role.id}
                      className="flex flex-col gap-2 border-b border-line-subtle pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 sm:w-44 sm:shrink-0">
                        <div className="truncate text-sm font-medium text-fg">{role.label}</div>
                        <div className="text-[11px] text-fg-subtle">Level {role.level}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <UserPicker
                          mode="multi"
                          value={holders}
                          onChange={(v) => void saveRoleMembers(role.id, v)}
                          placeholder={`Add people to ${role.label}`}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          </section>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={() => navigate('/admin/config')}
          className="text-xs text-fg-subtle transition hover:text-fg"
        >
          Back to config
        </button>
      </div>
    </div>
  )
}
