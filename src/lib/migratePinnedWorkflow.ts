/**
 * Dev-only one-shot migration: backfills `project.pinnedWorkflow` on every
 * existing project that was created before Phase 2c shipped. Idempotent —
 * skips projects that already have a pinned snapshot.
 *
 * Not surfaced in any client UI. The platform team runs this from the
 * browser console after deploying 2c, then removes the file in a follow-up
 * cleanup PR.
 *
 * Usage from the console (any super_admin tab):
 *   import('./lib/migratePinnedWorkflow').then(m => m.migratePinnedWorkflow())
 *
 * Returns a summary of what was touched. Logs per-project lines for
 * visibility during the run.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Workflow } from '../types/workflow'

export interface MigrationSummary {
  scanned: number
  pinned: number
  skipped: number
  missingWorkflow: number
  errors: number
}

const BATCH_SIZE = 200

export async function migratePinnedWorkflow(
  options: { dryRun?: boolean } = {},
): Promise<MigrationSummary> {
  const { dryRun = false } = options
  const summary: MigrationSummary = {
    scanned: 0,
    pinned: 0,
    skipped: 0,
    missingWorkflow: 0,
    errors: 0,
  }
  const workflowCache = new Map<string, Workflow | null>()

  const snap = await getDocs(collection(db, 'projects'))
  let batch = writeBatch(db)
  let inBatch = 0

  for (const projectSnap of snap.docs) {
    summary.scanned += 1
    const project = projectSnap.data() as {
      workflowId?: string
      pinnedWorkflow?: Workflow
      title?: string
    }

    if (project.pinnedWorkflow) {
      summary.skipped += 1
      continue
    }
    if (!project.workflowId) {
      summary.missingWorkflow += 1
      console.warn(
        `[migratePinnedWorkflow] project ${projectSnap.id} (${project.title ?? '?'}) has no workflowId — skipped`,
      )
      continue
    }

    let workflow = workflowCache.get(project.workflowId)
    if (workflow === undefined) {
      try {
        const wfSnap = await getDoc(doc(db, 'workflows', project.workflowId))
        workflow = wfSnap.exists() ? (wfSnap.data() as Workflow) : null
        workflowCache.set(project.workflowId, workflow)
      } catch (e) {
        summary.errors += 1
        console.error(
          `[migratePinnedWorkflow] failed to load workflow ${project.workflowId} for project ${projectSnap.id}`,
          e,
        )
        continue
      }
    }
    if (!workflow) {
      summary.missingWorkflow += 1
      console.warn(
        `[migratePinnedWorkflow] workflow "${project.workflowId}" not found for project ${projectSnap.id} — skipped`,
      )
      continue
    }

    const pinned = { ...workflow, id: project.workflowId }
    console.log(
      `[migratePinnedWorkflow] ${dryRun ? '[dry-run] would pin' : 'pinning'} project ${projectSnap.id} (${project.title ?? '?'}) → ${project.workflowId} v${workflow.version}`,
    )

    if (!dryRun) {
      batch.update(doc(db, 'projects', projectSnap.id), {
        pinnedWorkflow: pinned,
        updatedAt: serverTimestamp(),
      })
      inBatch += 1
      summary.pinned += 1

      if (inBatch >= BATCH_SIZE) {
        await batch.commit()
        batch = writeBatch(db)
        inBatch = 0
      }
    } else {
      summary.pinned += 1
    }
  }

  if (!dryRun && inBatch > 0) {
    await batch.commit()
  }

  console.log('[migratePinnedWorkflow] done', summary)
  return summary
}

// Expose on window for one-line console invocation. Guarded so it only
// attaches in the browser; harmless during SSR / build.
if (typeof window !== 'undefined') {
  ;(window as unknown as { migratePinnedWorkflow?: typeof migratePinnedWorkflow }).migratePinnedWorkflow =
    migratePinnedWorkflow
}
