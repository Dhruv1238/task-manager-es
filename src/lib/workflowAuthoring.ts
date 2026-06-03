/**
 * Authoring-time helpers for the workflow wizard + standalone editor (Phase 2c).
 *
 * Pure data shaping + a single Firestore write helper that atomically writes
 * /workflows/{id} and the registry's activeWorkflowIds in a transaction.
 */
import {
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { tenantDoc } from './firestore'
import type {
  CustomFieldDef,
  ProjectRoleDef,
  Workflow,
  WorkflowRegistry,
  WorkflowStatusOption,
} from '../types/workflow'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'
import { buildBasicWorkflow } from './seedBasicWorkflow'
import { buildCollabDefaultWorkflow } from './seedCollabWorkflow'
import { buildSalesDefaultWorkflow } from './seedSalesWorkflow'

// ─── Firestore undefined guard ────────────────────────────────────────────────
// Firestore's set() throws on ANY `undefined` anywhere in the document
// ("Unsupported field value: undefined") but never says WHERE. This deep-walks a
// plain payload and returns a cleaned clone (undefined object keys + array
// entries dropped) plus the exact dot-paths that were undefined — so we can log
// the offending field AND still write a doc Firestore accepts.
// IMPORTANT: only pass plain data. Timestamp instances pass through untouched;
// never run serverTimestamp()/FieldValue sentinels through here — add those
// AFTER sanitizing, or they'll be flattened into broken objects.
export function sanitizeForFirestore(value: unknown): { clean: unknown; undefinedPaths: string[] } {
  const undefinedPaths: string[] = []
  function walk(v: unknown, path: string): unknown {
    if (v === undefined) {
      undefinedPaths.push(path || '(root)')
      return undefined
    }
    if (v === null || typeof v !== 'object' || v instanceof Timestamp) return v
    if (Array.isArray(v)) {
      // Firestore arrays can't hold undefined — drop any undefined entries.
      return v.map((item, i) => walk(item, `${path}[${i}]`)).filter((item) => item !== undefined)
    }
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const cleaned = walk(val, path ? `${path}.${k}` : k)
      if (cleaned !== undefined) out[k] = cleaned
    }
    return out
  }
  return { clean: walk(value, ''), undefinedPaths }
}

// ─── ID derivation ────────────────────────────────────────────────────────────

// Slug-cased lowercase ascii ids. Collisions are resolved with -2, -3, ...
// suffixes. Reserved ids (the registry sentinel + the three system ids) can
// never be reused by tenant-authored workflows.
const RESERVED_IDS = new Set(['_registry', 'basic', 'collab-default', 'sales-default'])

export function slugifyWorkflowId(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'workflow'
}

