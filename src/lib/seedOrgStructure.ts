/**
 * Writes Client A's org structure to /config/orgStructure. Strict per phase-1
 * decision: this seeder writes the singleton config doc ONLY. It does not
 * touch any team docs — the operator maps existing teams to roles via
 * /admin/config after running this. Without that follow-up step Client A's
 * stage-7 sign-off button stays hidden (no validator team resolves).
 *
 * Idempotent: re-running overwrites the doc with the same defaults but
 * bumps updatedAt/updatedBy. The setupCompleted flag is preserved so the
 * /admin/setup auto-launch redirect doesn't fire for the Client A super_admin.
 */
import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { OrgStructure } from '../types/models'

export interface SeedOrgResult {
  created: boolean
  previousVersion: number
  newVersion: number
}

/**
 * Seed Client A's org structure. Pass the super_admin's uid so the audit
 * fields are correct.
 *
 * @returns whether the doc was created (vs overwritten) and version delta
 */
export async function seedClientAOrgStructure(adminUid: string): Promise<SeedOrgResult> {
  const ref = doc(db, 'config', 'orgStructure')
  const existing = await getDoc(ref)
  const previousVersion = existing.exists() ? ((existing.data() as OrgStructure).version ?? 0) : 0
  const newVersion = previousVersion + 1

  const payload: Omit<OrgStructure, 'updatedAt'> & { updatedAt: ReturnType<typeof serverTimestamp> } = {
    version: newVersion,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
    leadRoleName: 'Vertical Head',
    teamRoles: {
      hasCoordinator: true,
      hasValidator: true,
      hasSpecialist: true,
    },
    workTypes: ['2D', '3D', 'Video'],
    allotment: { mode: 'manual' },
    setupCompleted: true,
  }

  await setDoc(ref, payload)

  return {
    created: !existing.exists(),
    previousVersion,
    newVersion,
  }
}

/**
 * Generic seeder for a fresh tenant: writes the minimal default doc with
 * setupCompleted: false. Used only as an admin-side fallback if a tenant
 * environment somehow ends up without the doc.
 */
export async function seedEmptyOrgStructure(adminUid: string): Promise<SeedOrgResult> {
  const ref = doc(db, 'config', 'orgStructure')
  const existing = await getDoc(ref)
  if (existing.exists()) {
    // Don't clobber an existing doc with the empty default.
    const data = existing.data() as OrgStructure
    return { created: false, previousVersion: data.version, newVersion: data.version }
  }
  await setDoc(ref, {
    version: 1,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
    leadRoleName: 'Project Lead',
    teamRoles: { hasCoordinator: false, hasValidator: false, hasSpecialist: false },
    workTypes: [],
    allotment: { mode: 'manual' },
    setupCompleted: false,
  })
  return { created: true, previousVersion: 0, newVersion: 1 }
}

// Re-export Timestamp so callers that build an OrgStructure shape locally
// don't need to import from firebase/firestore directly.
export { Timestamp }
