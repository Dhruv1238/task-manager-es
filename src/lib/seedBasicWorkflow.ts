/**
 * Seeds /workflows/basic — the 2-stage simple-mode workflow. The implicit
 * default for any tenant: when no other workflow is activated in
 * /workflows/_registry, basic is what project creators get. A project starts
 * in `in_progress` and can be marked complete by the creator or any admin.
 * Top-level `workflows` collection — see seedCollabWorkflow.ts for the path
 * rationale.
 *
 * Idempotent: read-modify-write to bump `version`. Run from the super-admin
 * "Seed basic workflow" button under /admin/config.
 */
import {  getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { tenantDoc } from './firestore'
import { SIMPLE_STATUS_OPTIONS, defaultStatusOptions } from './projectStatus'
import type { Workflow } from '../types/workflow'

export const BASIC_WORKFLOW_ID = 'basic'

export function buildBasicWorkflow(): Omit<Workflow, 'updatedAt' | 'updatedBy' | 'version'> {
  return {
    id: BASIC_WORKFLOW_ID,
    displayName: 'Simple Project',
    flowType: 'basic',
    leadRoleName: '',
    isSystemDefined: true,
    description:
      'Track work with a title, description, and a small team. Add tasks and mark complete when done.',
    creationModalCardSubtitle: 'Simple status flow',
    creationModalDescription:
      "Tracked by status. Add tasks and team members after it's created.",
    recommendedLeads: [],
    // Phase 2d: basic stays minimal — no roles or custom fields. Statuses are
    // the simple 3. canUpdateStatusActors omitted: creator + admins (the
    // evaluator baseline) cover basic-flow status updates.
    projectRoles: [],
    projectFields: { customFields: [] },
    statusOptions: defaultStatusOptions(SIMPLE_STATUS_OPTIONS),
    stages: [
      {
        id: 'in_progress',
        displayName: 'In Progress',
        order: 1,
        isTerminal: false,
        // Single canonical action. The creator owns the inbox routing
        // ("project is awaiting me" surfaces to them); admins / super_admin
        // can also press the button as an override (alsoAllow) without
        // ending up in their inbox for every basic project in the system.
        actions: [
          {
            id: 'mark_complete',
            label: 'Mark complete',
            actor: { kind: 'creator' },
            alsoAllow: [
              { kind: 'global_role', role: 'admin' },
              { kind: 'global_role', role: 'super_admin' },
            ],
            effect: {
              kind: 'mark_complete',
              toStage: 'completed',
              outcomes: ['completed'],
            },
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
  const ref = tenantDoc('workflows', BASIC_WORKFLOW_ID)
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
