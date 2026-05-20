/**
 * Authoring-time helpers for the workflow wizard + standalone editor (Phase 2c).
 *
 * Pure data shaping + a single Firestore write helper that atomically writes
 * /workflows/{id} and the registry's activeWorkflowIds in a transaction.
 */
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Workflow, WorkflowRegistry } from '../types/workflow'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'
import { buildBasicWorkflow } from './seedBasicWorkflow'
import { buildCollabDefaultWorkflow } from './seedCollabWorkflow'
import { buildSalesDefaultWorkflow } from './seedSalesWorkflow'

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
    stages: source.stages.map((s) => ({ ...s, actions: s.actions.map((a) => ({ ...a })) })),
  }
}

// ─── Skeleton builder for the conversational wizard ───────────────────────────

export function buildSkeletonFromStageNames(
  displayName: string,
  description: string,
  flowType: Workflow['flowType'],
  stageNames: string[],
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
}

// Read an iterable of existing workflow ids from the registry + a single
// `getDoc` of /workflows/{id} for collision detection. Kept outside the
// transaction since the transaction's readset is limited.
async function gatherExistingIds(): Promise<string[]> {
  const ids: string[] = []
  const registrySnap = await getDoc(doc(db, 'workflows', WORKFLOW_REGISTRY_ID))
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
    const workflowRef = doc(db, 'workflows', workflowId)
    const registryRef = doc(db, 'workflows', WORKFLOW_REGISTRY_ID)

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
      version: newVersion,
      lastEditedAt: Timestamp.now(),
      lastEditedBy: input.adminUid,
      updatedAt: Timestamp.now(),
      updatedBy: input.adminUid,
    }

    let activated = false
    let registryWrite: Record<string, unknown> | null = null
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
      }
    }

    // ─── Writes ─────────────────────────────────────────────────────────
    tx.set(workflowRef, {
      ...payload,
      updatedAt: serverTimestamp(),
      lastEditedAt: serverTimestamp(),
    })
    if (registryWrite) {
      tx.set(registryRef, registryWrite)
    }

    return { workflowId, newVersion, activated }
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
