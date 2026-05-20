/**
 * Seeds /workflows/collab-default — the collaborative tender workflow Client A
 * runs today. Generic naming (no "tender" string); the displayName is what
 * tenants edit in 2c.
 *
 * Top-level `workflows` collection (not under /config/) because Firestore
 * requires document paths to have an even number of segments — /config is the
 * collection, and a single string id under it (orgStructure / appConfig) is a
 * doc, so /config/workflows/{id} would have to mean a doc under a subcollection
 * of a specific config doc, not a flat per-id mapping.
 *
 * Idempotent: each run reads the existing doc to bump `version`, overwrites
 * everything else. Run from the super-admin "Seed collab-default workflow"
 * button under /admin/config (or /admin/setup).
 *
 * Eight stages mapped 1:1 onto the legacy numeric stages so the transitional
 * Sprint 2-3 period can dual-write without behaviour drift. The legacy numeric
 * mapping is the reverse of NUMERIC_STAGE_TO_ID at the bottom of this file.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Workflow } from '../types/workflow'

export const COLLAB_DEFAULT_WORKFLOW_ID = 'collab-default'

// Build the doc payload. Pure — no Firestore reads. Exported so tests / future
// authoring UI can inspect the shape without hitting the db.
export function buildCollabDefaultWorkflow(): Omit<Workflow, 'updatedAt' | 'updatedBy' | 'version'> {
  return {
    id: COLLAB_DEFAULT_WORKFLOW_ID,
    displayName: 'Tender',
    flowType: 'collaborative',
    leadRoleName: 'Vertical Head',
    isSystemDefined: true,
    recommendedLeads: [],
    stages: [
      {
        id: 'created',
        displayName: 'Project Created',
        shortDisplayName: 'Created',
        headline: 'Awaiting allocation to a {leadRoleName}',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'allocate',
            label: 'Allocate to {leadRoleName}',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'assign_lead', toStage: 'allocated' },
            intent: 'primary',
            inputs: [
              {
                id: 'leadUid',
                label: 'Choose lead',
                type: 'user_picker',
                required: true,
                pickerScope: 'global_role:admin',
              },
            ],
          },
        ],
      },
      {
        id: 'allocated',
        displayName: 'Awaiting Lead Decision',
        shortDisplayName: 'Awaiting',
        headline: 'Awaiting {leadRoleName} decision',
        order: 2,
        isTerminal: false,
        actions: [
          {
            id: 'accept',
            label: 'Accept',
            actor: { kind: 'pipeline_role', role: 'lead' },
            // Goes directly to eligibility_review — the VH's assessment is
            // captured by the input, no waystation stage needed.
            effect: { kind: 'transition', toStage: 'eligibility_review' },
            intent: 'success',
            inputs: [
              {
                id: 'eligibilityNote',
                label: "{leadRoleName}'s eligibility assessment",
                type: 'textarea',
                required: true,
              },
            ],
          },
          {
            id: 'escalate',
            label: 'Escalate Back',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: {
              kind: 'clear_lead',
              toStage: 'created',
              counter: 'escalation',
            },
            intent: 'danger',
            inputs: [
              { id: 'reason', label: 'Reason for escalation', type: 'textarea', required: true },
              { id: 'eta', label: 'ETA', type: 'date', required: false },
              {
                id: 'priority',
                label: 'Priority',
                type: 'select',
                required: true,
                options: ['low', 'medium', 'high'],
              },
            ],
          },
        ],
      },
      {
        id: 'eligibility_review',
        displayName: 'Eligibility Review',
        shortDisplayName: 'Eligibility',
        headline: 'Awaiting super admin eligibility review',
        order: 3,
        isTerminal: false,
        actions: [
          {
            id: 'approve',
            label: 'Approve & continue',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'transition', toStage: 'task_setup' },
            intent: 'success',
            inputs: [],
          },
          {
            id: 'reject',
            label: 'Reject — close tender',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'mark_complete', toStage: 'eligibility_review', outcomes: ['not_submitted'] },
            intent: 'danger',
            inputs: [
              {
                id: 'outcome',
                label: 'Outcome',
                type: 'status_select',
                required: true,
                options: ['not_submitted'],
              },
              { id: 'note', label: 'Reason', type: 'textarea', required: true },
            ],
          },
        ],
      },
      {
        id: 'task_setup',
        displayName: 'Task Setup',
        shortDisplayName: 'Setup',
        headline: 'Add tasks for each team to start execution',
        hint: 'Adding the first task auto-confirms setup and moves the project to execution.',
        order: 4,
        isTerminal: false,
        actions: [
          {
            id: 'confirm_setup',
            label: 'Confirm setup → start execution',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'transition', toStage: 'in_execution' },
            intent: 'primary',
            inputs: [],
          },
        ],
      },
      {
        id: 'in_execution',
        displayName: 'In Execution',
        shortDisplayName: 'Execution',
        headline: 'Teams executing — awaiting validator sign-off',
        order: 5,
        isTerminal: false,
        // Validator sign-off lives directly at in_execution (no separate
        // validation stage in 2a — preserves old behaviour where the
        // validator could sign off at any time during execution).
        actions: [
          {
            id: 'sign_off',
            label: 'Validation complete — sign off',
            actor: {
              kind: 'team_role',
              role: 'validator',
              member: 'lead',
              // {leadRoleName}, project owner, and super_admin can always
              // sign off — useful as an override path or when no validator
              // team is attached. They only get nudged via /me when the
              // validator team is missing; otherwise the inbox routes the
              // action to the validator lead alone.
              alsoAllow: [
                { kind: 'pipeline_role', role: 'lead' },
                { kind: 'creator' },
                { kind: 'global_role', role: 'super_admin' },
              ],
            },
            effect: { kind: 'transition', toStage: 'lead_review' },
            intent: 'primary',
            inputs: [],
          },
          {
            id: 'request_changes',
            label: 'Request changes',
            actor: {
              kind: 'team_role',
              role: 'validator',
              member: 'lead',
              alsoAllow: [
                { kind: 'pipeline_role', role: 'lead' },
                { kind: 'creator' },
                { kind: 'global_role', role: 'super_admin' },
              ],
            },
            effect: {
              kind: 'transition_with_counter',
              toStage: 'in_execution',
              counter: 'iteration',
            },
            intent: 'danger',
            inputs: [
              { id: 'feedback', label: 'Feedback', type: 'textarea', required: true },
              { id: 'eta', label: 'ETA', type: 'date', required: false },
              {
                id: 'priority',
                label: 'Priority',
                type: 'select',
                required: true,
                options: ['low', 'medium', 'high'],
              },
            ],
          },
        ],
      },
      {
        id: 'lead_review',
        displayName: 'Lead Review',
        shortDisplayName: 'Review',
        headline: '{leadRoleName} reviewing with {validatorTeamName}',
        order: 6,
        isTerminal: false,
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: { kind: 'transition', toStage: 'delivered' },
            intent: 'success',
            inputs: [],
          },
          {
            id: 'request_rework',
            label: 'Reject — send back',
            actor: { kind: 'pipeline_role', role: 'lead' },
            effect: {
              kind: 'transition_with_counter',
              toStage: 'in_execution',
              counter: 'iteration',
            },
            intent: 'danger',
            inputs: [
              { id: 'feedback', label: 'Feedback', type: 'textarea', required: true },
              { id: 'eta', label: 'ETA', type: 'date', required: false },
              {
                id: 'priority',
                label: 'Priority',
                type: 'select',
                required: true,
                options: ['low', 'medium', 'high'],
              },
            ],
          },
        ],
      },
      {
        id: 'delivered',
        // Stage id stays `delivered` for back-compat with the legacy numeric
        // mapping (10 → delivered). User-facing labels reflect the actual
        // state: the lead has approved, the coordinator team still has to
        // send the pitch and record what the client says. The "submitted"
        // beat shows on the project's status pill once the coordinator
        // records the outcome — not here.
        displayName: 'Ready for Client',
        shortDisplayName: 'Ready',
        headline: 'Approved — coordinator to send pitch and record the outcome',
        order: 7,
        isTerminal: false,
        // set_status (not mark_complete): coordinator records the pitch outcome
        // but the project stays open until status is independently flipped to a
        // terminal value (completed / lost / archived) — matches old behaviour
        // where 'awarded' projects continue delivery work.
        actions: [
          {
            id: 'record_outcome',
            label: 'Record outcome',
            actor: {
              kind: 'team_role',
              role: 'coordinator',
              member: 'lead',
              // {leadRoleName}, project owner, and super_admin can always
              // record the outcome — useful as an override path or when no
              // coordinator team is attached. They only get nudged via /me
              // when the coordinator team is missing.
              alsoAllow: [
                { kind: 'pipeline_role', role: 'lead' },
                { kind: 'creator' },
                { kind: 'global_role', role: 'super_admin' },
              ],
            },
            effect: {
              kind: 'set_status',
              statuses: ['awarded', 'lost', 'not_submitted', 'submitted', 'completed', 'on_hold'],
            },
            intent: 'primary',
            inputs: [
              {
                id: 'status',
                label: 'Status',
                type: 'status_select',
                required: true,
                options: ['awarded', 'lost', 'not_submitted', 'submitted', 'completed', 'on_hold'],
              },
              { id: 'note', label: 'Note', type: 'textarea', required: true },
            ],
          },
        ],
      },
    ],
  }
}

export interface SeedCollabResult {
  workflowId: string
  previousVersion: number
  newVersion: number
  stages: number
}

export async function seedCollabWorkflow(adminUid: string): Promise<SeedCollabResult> {
  const ref = doc(db, 'workflows', COLLAB_DEFAULT_WORKFLOW_ID)
  const existing = await getDoc(ref)
  const previousVersion = existing.exists()
    ? ((existing.data() as { version?: number }).version ?? 0)
    : 0

  const payload = buildCollabDefaultWorkflow()
  const newVersion = previousVersion + 1

  await setDoc(ref, {
    ...payload,
    version: newVersion,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  })

  // Optimistic local cache write so the current tab picks up the new doc
  // without waiting on the boot effect's TTL check. Mirrors how appConfig
  // setConfigOptimistic works after the admin saves.
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
        `workflow:${COLLAB_DEFAULT_WORKFLOW_ID}:v1`,
        JSON.stringify(cachePayload),
      )
    } catch {
      // ignore
    }
  }

  return {
    workflowId: COLLAB_DEFAULT_WORKFLOW_ID,
    previousVersion,
    newVersion,
    stages: payload.stages.length,
  }
}

// Legacy back-compat: maps stage ids in this workflow to numeric stages used by
// the pre-2a code (StageBanner, usePermissions, useProjectsAwaitingMyAction,
// stageStyle). Used by workflowEvaluator.performAction during the Sprint 2-3
// transition to dual-write the `project.stage` field and `stageHistory[].stage`
// alongside the new string-id fields. Sprint 5 deletes the dual-write — at
// which point this mapping becomes dead code and gets removed.
//
// Mapping rationale:
// - created/allocated/accepted/eligibility_review/task_setup/in_execution/
//   lead_review/delivered map 1:1 to legacy 1/2/4/5/6/7/8/10. Legacy 3 and 9
//   were event-only markers ("escalation", "rework") never set as the live
//   stage — recorded by `recordedAsLegacyStage` below per action.
export const ID_TO_LEGACY_STAGE: Record<string, number> = {
  created: 1,
  allocated: 2,
  // 'accepted' no longer exists — the VH's eligibility note is captured by
  // the `accept` action's input and the project lands directly at
  // eligibility_review (legacy stage 5).
  eligibility_review: 5,
  task_setup: 6,
  in_execution: 7,
  lead_review: 8,
  delivered: 10,
}

// For history events with a counter increment, the legacy code recorded a
// SEPARATE marker event with a different `stage` number (3 for escalation,
// 9 for rework) alongside the live-stage transition. Sprint 2 preserves this
// dual-event recording by emitting BOTH events in the same writeBatch when an
// action has a counter effect. Sprint 4's history side panel reads stageId
// only and no longer needs the marker, at which point this is removed.
export const COUNTER_LEGACY_EVENT_STAGE: Record<'escalation' | 'iteration', number> = {
  escalation: 3,
  iteration: 9,
}

// Reverse map used by the Sprint 5 migration script.
export const NUMERIC_STAGE_TO_ID: Record<number, string> = {
  1: 'created',
  2: 'allocated',
  // legacy 3 was the escalation marker — map back to 'created' so historical
  // events render under the right label after migration
  3: 'created',
  // legacy 4 was 'Accepted', a waystation that no longer exists in the new
  // flow — projects that were sitting there at migration time land at the
  // next live stage, 'eligibility_review'.
  4: 'eligibility_review',
  5: 'eligibility_review',
  6: 'task_setup',
  7: 'in_execution',
  8: 'lead_review',
  // legacy 9 was the rework marker — map back to 'in_execution'
  9: 'in_execution',
  10: 'delivered',
}
