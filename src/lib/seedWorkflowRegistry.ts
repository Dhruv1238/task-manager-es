/**
 * Seeds /workflows/_registry — the singleton tracking which seeded workflows
 * are active for this tenant, and which is the default in the new-project
 * picker. Phase 2b's keystone doc.
 *
 * Idempotent. When the doc already exists, this preserves the operator's
 * activation choices and only bumps the version + updatedAt. When the doc is
 * missing, it writes the default shape (basic-only) so fresh tenants get a
 * usable system.
 */
import {  getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { tenantDoc } from './firestore'
import type { WorkflowRegistry } from '../types/workflow'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'
import { BASIC_WORKFLOW_ID } from '../contexts/AppConfigContext'

const REGISTRY_STORAGE_KEY = 'workflowRegistry:v1'

export interface SeedRegistryResult {
  previousVersion: number
  newVersion: number
  activeWorkflowIds: string[]
  defaultWorkflowId: string | null
  // True when the doc already existed and we preserved its activation choices;
  // false when this run wrote a fresh default registry.
  preserved: boolean
}

export async function seedWorkflowRegistry(adminUid: string): Promise<SeedRegistryResult> {
  const ref = tenantDoc('workflows', WORKFLOW_REGISTRY_ID)
  const existing = await getDoc(ref)

  let previousVersion = 0
  let activeWorkflowIds: string[] = [BASIC_WORKFLOW_ID]
  let defaultWorkflowId: string | null = BASIC_WORKFLOW_ID
  let preserved = false

  if (existing.exists()) {
    const data = existing.data() as Partial<WorkflowRegistry>
    previousVersion = data.version ?? 0
    if (Array.isArray(data.activeWorkflowIds) && data.activeWorkflowIds.length > 0) {
      activeWorkflowIds = data.activeWorkflowIds
      defaultWorkflowId =
        data.defaultWorkflowId !== undefined ? data.defaultWorkflowId : activeWorkflowIds[0]
      preserved = true
    }
  }

  const newVersion = previousVersion + 1
  const payload: Omit<WorkflowRegistry, 'updatedAt'> = {
    version: newVersion,
    updatedBy: adminUid,
    activeWorkflowIds,
    defaultWorkflowId,
  }

  await setDoc(ref, {
    ...payload,
    updatedAt: serverTimestamp(),
  })

  // Mirror into localStorage so the current tab + peer tabs pick up the new
  // state without a 24h-TTL refetch.
  if (typeof window !== 'undefined') {
    try {
      const cachePayload = {
        registry: {
          ...payload,
          updatedAt: {
            seconds: Math.floor(Date.now() / 1000),
            nanoseconds: 0,
          },
        },
        fetchedAt: Date.now(),
      }
      window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(cachePayload))
    } catch {
      // ignore quota / private-mode errors
    }
  }

  return {
    previousVersion,
    newVersion,
    activeWorkflowIds,
    defaultWorkflowId,
    preserved,
  }
}

// Convenience for callers (admin UI) that need to update the registry
// optimistically without re-running the full seed.
export function localRegistryFromMemory(
  next: Omit<WorkflowRegistry, 'version' | 'updatedAt' | 'updatedBy'> & {
    version: number
    updatedBy: string
  },
): WorkflowRegistry {
  return {
    ...next,
    updatedAt: Timestamp.now(),
  }
}
