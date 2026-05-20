/**
 * One-shot migration: strip the legacy `pipeline` block from /config/appConfig.
 *
 * Phase 2b retires the global `pipeline.enabled` toggle in favour of per-tenant
 * workflow activation in /workflows/_registry. The TypeScript type no longer
 * carries `pipeline`, so any stored value is dead data — this helper removes
 * it via Firestore's deleteField sentinel so the doc shrinks instead of
 * accumulating stale fields.
 *
 * Idempotent: when the field is already absent, the update is a no-op write
 * that still bumps `updatedAt` so the audit trail shows when retirement was
 * run.
 */
import { deleteField, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

export interface RetirePipelineToggleResult {
  hadPipeline: boolean
}

export async function retirePipelineToggle(
  adminUid: string,
): Promise<RetirePipelineToggleResult> {
  const ref = doc(db, 'config', 'appConfig')
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    // Nothing to retire — the doc itself doesn't exist yet. Leave it alone;
    // the next config write will materialise the modern shape.
    return { hadPipeline: false }
  }
  const data = snap.data() as Record<string, unknown>
  const hadPipeline = data.pipeline !== undefined

  await updateDoc(ref, {
    pipeline: deleteField(),
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  })

  return { hadPipeline }
}