export function deriveWorkflowId(
  displayName: string,
  existingIds: Iterable<string>,
): string {
  const base = slugifyWorkflowId(displayName)
  const taken = new Set<string>()
  for (const id of existingIds) taken.add(id)
  for (const r of RESERVED_IDS) taken.add(r)

  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

// ─── Template clones ─────────────────────────────────────────────────────────
// Cloning a template produces a fresh editable workflow with `isSystemDefined:
// false`, no id (the editor derives one from the displayName at save), and
// stage / action ids re-derived so collisions don't surface if the tenant
// later forks a second copy.

type Draft = Omit<Workflow, 'updatedAt' | 'updatedBy' | 'version' | 'id'> & {
  id?: string
}

export function emptyDraft(displayName = 'Untitled Workflow'): Draft {
  return {
    displayName,
    flowType: 'collaborative',
    leadRoleName: '',
    isSystemDefined: false,
    description: '',
    recommendedLeads: [],
    stages: [
      {
        id: 'in_progress',
        displayName: 'In Progress',
        order: 1,
        isTerminal: false,
        actions: [],
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

export function cloneTemplate(
  templateId: 'basic' | 'collab-default' | 'sales-default',
): Draft {
  let source: Omit<Workflow, 'updatedAt' | 'updatedBy' | 'version'>
  switch (templateId) {
    case 'basic':
      source = buildBasicWorkflow()
      break
    case 'collab-default':
      source = buildCollabDefaultWorkflow()
      break
    case 'sales-default':
      source = buildSalesDefaultWorkflow()
      break
  }
  return {
    displayName: source.displayName,
    flowType: source.flowType,
    leadRoleName: source.leadRoleName,
    isSystemDefined: false,
    description: source.description ?? '',
    creationModalCardSubtitle: source.creationModalCardSubtitle,
    creationModalDescription: source.creationModalDescription,
    recommendedLeads: source.recommendedLeads ?? [],
    // Phase 2d: carry the template's roles / fields / statuses into the clone
    // (deep-copied so editing the clone never mutates the seed builder output).
    projectRoles: source.projectRoles?.map((r) => ({ ...r })),
    projectFields: source.projectFields
      ? { customFields: source.projectFields.customFields?.map((f) => ({ ...f })) }
      : undefined,
    statusOptions: source.statusOptions?.map((s) => ({ ...s })),
    canUpdateStatusActors: source.canUpdateStatusActors?.map((a) => ({ ...a })),
    stages: source.stages.map((s) => ({ ...s, actions: s.actions.map((a) => ({ ...a })) })),
  }
}

// ─── Skeleton builder for the conversational wizard ───────────────────────────

export function buildSkeletonFromStageNames(
  displayName: string,
  description: string,
  flowType: Workflow['flowType'],
  stageNames: string[],
  // Phase 2d: optional roles / custom fields / statuses collected by the
  // wizard's new steps. Threaded onto the draft so they reach the editor + save.
  extras?: {
    projectRoles?: ProjectRoleDef[]
    customFields?: CustomFieldDef[]
    statusOptions?: WorkflowStatusOption[]
  },
): Draft {
  const used = new Set<string>()
  const stages = stageNames.map((name, idx) => {
    const baseId = slugifyWorkflowId(name) || `stage-${idx + 1}`
    let id = baseId
    let n = 2
    while (used.has(id)) {
      id = `${baseId}-${n}`
      n += 1
    }
    used.add(id)
    return {
      id,
      displayName: name,
      order: idx + 1,
      isTerminal: idx === stageNames.length - 1,
      actions: [],
    }
  })

  return {
    displayName,
    flowType,
    leadRoleName: '',
    isSystemDefined: false,
    description: description.trim() || undefined,
    recommendedLeads: [],
    stages,
    ...(extras?.projectRoles ? { projectRoles: extras.projectRoles } : {}),
    ...(extras?.customFields ? { projectFields: { customFields: extras.customFields } } : {}),
    ...(extras?.statusOptions ? { statusOptions: extras.statusOptions } : {}),
  }
}

// ─── Atomic save+activate ─────────────────────────────────────────────────────
// Writes /workflows/{id} and patches /workflows/_registry.activeWorkflowIds in
// a single transaction. The workflow either appears registered or not at all.

export interface SaveWorkflowInput {
  draft: Draft
  adminUid: string
  // When true, append to registry.activeWorkflowIds (if not present) and set
  // defaultWorkflowId when the registry has none. When false, write the doc
  // but leave the registry alone — used for "Save as draft".
  activate: boolean
  // Optional explicit id (edit mode passes the existing id; create mode
  // derives it from displayName).
  workflowId?: string
}

export interface SaveWorkflowResult {
  workflowId: string
  newVersion: number
  activated: boolean
  // The exact workflow doc that was written, so the caller can
  // `setWorkflowOptimistic(workflow)` without waiting for a re-fetch. Uses
  // Timestamp.now() approximations for the server-stamped fields — close
  // enough for cache + render purposes; a future read will get the real
  // server values.
  workflow: Workflow
  // The exact registry doc that was written, OR null when not activating.
  // Same approximation note as `workflow`. Caller should call
  // `setRegistryOptimistic(registry)` when present.
  registry: WorkflowRegistry | null
}

// Read an iterable of existing workflow ids from the registry + a single
// `getDoc` of /workflows/{id} for collision detection. Kept outside the
// transaction since the transaction's readset is limited.
async function gatherExistingIds(): Promise<string[]> {
  const ids: string[] = []
  const registrySnap = await getDoc(tenantDoc('workflows', WORKFLOW_REGISTRY_ID))
  if (registrySnap.exists()) {
    const r = registrySnap.data() as WorkflowRegistry
    for (const id of r.activeWorkflowIds ?? []) ids.push(id)
  }
  // Plus the three system ids, which exist even when not in the registry.
  ids.push('basic', 'collab-default', 'sales-default')
  return ids
}

export async function saveWorkflowAndMaybeActivate(
  input: SaveWorkflowInput,
): Promise<SaveWorkflowResult> {
  const existingIds = await gatherExistingIds()
  const workflowId =
    input.workflowId ?? deriveWorkflowId(input.draft.displayName, existingIds)

  return runTransaction(db, async (tx) => {
    // Firestore enforces: ALL reads must happen before ANY writes inside a
    // transaction. Read both docs up-front, then compute, then write.
    const workflowRef = tenantDoc('workflows', workflowId)
    const registryRef = tenantDoc('workflows', WORKFLOW_REGISTRY_ID)

    // ─── Reads ──────────────────────────────────────────────────────────
    const existing = await tx.get(workflowRef)
    const registrySnap = input.activate ? await tx.get(registryRef) : null

    // ─── Compute payloads ───────────────────────────────────────────────
    const previousVersion = existing.exists()
      ? ((existing.data() as { version?: number }).version ?? 0)
      : 0
    const newVersion = previousVersion + 1

    const payload: Workflow = {
      id: workflowId,
      displayName: input.draft.displayName,
      flowType: input.draft.flowType,
      leadRoleName: input.draft.leadRoleName ?? '',
      isSystemDefined: input.draft.isSystemDefined ?? false,
      stages: input.draft.stages,
      recommendedLeads: input.draft.recommendedLeads ?? [],
      description: input.draft.description,
      creationModalCardSubtitle: input.draft.creationModalCardSubtitle,
      creationModalDescription: input.draft.creationModalDescription,
      // Phase 2d: persist roles / custom fields / statuses / status-permission.
      // Default to empty so undefined never reaches Firestore and readers stay
      // safe; the pinned snapshot on new projects then carries these too.
      projectRoles: input.draft.projectRoles ?? [],
      projectFields: input.draft.projectFields ?? { customFields: [] },
      statusOptions: input.draft.statusOptions ?? [],
      canUpdateStatusActors: input.draft.canUpdateStatusActors ?? [],
      // Phase 3: persist canvas positions + entry task so they ride the
      // snapshot-pin onto new projects. Omitted-when-absent so undefined never
      // reaches Firestore (legacy flows auto-lay-out on first open instead).
      ...(input.draft.canvasLayout ? { canvasLayout: input.draft.canvasLayout } : {}),
      ...(input.draft.entryStageId ? { entryStageId: input.draft.entryStageId } : {}),
      version: newVersion,
      lastEditedAt: Timestamp.now(),
      lastEditedBy: input.adminUid,
      updatedAt: Timestamp.now(),
      updatedBy: input.adminUid,
    }

    let activated = false
    let registryWrite: Record<string, unknown> | null = null
    let nextRegistry: WorkflowRegistry | null = null
    if (input.activate && registrySnap) {
      const registry: WorkflowRegistry = registrySnap.exists()
        ? (registrySnap.data() as WorkflowRegistry)
        : {
            version: 0,
            updatedAt: Timestamp.now(),
            updatedBy: input.adminUid,
            activeWorkflowIds: [],
            defaultWorkflowId: null,
          }
      const active = new Set(registry.activeWorkflowIds ?? [])
      if (!active.has(workflowId)) {
        const nextIds = [...(registry.activeWorkflowIds ?? []), workflowId]
        const nextDefault = registry.defaultWorkflowId ?? workflowId
        registryWrite = {
          version: (registry.version ?? 0) + 1,
          activeWorkflowIds: nextIds,
          defaultWorkflowId: nextDefault,
          updatedAt: serverTimestamp(),
          updatedBy: input.adminUid,
        }
        activated = true
        // Mirror the same shape (with Timestamp.now() approximating the
        // server timestamp) so the caller can update local state immediately
        // — readers don't differentiate the two in the millisecond between
        // the optimistic update and the eventual server-stamped read.
        nextRegistry = {
          version: (registry.version ?? 0) + 1,
          activeWorkflowIds: nextIds,
          defaultWorkflowId: nextDefault,
          updatedAt: Timestamp.now(),
          updatedBy: input.adminUid,
        }
      } else {
        // Already active — surface the existing registry so the caller can
        // still refresh its in-memory copy without an extra read.
        nextRegistry = registry
      }
    }

    // ─── Writes ─────────────────────────────────────────────────────────
    // Guard: Firestore rejects ANY `undefined` in the doc and won't say where.
    // Deep-clean the plain payload (logging the exact path[s]) BEFORE layering
    // on the serverTimestamp sentinels — those must NOT pass through sanitize.
    const { clean, undefinedPaths } = sanitizeForFirestore(payload)
    if (undefinedPaths.length) {
      console.warn(
        `[saveWorkflow] workflows/${workflowId}: stripped ${undefinedPaths.length} undefined field(s) →`,
        undefinedPaths,
      )
      console.warn('[saveWorkflow] full payload that contained undefined:', payload)
    }
    tx.set(workflowRef, {
      ...(clean as Record<string, unknown>),
      updatedAt: serverTimestamp(),
      lastEditedAt: serverTimestamp(),
    })
    if (registryWrite) {
      tx.set(registryRef, registryWrite)
    }

    return {
      workflowId,
      newVersion,
      activated,
      workflow: payload,
      registry: nextRegistry,
    }
  })
}

// ─── Duplicate a system template into an editable copy ───────────────────────

export async function duplicateSystemWorkflow(
  source: Workflow,
  adminUid: string,
): Promise<SaveWorkflowResult> {
  const existingIds = await gatherExistingIds()
  const newId = deriveWorkflowId(`${source.displayName} (copy)`, existingIds)
  const draft: Draft = {
    id: newId,
    displayName: `${source.displayName} (copy)`,
    flowType: source.flowType,
    leadRoleName: source.leadRoleName ?? '',
    isSystemDefined: false,
    description: source.description ?? '',
    creationModalCardSubtitle: source.creationModalCardSubtitle,
    creationModalDescription: source.creationModalDescription,
    recommendedLeads: source.recommendedLeads ?? [],
    // Phase 2d: carry roles / fields / statuses into the duplicate.
    projectRoles: source.projectRoles?.map((r) => ({ ...r })),
    projectFields: source.projectFields
      ? { customFields: source.projectFields.customFields?.map((f) => ({ ...f })) }
      : undefined,
    statusOptions: source.statusOptions?.map((s) => ({ ...s })),
    canUpdateStatusActors: source.canUpdateStatusActors?.map((a) => ({ ...a })),
    stages: source.stages.map((s) => ({ ...s, actions: s.actions.map((a) => ({ ...a })) })),
  }
  return saveWorkflowAndMaybeActivate({
    draft,
    adminUid,
    activate: false,
    workflowId: newId,
  })
}

export type WorkflowDraft = Draft
