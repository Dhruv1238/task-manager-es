/**
 * Config Transfer — dev-tool utilities to move authored configuration between
 * tenants as portable JSON.
 *
 * Two scopes:
 *   - Tenant-scoped (exportTenantConfig / importTenantConfig): the whole config
 *     surface — org structure + role hierarchy, every workflow, the registry,
 *     and the chat feature flag. Used to migrate a legacy tenant onto the new
 *     config-driven system (paired with resetTenantPreservingPeople in
 *     wipeTenant.ts).
 *   - Workflow-scoped (serializeWorkflow / parseWorkflowImport): a single
 *     workflow, for the canvas editor's Export / Import buttons.
 *
 * The bundle carries NO Firestore `Timestamp`s: audit/version fields are
 * stripped on export and re-stamped (serverTimestamp + version bump) on import,
 * so the JSON serializes cleanly and is safe to commit to the repo.
 *
 * Deliberately EXCLUDED from every export: users, teams, projects, tasks,
 * auditEvents — and any per-user role assignments (`user.roleIds`). Role
 * assignments are re-done by hand on the target tenant via /admin/roles
 * (uids differ across tenants).
 */
import { getDoc, getDocs, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { IS_SANDBOX, tenantCol, tenantDoc } from './firestore'
import { sanitizeForFirestore } from './workflowAuthoring'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'
import type { Workflow, WorkflowRegistry } from '../types/workflow'
import type { AppConfig, OrgStructure } from '../types/models'

// ─── Bundle shapes ─────────────────────────────────────────────────────────

export type WorkflowExport = Omit<
  Workflow,
  'version' | 'updatedAt' | 'updatedBy' | 'lastEditedAt' | 'lastEditedBy'
>
export type OrgStructureConfig = Omit<OrgStructure, 'version' | 'updatedAt' | 'updatedBy'>

export interface ConfigBundle {
  schemaVersion: 1
  exportedAt: number
  sourceSandbox: boolean
  orgStructure: OrgStructureConfig | null
  workflows: WorkflowExport[]
  registry: { activeWorkflowIds: string[]; defaultWorkflowId: string | null } | null
  appFeatures: { chat: boolean }
}

export interface ImportSummary {
  workflows: number
  orgStructure: boolean
  registry: boolean
  appConfig: boolean
}

// ─── Audit-field stripping (clone + delete avoids no-unused-vars on destructure) ─

function stripWorkflowAudit(wf: Workflow): WorkflowExport {
  const clone: Record<string, unknown> = { ...wf }
  delete clone.version
  delete clone.updatedAt
  delete clone.updatedBy
  delete clone.lastEditedAt
  delete clone.lastEditedBy
  return clone as unknown as WorkflowExport
}

function stripOrgAudit(org: OrgStructure): OrgStructureConfig {
  const clone: Record<string, unknown> = { ...org }
  delete clone.version
  delete clone.updatedAt
  delete clone.updatedBy
  return clone as unknown as OrgStructureConfig
}

// ─── Tenant-scoped export ────────────────────────────────────────────────────

/**
 * Read the current tenant's config surface into a portable bundle.
 * `exportedAtMs` is passed in by the caller (e.g. `Date.now()`).
 */
export async function exportTenantConfig(exportedAtMs: number): Promise<ConfigBundle> {
  const [orgSnap, wfSnap, appSnap] = await Promise.all([
    getDoc(tenantDoc('config', 'orgStructure')),
    getDocs(tenantCol('workflows')),
    getDoc(tenantDoc('config', 'appConfig')),
  ])

  const orgStructure = orgSnap.exists() ? stripOrgAudit(orgSnap.data() as OrgStructure) : null

  const workflows: WorkflowExport[] = []
  let registry: ConfigBundle['registry'] = null
  for (const d of wfSnap.docs) {
    if (d.id === WORKFLOW_REGISTRY_ID) {
      const r = d.data() as WorkflowRegistry
      registry = {
        activeWorkflowIds: r.activeWorkflowIds ?? [],
        defaultWorkflowId: r.defaultWorkflowId ?? null,
      }
      continue
    }
    // Include system + custom workflows so a freshly-reset target tenant has
    // everything the registry points at.
    workflows.push(stripWorkflowAudit({ ...(d.data() as Workflow), id: d.id }))
  }

  const appFeatures = {
    chat: appSnap.exists() ? Boolean((appSnap.data() as AppConfig).features?.chat) : true,
  }

  return {
    schemaVersion: 1,
    exportedAt: exportedAtMs,
    sourceSandbox: IS_SANDBOX,
    orgStructure,
    workflows,
    registry,
    appFeatures,
  }
}

// ─── Tenant-scoped import ────────────────────────────────────────────────────

function assertBundle(bundle: unknown): asserts bundle is ConfigBundle {
  const b = bundle as Partial<ConfigBundle> | null
  if (!b || typeof b !== 'object' || b.schemaVersion !== 1) {
    throw new Error('Unrecognised config bundle (expected schemaVersion 1).')
  }
  const hasOrg = Boolean(b.orgStructure)
  const hasWorkflows = Array.isArray(b.workflows) && b.workflows.length > 0
  if (!hasOrg && !hasWorkflows) {
    throw new Error('Config bundle has no orgStructure or workflows to import.')
  }
}

/**
 * Write a config bundle into the current tenant. Re-stamps version/updatedAt/
 * updatedBy on every doc and runs values through `sanitizeForFirestore` so no
 * stray `undefined` reaches Firestore. Never touches users or teams.
 */
export async function importTenantConfig(
  bundle: ConfigBundle,
  adminUid: string,
): Promise<ImportSummary> {
  assertBundle(bundle)
  const summary: ImportSummary = {
    workflows: 0,
    orgStructure: false,
    registry: false,
    appConfig: false,
  }

  // Org structure (force setupCompleted so the target doesn't bounce to the setup wizard).
  if (bundle.orgStructure) {
    const ref = tenantDoc('config', 'orgStructure')
    const prev = await getDoc(ref)
    const previousVersion = prev.exists() ? ((prev.data() as OrgStructure).version ?? 0) : 0
    const { clean } = sanitizeForFirestore({ ...bundle.orgStructure, setupCompleted: true })
    await setDoc(ref, {
      ...(clean as Record<string, unknown>),
      version: previousVersion + 1,
      updatedBy: adminUid,
      updatedAt: serverTimestamp(),
    })
    summary.orgStructure = true
  }

  // Workflows (each keyed by its own id).
  for (const wf of bundle.workflows ?? []) {
    if (!wf.id) continue
    const ref = tenantDoc('workflows', wf.id)
    const prev = await getDoc(ref)
    const previousVersion = prev.exists() ? ((prev.data() as { version?: number }).version ?? 0) : 0
    const { clean } = sanitizeForFirestore(wf)
    await setDoc(ref, {
      ...(clean as Record<string, unknown>),
      version: previousVersion + 1,
      updatedBy: adminUid,
      updatedAt: serverTimestamp(),
      lastEditedAt: serverTimestamp(),
      lastEditedBy: adminUid,
    })
    summary.workflows += 1
  }

  // Registry.
  if (bundle.registry) {
    const ref = tenantDoc('workflows', WORKFLOW_REGISTRY_ID)
    const prev = await getDoc(ref)
    const previousVersion = prev.exists() ? ((prev.data() as WorkflowRegistry).version ?? 0) : 0
    await setDoc(ref, {
      version: previousVersion + 1,
      updatedBy: adminUid,
      updatedAt: serverTimestamp(),
      activeWorkflowIds: bundle.registry.activeWorkflowIds ?? [],
      defaultWorkflowId: bundle.registry.defaultWorkflowId ?? null,
    })
    summary.registry = true
  }

  // App config — only the chat feature flag, merged over whatever's there.
  if (bundle.appFeatures) {
    const ref = tenantDoc('config', 'appConfig')
    const prev = await getDoc(ref)
    const prevData = prev.exists() ? (prev.data() as AppConfig) : null
    await setDoc(ref, {
      version: (prevData?.version ?? 0) + 1,
      updatedBy: adminUid,
      updatedAt: serverTimestamp(),
      features: { ...(prevData?.features ?? {}), chat: Boolean(bundle.appFeatures.chat) },
    })
    summary.appConfig = true
  }

  return summary
}

/** Parse + validate a pasted/uploaded tenant bundle. Throws on bad shape. */
export function parseConfigBundle(text: string): ConfigBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  assertBundle(parsed)
  return parsed
}

