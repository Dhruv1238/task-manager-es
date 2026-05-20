/**
 * One-shot migration for Client A's existing projects. Translates the legacy
 * numeric `stage` / `vhId` / `vhIterationCount` fields onto the Phase 2a
 * schema (`currentStageId` / `leadUid` / `iterationCount`) and pins
 * `workflowId: 'collab-default'`.
 *
 * Idempotent: skips projects that already have `workflowId` set. Run from the
 * "Migrate Client A projects" button under /admin/config — backstop only,
 * since the team is recreating in-flight projects regardless.
 *
 * Note: this writes the new fields ALONGSIDE the legacy ones. The dual-write
 * window stays open until Sprint 5's cleanup pass removes legacy reads from
 * the codebase. After that, a follow-up sweep can `deleteField()` the legacy
 * fields if desired.
 */
import {
  collection,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { recordAuditEvent } from './firestore'
import {
  COLLAB_DEFAULT_WORKFLOW_ID,
  NUMERIC_STAGE_TO_ID,
} from './seedCollabWorkflow'
import type { Project, StageEvent } from '../types/models'

export interface MigrationResult {
  scanned: number
  migrated: number
  skipped: number
  errors: Array<{ projectId: string; message: string }>
}

export async function migrateClientAProjects(adminUid: string): Promise<MigrationResult> {
  const snap = await getDocs(collection(db, 'projects'))
  const out: MigrationResult = { scanned: snap.size, migrated: 0, skipped: 0, errors: [] }

  // Firestore writeBatch caps at 500 ops. We do at most 3 ops per project
  // (update + audit + maybe team mirror — only update + audit here), so 200
  // projects per batch is safe. Re-bucket if scale grows beyond that.
  const docs = snap.docs
  const CHUNK = 200
  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK)
    const batch = writeBatch(db)
    let opsInBatch = 0

    for (const d of chunk) {
      const data = d.data() as Project & { id?: string }
      // Already migrated — leave alone.
      if (data.workflowId) {
        out.skipped += 1
        continue
      }
      // Legacy projects always had a numeric `stage`. If it's missing, this is
      // either a simple-mode project (no stages) or already in a strange state;
      // we still pin a workflowId so the engine has something to read.
      const legacyStage = (data as { stage?: number }).stage
      const legacyVhId = data.vhId ?? null
      const legacyIter = data.vhIterationCount ?? 0

      const newStageId = typeof legacyStage === 'number'
        ? (NUMERIC_STAGE_TO_ID[legacyStage] ?? 'created')
        : 'created'

      // Translate stageHistory entries: each gets a stageId mirror of its
      // numeric `stage`. The original `stage` field is preserved so legacy
      // payload-typed callers still work.
      const oldHistory: StageEvent[] = data.stageHistory ?? []
      const newHistory = oldHistory.map((e) => ({
        ...e,
        stageId: e.stageId ?? NUMERIC_STAGE_TO_ID[e.stage as number] ?? 'created',
      }))

      try {
        batch.update(d.ref, {
          workflowId: COLLAB_DEFAULT_WORKFLOW_ID,
          currentStageId: newStageId,
          leadUid: legacyVhId,
          iterationCount: legacyIter,
          stageHistory: newHistory,
          updatedAt: serverTimestamp(),
        })
        recordAuditEvent({
          actorId: adminUid,
          actorName: 'system',
          action: 'project.action_performed',
          targetType: 'project',
          targetId: d.id,
          targetTitle: data.title,
          projectId: d.id,
          payload: {
            migration: 'collab-default',
            fromStage: legacyStage ?? null,
            toStageId: newStageId,
          },
          batch,
        })
        opsInBatch += 2
        out.migrated += 1
      } catch (e) {
        out.errors.push({
          projectId: d.id,
          message: e instanceof Error ? e.message : 'unknown error',
        })
      }
    }

    if (opsInBatch > 0) {
      await batch.commit()
    }
  }

  return out
}

// Reference timestamp so the unused-import shim isn't required. Not used at
// runtime; kept as a guard against the dependency being lost in dead-code
// elimination.
export const MIGRATION_BUILT_AT: Timestamp = Timestamp.fromMillis(0)
