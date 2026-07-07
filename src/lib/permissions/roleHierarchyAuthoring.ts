/**
 * Phase 3 — role hierarchy authoring helpers.
 *
 * The N-level hierarchy + module grants live ON the orgStructure doc
 * (roleHierarchy + hierarchyLevels), so saving is a single merge write that
 * rides the existing org cache. The legacy fields (leadRoleName, teamRoles,
 * setupCompleted) are NEVER touched here — the dual-write bridge that keeps
 * seeded team_role/pipeline_role actors resolving stays intact, and the sandbox
 * Phase-B gate (which reads setupCompleted) is never disturbed.
 */

import { serverTimestamp, setDoc } from 'firebase/firestore'
import { tenantDoc } from '../firestore'
import type { OrgStructure } from '../../types/models'
import type { HierarchyLevel, ModuleGrant, RoleDef } from '../../types/v2'
import { DEFAULT_MODULE_IDS } from '../../types/v2'

export function fullGrant(): ModuleGrant {
  return { view: true, create: true, update: true, delete: true }
}
export function noGrant(): ModuleGrant {
  return { view: false, create: false, update: false, delete: false }
}

function grantsFor(view: boolean, create = false, update = false, del = false): Record<string, ModuleGrant> {
  const out: Record<string, ModuleGrant> = {}
  for (const id of DEFAULT_MODULE_IDS) out[id] = { view, create, update, delete: del }
  // Credentials (temp-password visibility) is sensitive — never part of the
  // blanket starter grant. Authors enable it per-role in the access matrix.
  out.credentials = noGrant()
  return out
}

// A sensible starter hierarchy derived from the tenant's existing org. The
// author refines it; every role carries the legacy bridge tag so seeded flows
// keep resolving. Idempotent — only used to seed an empty builder.
export function starterHierarchy(org: OrgStructure): {
  levels: HierarchyLevel[]
  roles: RoleDef[]
} {
  const levels: HierarchyLevel[] = [
    { level: 1, label: 'Leadership' },
    { level: 2, label: org.leadRoleName || 'Project Lead' },
    { level: 3, label: 'Teams' },
  ]
  const roles: RoleDef[] = [
    {
      id: 'super-admin',
      label: 'Super Admin',
      level: 1,
      order: 0,
      moduleGrants: Object.fromEntries(DEFAULT_MODULE_IDS.map((id) => [id, fullGrant()])),
      legacyGlobalRole: 'super_admin',
    },
    {
      id: 'admin',
      label: 'Admin',
      level: 1,
      order: 1,
      moduleGrants: Object.fromEntries(DEFAULT_MODULE_IDS.map((id) => [id, fullGrant()])),
      legacyGlobalRole: 'admin',
    },
    {
      id: 'lead',
      label: org.leadRoleName || 'Project Lead',
      level: 2,
      order: 2,
      moduleGrants: grantsFor(true, false, true, false),
      legacyPipelineRole: 'lead',
    },
  ]
  if (org.teamRoles?.hasCoordinator) {
    roles.push({
      id: 'coordinator',
      label: 'Coordinator',
      level: 3,
      order: 3,
      moduleGrants: grantsFor(true),
      legacyTeamRoleId: 'coordinator',
    })
  }
  if (org.teamRoles?.hasValidator) {
    roles.push({
      id: 'validator',
      label: 'Validator',
      level: 3,
      order: 4,
      moduleGrants: grantsFor(true),
      legacyTeamRoleId: 'validator',
    })
  }
  if (org.teamRoles?.hasSpecialist) {
    roles.push({
      id: 'specialist',
      label: 'Specialist',
      level: 3,
      order: 5,
      moduleGrants: grantsFor(true),
      legacyTeamRoleId: 'specialist',
    })
  }
  return { levels, roles }
}

export async function saveRoleHierarchy(
  adminUid: string,
  levels: HierarchyLevel[],
  roles: RoleDef[],
): Promise<void> {
  await setDoc(
    tenantDoc('config', 'orgStructure'),
    {
      roleHierarchy: roles,
      hierarchyLevels: levels,
      updatedAt: serverTimestamp(),
      updatedBy: adminUid,
    },
    { merge: true },
  )
}
