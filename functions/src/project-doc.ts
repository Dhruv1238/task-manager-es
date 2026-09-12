import { Timestamp, FieldValue } from 'firebase-admin/firestore'

/**
 * Building a project document, server-side.
 *
 * This mirrors `addProject()` in `src/lib/firestore.ts`, which is the only
 * other place a project is ever created. It is deliberately a re-statement
 * rather than a shared module: the web app bundles `src/` through Vite and
 * this package compiles standalone with tsc, and wiring one to import the
 * other buys a build coupling for ~60 lines of logic.
 *
 * WHAT MUST NOT BE DROPPED — each of these fails quietly rather than loudly:
 *   - `accessKeys`   every non-admin project query filters on it, and the
 *                    chat subcollection rule does `uid in accessKeys`, which
 *                    ERRORS (and therefore denies) on a missing field.
 *   - `pinnedWorkflow` the stage banner and action modal read the embedded
 *                    copy, not `/workflows/{id}`. Absent it, the project
 *                    opens with no stage and no actions.
 *   - `titleLower`   the projects list searches and sorts on it, so a project
 *                    without one is simply missing from that screen.
 *   - concrete Timestamps inside `projectHistory` — Firestore rejects a
 *                    `serverTimestamp()` sentinel nested in an array, so the
 *                    whole write fails. Only top-level `createdAt`/`updatedAt`
 *                    get the server clock.
 */

/** The shape we need off a workflow doc. Everything else rides along verbatim. */
export interface WorkflowLike {
  id: string
  displayName?: string
  entryStageId?: string
  stages?: Array<{ id: string; order?: number }>
  projectRoles?: Array<{ id: string; assignedToCreatorOnNew?: boolean }>
  [key: string]: unknown
}

export interface BuildProjectInput {
  title: string
  description: string
  createdBy: string
  workflow: WorkflowLike
  /** ISO 8601, or undefined for no deadline. */
  deadline?: string
  /** Workflow custom-field values, keyed by field id. */
  fields?: Record<string, unknown>
  /**
   * Uids to add to `accessKeys` alongside the creator. Used to let the rep who
   * closed the deal watch it, when they happen to have an account here — it
   * grants visibility only, never ownership or a role.
   */
  extraViewers?: string[]
  /** Provenance — what this project was created FROM. */
  source: {
    portal: string
    leadId: string
    leadUrl?: string
    actorEmail?: string
    actorName?: string
    dealValue?: number
  }
}

/**
 * Mirrors `resolveEntryStage` in `src/lib/workflowEvaluator.ts`: the declared
 * entry stage when it exists and resolves, otherwise the lowest `order`.
 */
export function resolveEntryStageId(workflow: WorkflowLike): string {
  const stages = workflow.stages ?? []
  if (stages.length === 0) {
    throw new Error(`Workflow "${workflow.id}" has no stages`)
  }

  if (workflow.entryStageId) {
    const declared = stages.find((stage) => stage.id === workflow.entryStageId)
    if (declared) return declared.id
  }

  const byOrder = [...stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return byOrder[0].id
}

/**
 * Mirrors `computeAccessKeys` in `src/lib/firestore.ts` for the creation case.
 *
 * On create there is no team and no assignee yet, so the visibility set is the
 * creator plus whoever any role landed on. Deduplicated, and never empty —
 * an empty array would hide the project from everyone but a super admin.
 */
export function computeAccessKeys(
  createdBy: string,
  roleAssignments: Record<string, string | string[]> | undefined,
  leadUid: string | null,
  extraViewers: string[] = [],
): string[] {
  const keys = new Set<string>([createdBy])
  if (leadUid) keys.add(leadUid)
  for (const uid of extraViewers) if (uid) keys.add(uid)

  for (const value of Object.values(roleAssignments ?? {})) {
    if (Array.isArray(value)) value.forEach((uid) => uid && keys.add(uid))
    else if (value) keys.add(value)
  }

  return [...keys]
}

/**
 * Roles the workflow says should land on whoever creates the project.
 * Mirrors the `assignedToCreatorOnNew` pre-seed in `addProject()`.
 */
function seedCreatorRoles(
  workflow: WorkflowLike,
  createdBy: string,
): Record<string, string | string[]> {
  const assignments: Record<string, string | string[]> = {}
  for (const role of workflow.projectRoles ?? []) {
    if (role.assignedToCreatorOnNew) assignments[role.id] = createdBy
  }
  return assignments
}

function parseDeadline(iso: string | undefined): Timestamp | undefined {
  if (!iso) return undefined
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return undefined
  return Timestamp.fromDate(parsed)
}

/**
 * The document to write at `projects/{id}`.
 *
 * `createdAt`/`updatedAt` come back as server sentinels, so this object is
 * only ever valid as the argument to a Firestore write — do not read fields
 * off it expecting real values.
 */
export function buildProjectDoc(input: BuildProjectInput): Record<string, unknown> {
  const entryStageId = resolveEntryStageId(input.workflow)
  const roleAssignments = seedCreatorRoles(input.workflow, input.createdBy)
  const hasRoles = Object.keys(roleAssignments).length > 0
  const deadline = parseDeadline(input.deadline)

  // Concrete, not serverTimestamp(): these sit inside an array. Both events
  // share one instant so the history reads as a single creation moment.
  const now = Timestamp.now()

  return {
    title: input.title,
    titleLower: input.title.trim().toLowerCase(),
    description: input.description,
    createdBy: input.createdBy,
    status: 'in_progress',
    teamIds: [],
    accessKeys: computeAccessKeys(input.createdBy, roleAssignments, null, input.extraViewers),
    attachments: [],
    ...(deadline ? { deadline } : {}),
    ...(hasRoles ? { roleAssignments } : {}),
    ...(input.fields && Object.keys(input.fields).length ? { fields: input.fields } : {}),
    workflowId: input.workflow.id,
    // Full snapshot, taken once and never refreshed — same contract as the app.
    pinnedWorkflow: input.workflow,
    currentStageId: entryStageId,
    leadUid: null,
    iterationCount: 0,
    escalationCount: 0,
    projectHistory: [
      {
        kind: 'workflow_assignment',
        workflowId: input.workflow.id,
        assignedAt: now,
        assignedBy: input.createdBy,
      },
      {
        kind: 'stage',
        stageId: entryStageId,
        enteredAt: now,
        enteredBy: input.createdBy,
        payload: null,
      },
    ],
    // Provenance. `sourceLeadId` is the dedupe key an operator can query on;
    // the rest is what makes an imported project traceable back to the deal.
    sourcePortal: input.source.portal,
    sourceLeadId: input.source.leadId,
    ...(input.source.leadUrl ? { sourceLeadUrl: input.source.leadUrl } : {}),
    ...(input.source.actorEmail ? { sourceActorEmail: input.source.actorEmail } : {}),
    ...(input.source.actorName ? { sourceActorName: input.source.actorName } : {}),
    ...(typeof input.source.dealValue === 'number'
      ? { sourceDealValue: input.source.dealValue }
      : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