// ─── Workflow-scoped (canvas editor) ─────────────────────────────────────────

export interface WorkflowExportEnvelope {
  kind: 'workflow'
  schemaVersion: 1
  exportedAt: number
  workflow: WorkflowExport
}

export function serializeWorkflow(wf: Workflow, exportedAtMs: number): WorkflowExportEnvelope {
  return {
    kind: 'workflow',
    schemaVersion: 1,
    exportedAt: exportedAtMs,
    workflow: stripWorkflowAudit(wf),
  }
}

function isWorkflowEnvelope(v: unknown): v is WorkflowExportEnvelope {
  return Boolean(
    v &&
      typeof v === 'object' &&
      (v as { kind?: unknown }).kind === 'workflow' &&
      'workflow' in (v as object),
  )
}

/**
 * Parse a single-workflow export (envelope OR a raw workflow object) into a
 * Workflow-shaped draft with audit fields defaulted — mirrors draftToWorkflow
 * in FlowAuthoring. Throws a friendly error on a bad shape.
 */
export function parseWorkflowImport(text: string): Workflow {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const raw = isWorkflowEnvelope(parsed) ? parsed.workflow : parsed
  const w = raw as Partial<Workflow> | null
  if (
    !w ||
    typeof w !== 'object' ||
    typeof w.displayName !== 'string' ||
    typeof w.flowType !== 'string' ||
    !Array.isArray(w.stages)
  ) {
    throw new Error(
      'This does not look like a workflow export (missing displayName / flowType / stages).',
    )
  }
  return {
    ...(w as Workflow),
    id: w.id ?? '__imported__',
    version: 1,
    updatedAt: Timestamp.now(),
    updatedBy: '',
  }
}

// ─── Shared download helper ──────────────────────────────────────────────────

export function downloadJson(filename: string, data: unknown): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
