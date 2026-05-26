/**
 * One-shot migration: rewrite legacy `stageHistory` to the Phase 2b
 * `projectHistory` shape, then drop the residual dual-write fields the engine
 * no longer reads or writes.
 *
 * The schema change:
 *   - `stageHistory[]` → `projectHistory[]` (renamed; events gain a `kind`
 *     discriminator).
 *   - Each event becomes `{ kind: 'stage', stageId, enteredAt, enteredBy,
 *     payload? }`. Numeric `stage` mirrors are dropped from events.
 *   - A synthetic `{ kind: 'workflow_assignment' }` event is prepended at
 *     index 0 so every project's timeline starts with "pinned to workflow X
 *     by Y on Z". Older readers that didn't render this event simply ignored
 *     it; the new ProjectHistory side panel renders it as the first row.
 *   - Legacy stage numerics are translated to string ids via
 *     NUMERIC_STAGE_TO_ID for collab projects; for any project whose workflow
 *     id isn't recognised, the helper falls back to leaving the original
 *     stageId untouched (which is the dual-write field already populated by
 *     Phase 2a `performAction`).
 *   - Legacy fields (vhId, vhIterationCount, stage) are deleted via
 *     deleteField() so the Project shape converges on the post-2b schema.
 *
 * Idempotent: skips projects whose `projectHistory` array is already present.
 * Run once per environment from the super-admin migrate button. Chunked at
 * 200 projects so each batch stays under Firestore's 500-op cap (each project
 * is ~1-2 batch ops).
 */
import {
  deleteField,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { tenantCol, tenantDoc } from './firestore'
import { recordAuditEvent } from './firestore'
import { NUMERIC_STAGE_TO_ID } from './seedCollabWorkflow'
import { COLLAB_DEFAULT_WORKFLOW_ID } from '../contexts/AppConfigContext'
import type { ProjectHistoryEvent, StageEvent } from '../types/workflow'

const PROJECTS_PER_BATCH = 200

// Legacy shape we read off the wire. Mirrors what pre-2b projects had on disk;
// the new Project type no longer carries any of these fields.
interface LegacyStageEvent {
  stage?: number
  stageId?: string
  enteredAt?: Timestamp
  enteredBy?: string
  payload?: Record<string, unknown> | null
}

interface LegacyProjectShape {
  workflowId?: string
  currentStageId?: string
  stage?: number
  stageHistory?: LegacyStageEvent[]
  vhId?: string | null
  leadUid?: string | null
  vhIterationCount?: number
  iterationCount?: number
  escalationCount?: number
  projectHistory?: ProjectHistoryEvent[]
  ownerId?: string
  createdAt?: Timestamp
  createdBy?: string
  title?: string
}

function stageIdForEvent(
  e: LegacyStageEvent,
  workflowId: string | undefined,
): string {
  if (e.stageId) return e.stageId
  if (workflowId === COLLAB_DEFAULT_WORKFLOW_ID && typeof e.stage === 'number') {
    return NUMERIC_STAGE_TO_ID[e.stage] ?? 'created'
  }
  // Fallback — when the event has no string id and no recognised numeric
  // mapping, anchor it to a generic 'unknown' marker. The history side panel
  // displays this verbatim so it's easy to spot during QA.
  return 'unknown'
}

export interface MigrateProjectHistoryResult {
  totalScanned: number
  migrated: number
  alreadyMigrated: number
  batches: number
}

export async function migrateProjectHistory(
  adminUid: string,
): Promise<MigrateProjectHistoryResult> {
  const snap = await getDocs(tenantCol('projects'))

  let totalScanned = 0
  let migrated = 0
  let alreadyMigrated = 0
  let batches = 0

  // Build the work items first so we can chunk them deterministically.
  interface WorkItem {
    projectId: string
    title: string
    projectHistory: ProjectHistoryEvent[]
  }
  const work: WorkItem[] = []

  for (const docSnap of snap.docs) {
    totalScanned += 1
    const data = docSnap.data() as LegacyProjectShape

    if (data.projectHistory && Array.isArray(data.projectHistory)) {
      alreadyMigrated += 1
      continue
    }

    const legacyEvents = data.stageHistory ?? []
    const workflowId = data.workflowId

    // Translate every legacy event to the new shape.
    const stageEvents: StageEvent[] = legacyEvents
      .filter((e) => e.enteredAt && e.enteredBy)
      .map((e) => ({
        kind: 'stage' as const,
        stageId: stageIdForEvent(e, workflowId),
        enteredAt: e.enteredAt as Timestamp,
        enteredBy: e.enteredBy as string,
        ...(e.payload ? { payload: e.payload } : { payload: null }),
      }))

    // Prepend a synthetic workflow_assignment event so the timeline starts
    // with the pinning. createdAt / ownerId from the project doc supply the
    // assignment metadata.
    const synthetic: ProjectHistoryEvent | null =
      workflowId && data.createdAt && (data.createdBy ?? data.ownerId)
        ? {
            kind: 'workflow_assignment',
            workflowId,
            assignedAt: data.createdAt,
            assignedBy: data.createdBy ?? data.ownerId ?? '',
          }
        : null

    const projectHistory: ProjectHistoryEvent[] = synthetic
      ? [synthetic, ...stageEvents]
      : stageEvents

    work.push({
      projectId: docSnap.id,
      title: data.title ?? docSnap.id,
      projectHistory,
    })
  }

  // Write the migrations in chunks.
  for (let i = 0; i < work.length; i += PROJECTS_PER_BATCH) {
    const chunk = work.slice(i, i + PROJECTS_PER_BATCH)
    const batch = writeBatch(db)

    for (const item of chunk) {
      const ref = tenantDoc('projects', item.projectId)
      batch.update(ref, {
        projectHistory: item.projectHistory,
        // Strip the old fields. deleteField() ensures the keys are removed
        // from the doc rather than left as undefined.
        stageHistory: deleteField(),
        stage: deleteField(),
        vhId: deleteField(),
        vhIterationCount: deleteField(),
        updatedAt: serverTimestamp(),
      })
    }

    // One audit event per chunk summarises the batch.
    recordAuditEvent({
      actorId: adminUid,
      actorName: 'migration',
      action: 'project.action_performed',
      targetType: 'project',
      targetId: `batch-${i / PROJECTS_PER_BATCH}`,
      payload: {
        migration: 'projectHistory',
        projectCount: chunk.length,
      },
      batch,
    })

    await batch.commit()
    migrated += chunk.length
    batches += 1
  }

  return { totalScanned, migrated, alreadyMigrated, batches }
}
