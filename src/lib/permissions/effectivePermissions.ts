/**
 * Phase 3 — effective permissions (Layer 1 RBAC).
 *
 * Pure functions over the tenant's RoleDef[] (the N-level hierarchy authored in
 * onboarding Step 1, stored on orgStructure.roleHierarchy) + a user. Higher
 * authority (lower level number) inherits the UNION of every lower level's
 * module grants.
 *
 * v2 deliberately skips the persisted /profiles cache + permissionsVersion stamp
 * from the base plan: this compute is an O(roles) array pass with no I/O, so it
 * runs fresh inside a useMemo on every render — no cache to invalidate, no
 * staleness window. (The cache was a scale optimisation we don't need yet.)
 *
 * Which RoleDefs a user "holds" in v2:
 *   - explicit assignment (user.roleIds, set from the Members / Roles pages), OR
 *   - the legacy bridge by globalRole (RoleDef.legacyGlobalRole === user.globalRole).
 * The two are unioned. A user with neither holds no hierarchy role, `can()`
 * returns false, and usePermissions falls back to the coarse flags (isAdmin /
 * isProjectCreator).
 */

import type { EffectivePermissions, ModuleGrant, ModuleOp, RoleDef } from '../../types/v2'
import type { User } from '../../types/models'

const EMPTY: EffectivePermissions = { grants: {}, effectiveRoleIds: [], topLevel: null }

function emptyGrant(): ModuleGrant {
  return { view: false, create: false, update: false, delete: false }
}

// The RoleDefs a user directly holds: explicit per-user assignment (user.roleIds)
// unioned with the legacy globalRole bridge.
function heldRoles(user: User, roles: RoleDef[]): RoleDef[] {
  const explicit = user.roleIds ?? []
  return roles.filter(
    (r) =>
      explicit.includes(r.id) ||
      (r.legacyGlobalRole && r.legacyGlobalRole === user.globalRole),
  )
}

export function computeEffectivePermissions(user: User, roles: RoleDef[]): EffectivePermissions {
  if (!roles.length) return EMPTY
  const held = heldRoles(user, roles)
  if (!held.length) return EMPTY

  // Highest authority the user occupies (lowest level number).
  const topLevel = Math.min(...held.map((r) => r.level))

  // Inheritance DOWN the chain: a user at level j effectively holds every role
  // at level >= j (i.e. equal or lower authority).
  const effective = roles.filter((r) => r.level >= topLevel)
  const effectiveRoleIds = effective.map((r) => r.id)

  // Union module grants across every effective role.
  const grants: Record<string, ModuleGrant> = {}
  for (const r of effective) {
    for (const [moduleId, g] of Object.entries(r.moduleGrants ?? {})) {
      const acc = grants[moduleId] ?? emptyGrant()
      grants[moduleId] = {
        view: acc.view || g.view,
        create: acc.create || g.create,
        update: acc.update || g.update,
        delete: acc.delete || g.delete,
      }
    }
  }

  return { grants, effectiveRoleIds, topLevel }
}

// Layer-1 capability check. False when the user holds no hierarchy role.
export function can(
  eff: EffectivePermissions | null | undefined,
  moduleId: string,
  op: ModuleOp,
): boolean {
  return Boolean(eff?.grants[moduleId]?.[op])
}

// Does this user hold `roleId` — exactly or by level inheritance? Mirrors the
// `role`-actor match in workflowEvaluator (a higher-authority holder counts as
// holding a lower role), but is a pure user×roles test with no project context.
export function userHoldsRole(user: User, roleId: string, roles: RoleDef[]): boolean {
  const referenced = roles.find((r) => r.id === roleId)
  if (!referenced) return false
  const eff = computeEffectivePermissions(user, roles)
  if (eff.effectiveRoleIds.includes(roleId)) return true
  return eff.topLevel != null && eff.topLevel <= referenced.level
}

// Enumerate the uids that hold `roleId` (explicit or inherited) out of a user
// directory. Used to seed project.accessKeys / inbox routing for `role`-kind
// actors. Super-admins are intentionally NOT sprayed in here — they already have
// universal access via isSuperAdmin / actorMatches — same posture as the
// global_role enumeration in getInvolvedUids.
export function resolveRoleHolders(roleId: string, users: User[], roles: RoleDef[]): string[] {
  if (!roles.find((r) => r.id === roleId)) return []
  const out: string[] = []
  for (const u of users) {
    if (u.globalRole === 'super_admin') continue
    if (userHoldsRole(u, roleId, roles)) out.push(u.uid)
  }
  return out
}

// Users who EXPLICITLY hold `roleId` — via their assigned roleIds or the legacy
// globalRole bridge — WITHOUT the downward authority-inheritance that
// resolveRoleHolders applies. Used for assignment pickers ("choose a Vertical
// Head"): the candidate pool must be people who ARE that role, not everyone
// whose authority level sits at/above it. Super-admins assigned the role ARE
// included (you may legitimately pick one as the assignee).
export function resolveExactRoleHolders(roleId: string, users: User[], roles: RoleDef[]): string[] {
  if (!roles.find((r) => r.id === roleId)) return []
  return users
    .filter((u) => heldRoles(u, roles).some((r) => r.id === roleId))
    .map((u) => u.uid)
}
