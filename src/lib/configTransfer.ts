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
import { readActors } from './rules/outcomeAdapter'
import { saveRoleHierarchy } from './permissions/roleHierarchyAuthoring'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'
import type { Workflow, WorkflowRegistry } from '../types/workflow'
import type { OrgStructure } from '../types/models'
import type { HierarchyLevel, RoleDef } from '../types/v2'

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
}

export interface ImportSummary {
  workflows: number
  orgStructure: boolean
  registry: boolean
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
  const [orgSnap, wfSnap] = await Promise.all([
    getDoc(tenantDoc('config', 'orgStructure')),
    getDocs(tenantCol('workflows')),
  ])

  const orgStructure = orgSnap.exists() ? stripOrgAudit(orgSnap.data() as OrgStructure) : null

  // Collect every non-registry workflow + capture the registry, then keep only
  // the ACTIVE ones (ids in registry.activeWorkflowIds). Inactive / seeded-but-
  // unused workflows are dropped — the target tenant only needs what the registry
  // surfaces, and every active id still has its doc in the bundle.
  const allWorkflows: WorkflowExport[] = []
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
    allWorkflows.push(stripWorkflowAudit({ ...(d.data() as Workflow), id: d.id }))
  }
  const activeIds = new Set(registry?.activeWorkflowIds ?? [])
  const workflows = allWorkflows.filter((w) => activeIds.has(w.id))

  return {
    schemaVersion: 1,
    exportedAt: exportedAtMs,
    sourceSandbox: IS_SANDBOX,
    orgStructure,
    workflows,
    registry,
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

  // Note: chat is always-on (the features.chat flag is retired), so the bundle
  // no longer carries or writes any appConfig feature flags.

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
  // Hierarchy roles the workflow's actors / user-pickers reference (by `role:<id>`),
  // so the flow is portable: importing into another tenant re-creates any that are
  // missing. Only the *referenced* roles + the levels they occupy travel — never
  // the whole hierarchy (that's the tenant-scoped Dev Tools bundle's job).
  roles?: RoleDef[]
  hierarchyLevels?: HierarchyLevel[]
}

// Hierarchy role ids an action references — via a v2 `role` actor or a user_picker
// input scoped to `role:<id>`. (project_role / pipeline_role / team_role actors
// don't reference RoleDefs; project roles travel inside the workflow doc already.)
function referencedRoleIds(wf: Workflow): Set<string> {
  const ids = new Set<string>()
  for (const stage of wf.stages ?? []) {
    for (const action of stage.actions ?? []) {
      for (const a of readActors(action).all) {
        if (a && a.kind === 'role' && a.roleId) ids.add(a.roleId)
      }
      for (const input of action.inputs ?? []) {
        const scope = input.pickerScope
        if (input.type === 'user_picker' && typeof scope === 'string' && scope.startsWith('role:')) {
          ids.add(scope.slice('role:'.length))
        }
      }
    }
  }
  // Status-change permission actors can also reference a hierarchy role.
  for (const a of wf.canUpdateStatusActors ?? []) {
    if (a && a.kind === 'role' && a.roleId) ids.add(a.roleId)
  }
  return ids
}

export function serializeWorkflow(
  wf: Workflow,
  exportedAtMs: number,
  org?: { roleHierarchy?: RoleDef[]; hierarchyLevels?: HierarchyLevel[] },
): WorkflowExportEnvelope {
  const envelope: WorkflowExportEnvelope = {
    kind: 'workflow',
    schemaVersion: 1,
    exportedAt: exportedAtMs,
    workflow: stripWorkflowAudit(wf),
  }
  // Embed the referenced hierarchy roles (+ the levels they sit at) so the flow
  // carries its access wiring to another tenant.
  if (org?.roleHierarchy?.length) {
    const refIds = referencedRoleIds(wf)
    const roles = org.roleHierarchy.filter((r) => refIds.has(r.id))
    if (roles.length) {
      envelope.roles = roles
      const levelsNeeded = new Set(roles.map((r) => r.level))
      const levels = (org.hierarchyLevels ?? []).filter((l) => levelsNeeded.has(l.level))
      if (levels.length) envelope.hierarchyLevels = levels
    }
  }
  return envelope
}

function isWorkflowEnvelope(v: unknown): v is WorkflowExportEnvelope {
  return Boolean(
    v &&
      typeof v === 'object' &&
      (v as { kind?: unknown }).kind === 'workflow' &&
      'workflow' in (v as object),
  )
}

