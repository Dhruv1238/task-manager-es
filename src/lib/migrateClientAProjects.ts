/**
 * Phase 2b: Client A's pre-2a projects and the dual-write window's 2a projects
 * are both handled by the same general-purpose migration — see
 * migrateProjectHistory.ts. This file is now a thin delegate so the existing
 * "Migrate Client A projects" button keeps working while the new
 * "Migrate stageHistory → projectHistory" path is the source of truth.
 *
 * The delegated migration:
 *   - Rewrites legacy `stageHistory[]` to `projectHistory[]` with the new
 *     event shape (kind: 'stage' discriminator, string stageId).
 *   - Prepends a synthetic `kind: 'workflow_assignment'` event so the timeline
 *     starts with the workflow pinning.
 *   - Drops residual legacy fields (vhId, vhIterationCount, stage) via
 *     deleteField() so the Project schema converges on the post-2b shape.
 *
 * Idempotent: skips any project whose `projectHistory` array already exists.
 */
import {
  migrateProjectHistory,
  type MigrateProjectHistoryResult,
} from './migrateProjectHistory'

export interface MigrationResult {
  scanned: number
  migrated: number
  skipped: number
  errors: Array<{ projectId: string; message: string }>
}

export async function migrateClientAProjects(adminUid: string): Promise<MigrationResult> {
  const result: MigrateProjectHistoryResult = await migrateProjectHistory(adminUid)
  return {
    scanned: result.totalScanned,
    migrated: result.migrated,
    skipped: result.alreadyMigrated,
    errors: [],
  }
}
