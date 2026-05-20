/**
 * Seeds /workflows/basic — the 2-stage simple-mode workflow for tenants that
 * disable the pipeline (pipelineEnabled = false). A project starts in
 * `in_progress` and can be marked complete by the creator or any admin.
 * Top-level `workflows` collection — see seedCollabWorkflow.ts for the path
 * rationale.
 *
 * Idempotent: read-modify-write to bump `version`. Run from the super-admin
 * "Seed basic workflow" button under /admin/config.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Workflow } from '../types/workflow'

export const BASIC_WORKFLOW_ID = 'basic'

export function buildBasicWorkflow(): Omit<Workflow, 'updatedAt' | 'updatedBy' | 'version'> {
  return {
    id: BASIC_WORKFLOW_ID,
    displayName: 'Basic Project',
    flowType: 'basic',
    leadRoleName: 'Project Lead',
    isSystemDefined: true,
    stages: [
      {
        id: 'in_progress',
        displayName: 'In Progress',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'mark_complete_creator',
            label: 'Mark complete',
            actor: { kind: 'creator' },
            effect: { kind: 'mark_complete', toStage: 'completed', outcomes: ['completed'] },
            intent: 'primary',
            inputs: [],
          },
          {
            id: 'mark_complete_admin',
            label: 'Mark complete',
            actor: { kind: 'global_role', role: 'admin' },
            effect: { kind: 'mark_complete', toStage: 'completed', outcomes: ['completed'] },
            intent: 'primary',
            inputs: [],
          },
          {
            id: 'mark_complete_super_admin',
            label: 'Mark complete',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'mark_complete', toStage: 'completed', outcomes: ['completed'] },
            intent: 'primary',
            inputs: [],
          },
        ],
      },
      {
        id: 'completed',
        displayName: 'Completed',
        order: 2,
        isTerminal: true,
        actions: [],
      },
    ],
  }
}

export interface SeedBasicResult {
  workflowId: string
  previousVersion: number
  newVersion: number
  stages: number
}

export async function seedBasicWorkflow(adminUid: string): Promise<SeedBasicResult> {
  const ref = doc(db, 'workflows', BASIC_WORKFLOW_ID)
  const existing = await getDoc(ref)
  const previousVersion = existing.exists()
    ? ((existing.data() as { version?: number }).version ?? 0)
    : 0

  const payload = buildBasicWorkflow()
  const newVersion = previousVersion + 1

  await setDoc(ref, {
    ...payload,
    version: newVersion,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  })

  if (typeof window !== 'undefined') {
    try {
      const cachePayload = {
        workflow: {
          ...payload,
          version: newVersion,
          updatedAt: {
            seconds: Math.floor(Date.now() / 1000),
            nanoseconds: 0,
          },
          updatedBy: adminUid,
        },
        fetchedAt: Date.now(),
      }
      window.localStorage.setItem(
        `workflow:${BASIC_WORKFLOW_ID}:v1`,
        JSON.stringify(cachePayload),
      )
    } catch {
      // ignore
    }
  }

  return {
    workflowId: BASIC_WORKFLOW_ID,
    previousVersion,
    newVersion,
    stages: payload.stages.length,
  }
}