export interface ParsedWorkflowImport {
  workflow: Workflow
  // Referenced hierarchy roles carried in the envelope (if any). Feed through
  // mergeWorkflowRolesIntoOrg before relying on the workflow's `role:<id>` actors.
  roles?: RoleDef[]
  hierarchyLevels?: HierarchyLevel[]
}

/**
 * Parse a single-workflow export (envelope OR a raw workflow object) into a
 * Workflow-shaped draft with audit fields defaulted — mirrors draftToWorkflow
 * in FlowAuthoring — plus any referenced roles the envelope carried. Throws a
 * friendly error on a bad shape.
 */
export function parseWorkflowImport(text: string): ParsedWorkflowImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const envelope = isWorkflowEnvelope(parsed) ? parsed : null
  const raw = envelope ? envelope.workflow : parsed
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
    workflow: {
      ...(w as Workflow),
      id: w.id ?? '__imported__',
      version: 1,
      updatedAt: Timestamp.now(),
      updatedBy: '',
    },
    roles: envelope?.roles,
    hierarchyLevels: envelope?.hierarchyLevels,
  }
}

export interface RoleMergeResult {
  added: RoleDef[]
  addedLevels: HierarchyLevel[]
  // An added role's level NUMBER already exists in the target but with a different
  // label. `level` is a tenant-relative positional value (unlike the stable role
  // id), so we keep the target's label (never clobber) and surface the mismatch
  // rather than silently re-pointing the role's authority.
  levelConflicts: { level: number; incomingLabel: string; existingLabel: string }[]
}

/**
 * Additively merge a workflow's referenced hierarchy roles into the current
 * tenant's org structure. Roles are matched by stable `id` — existing ones are
 * NEVER clobbered, only genuinely-new ids are appended.
 *
 * `hierarchyLevels` is display-only metadata (permission compute keys off the
 * numeric RoleDef.level, never the labels), and `level` is tenant-relative — so
 * for levels we ONLY guarantee each *added* role has a renderable level row:
 *   - level number already present in the target → keep the target's label (no
 *     clobber); record a `levelConflict` if the incoming label differs.
 *   - level number absent → append it (preferring the envelope's label, else a
 *     `Level N` placeholder).
 * We never append a level for a role that already existed (no orphan level), and
 * never overwrite an existing label. Reuses saveRoleHierarchy (merge write); no
 * write when nothing is new.
 */
export async function mergeWorkflowRolesIntoOrg(
  roles: RoleDef[] | undefined,
  levels: HierarchyLevel[] | undefined,
  org: OrgStructure,
  adminUid: string,
): Promise<RoleMergeResult> {
  const existingRoles = org.roleHierarchy ?? []
  const haveRoleIds = new Set(existingRoles.map((r) => r.id))
  const added = (roles ?? []).filter((r) => !haveRoleIds.has(r.id))

  const existingLevels = org.hierarchyLevels ?? []
  const existingLabelByLevel = new Map(existingLevels.map((l) => [l.level, l.label]))
  const incomingLabelByLevel = new Map((levels ?? []).map((l) => [l.level, l]))

  // Only ensure the levels occupied by *added* roles are renderable.
  const addedLevels: HierarchyLevel[] = []
  const levelConflicts: RoleMergeResult['levelConflicts'] = []
  const seenNewLevels = new Set<number>()
  for (const role of added) {
    const num = role.level
    const existingLabel = existingLabelByLevel.get(num)
    if (existingLabel !== undefined) {
      const incoming = incomingLabelByLevel.get(num)
      if (
        incoming?.label &&
        incoming.label !== existingLabel &&
        !levelConflicts.some((c) => c.level === num)
      ) {
        levelConflicts.push({ level: num, incomingLabel: incoming.label, existingLabel })
      }
      continue
    }
    if (seenNewLevels.has(num)) continue
    seenNewLevels.add(num)
    addedLevels.push(incomingLabelByLevel.get(num) ?? { level: num, label: `Level ${num}` })
  }

  if (!added.length && !addedLevels.length) {
    return { added: [], addedLevels: [], levelConflicts }
  }

  const nextRoles = [...existingRoles, ...added]
  const nextLevels = [...existingLevels, ...addedLevels].sort((a, b) => a.level - b.level)
  await saveRoleHierarchy(adminUid, nextLevels, nextRoles)
  return { added, addedLevels, levelConflicts }
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
