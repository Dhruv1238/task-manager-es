/**
 * Seeds /workflows/sales-default — the individual-flow sales pipeline added in
 * Phase 2b. Stress-tests the engine across every effect kind (transition,
 * transition_with_counter for escalation + iteration, assign_lead, clear_lead,
 * mark_complete with multiple outcomes) plus mixed actor kinds.
 *
 * Mirrors seedCollabWorkflow.ts in shape and idempotent semantics. Run from
 * the super-admin "Seed sales-default workflow" button under /admin/config.
 *
 * Seven stages: new_lead → assigned ↔ unassigned → engaged → proposal_sent
 *               → won / lost (terminal). Two loop-backs (decline-reroute,
 * revision request) exercise counter increments.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Workflow } from '../types/workflow'

export const SALES_DEFAULT_WORKFLOW_ID = 'sales-default'

export function buildSalesDefaultWorkflow(): Omit<
  Workflow,
  'updatedAt' | 'updatedBy' | 'version'
> {
  return {
    id: SALES_DEFAULT_WORKFLOW_ID,
    displayName: 'Sales Pipeline',
    flowType: 'individual',
    leadRoleName: 'Sales Manager',
    isSystemDefined: true,
    recommendedLeads: [],
    stages: [
      {
        id: 'new_lead',
        displayName: 'New Lead',
        shortDisplayName: 'New',
        headline: 'New lead — assign a {leadRoleName}',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'assign_to_rep',
            label: 'Assign {leadRoleName}',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'assign_lead', toStage: 'assigned' },
            intent: 'primary',
            inputs: [
              {
                id: 'leadUid',
                label: 'Choose {leadRoleName}',
                type: 'user_picker',
                required: true,
                pickerScope: 'global_role:admin',
              },
              {
                id: 'priority',
                label: 'Priority',
                type: 'select',
                required: false,
                options: ['low', 'medium', 'high'],
              },
            ],
          },
        ],
      },
      {
        id: 'assigned',
        displayName: 'Assigned',
        shortDisplayName: 'Assigned',
        headline: '{leadRoleName} reviewing the lead',
        order: 2,
        isTerminal: false,
        actions: [
          {
            id: 'start_engagement',
            label: 'Start engagement',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'transition', toStage: 'engaged' },
            intent: 'primary',
            inputs: [],
          },
          {
            id: 'decline_lead',
            label: 'Decline lead',
            actor: { kind: 'pipeline_role', role: 'lead' },
            // Clears the lead and sends the project back for reassignment.
            // Bumps escalationCount so the inbox / dashboard can highlight
            // declined leads.
            effect: {
              kind: 'clear_lead',
              toStage: 'unassigned',
              counter: 'escalation',
            },
            intent: 'danger',
            inputs: [
              {
                id: 'reason',
                label: 'Reason for declining',
                type: 'textarea',
                required: true,
              },
            ],
          },
        ],
      },
      {
        id: 'unassigned',
        displayName: 'Awaiting Reassignment',
        shortDisplayName: 'Reassign',
        headline: 'Awaiting reassignment to a {leadRoleName}',
        order: 3,
        isTerminal: false,
        actions: [
          {
            id: 'reassign_rep',
            label: 'Reassign {leadRoleName}',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'assign_lead', toStage: 'assigned' },
            intent: 'primary',
            inputs: [
              {
                id: 'leadUid',
                label: 'Choose {leadRoleName}',
                type: 'user_picker',
                required: true,
                pickerScope: 'global_role:admin',
              },
            ],
          },
        ],
      },
      {
        id: 'engaged',
        displayName: 'In Engagement',
        shortDisplayName: 'Engaged',
        headline: '{leadRoleName} engaging with the prospect',
        order: 4,
        isTerminal: false,
        actions: [
          {
            id: 'submit_proposal',
            label: 'Submit proposal',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'transition', toStage: 'proposal_sent' },
            intent: 'primary',
            inputs: [],
          },
          {
            id: 'mark_unqualified',
            label: 'Mark unqualified',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'mark_complete', toStage: 'lost', outcomes: ['lost'] },
            intent: 'danger',
            inputs: [
              {
                id: 'reason',
                label: 'Why unqualified',
                type: 'textarea',
                required: true,
              },
            ],
          },
        ],
      },
      {
        id: 'proposal_sent',
        displayName: 'Proposal Sent',
        shortDisplayName: 'Proposal',
        headline: 'Awaiting prospect decision',
        order: 5,
        isTerminal: false,
        actions: [
          {
            id: 'mark_won',
            label: 'Mark won',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'mark_complete', toStage: 'won', outcomes: ['awarded'] },
            intent: 'success',
            inputs: [],
          },
          {
            id: 'mark_lost',
            label: 'Mark lost',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'mark_complete', toStage: 'lost', outcomes: ['lost'] },
            intent: 'danger',
            inputs: [
              {
                id: 'reason',
                label: 'Reason for loss',
                type: 'textarea',
                required: true,
              },
            ],
          },
          {
            id: 'request_revision',
            label: 'Request revision',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: {
              kind: 'transition_with_counter',
              toStage: 'engaged',
              counter: 'iteration',
            },
            intent: 'neutral',
            inputs: [
              {
                id: 'feedback',
                label: 'Client feedback',
                type: 'textarea',
                required: true,
              },
            ],
          },
        ],
      },
      {
        id: 'won',
        displayName: 'Won',
        shortDisplayName: 'Won',
        order: 6,
        isTerminal: true,
        actions: [],
      },
      {
        id: 'lost',
        displayName: 'Lost',
        shortDisplayName: 'Lost',
        order: 7,
        isTerminal: true,
        actions: [],
      },
    ],
  }
}

export interface SeedSalesResult {
  workflowId: string
  previousVersion: number
  newVersion: number
  stages: number
}

export async function seedSalesWorkflow(adminUid: string): Promise<SeedSalesResult> {
  const ref = doc(db, 'workflows', SALES_DEFAULT_WORKFLOW_ID)
  const existing = await getDoc(ref)
  const previousVersion = existing.exists()
    ? ((existing.data() as { version?: number }).version ?? 0)
    : 0

  const payload = buildSalesDefaultWorkflow()
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
        `workflow:${SALES_DEFAULT_WORKFLOW_ID}:v1`,
        JSON.stringify(cachePayload),
      )
    } catch {
      // ignore
    }
  }

  return {
    workflowId: SALES_DEFAULT_WORKFLOW_ID,
    previousVersion,
    newVersion,
    stages: payload.stages.length,
  }
}
