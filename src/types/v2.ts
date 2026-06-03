import type { Timestamp } from 'firebase/firestore'

// ─── Phase 3 — Authoring v2 types ────────────────────────────────────────────
//
// New schema slices layered on top of the 2a–2d substrate. Everything here is
// additive: workflow.ts / models.ts reference these through OPTIONAL fields, and
// the runtime reads legacy single-`effect` actions through outcomeAdapter.ts —
// so the three seeded workflows and every pre-3 doc keep working with zero
// re-authoring.
//
// IMPORTANT: keep RoleDef / HierarchyLevel / ModuleDef strictly plain-JSON
// (string | number | boolean | nested plain objects). They are persisted on the
// `orgStructure` / `config` docs and round-tripped through AppConfigContext's
// spread-based serialize/hydrate, which only special-cases Timestamp fields. A
// stray Timestamp here would silently corrupt the localStorage cache.

// ─── Role hierarchy + module RBAC (Layer 1) ──────────────────────────────────

// One configurable level in the N-level hierarchy. level 1 = highest authority;
// higher numbers = lower authority. Authority inherits DOWN the chain (a role at
// level j gets the union of grants of every role at level >= j).
export interface HierarchyLevel {
  level: number
  label: string // tenant-facing, e.g. 'Vertical Head' or 'L1'
}

// The four CRUD toggles for one module.
export interface ModuleGrant {
  view: boolean
  create: boolean
  update: boolean
  delete: boolean
}
export type ModuleOp = keyof ModuleGrant // 'view' | 'create' | 'update' | 'delete'

// A role in the new hierarchy. Stored at /config/roles/{roleId}. moduleGrants is
// folded onto the role doc to minimise reads.
export interface RoleDef {
  id: string // stable slug, never reused
  label: string // tenant-facing display name
  level: number // which HierarchyLevel this role occupies
  moduleGrants: Record<string, ModuleGrant> // keyed by moduleId (Layer 1)
  description?: string
  order: number
  // ─── Supersede bridge tags ──────────────────────────────────────────────
  // Let the runtime resolve a legacy team_role / pipeline_role / global_role
  // ActorRef onto this RoleDef WITHOUT re-authoring the seeded workflows. When a
  // RoleDef carries one of these, a user who matched the legacy actor (by team
  // membership / globalRole / lead pin) is treated as effectively holding this
  // RoleDef in effectivePermissions.ts. See PHASE_3 §C (supersede migration).
  legacyTeamRoleId?: 'coordinator' | 'validator' | 'specialist'
  legacyGlobalRole?: 'super_admin' | 'admin'
  legacyPipelineRole?: 'lead'
}

// A platform module (route/collection family) the access grid governs. Stored at
// /config/modules/{moduleId}. The concrete list is confirmed later with the
// code-level agent; DEFAULT_MODULE_IDS is the placeholder registry.
export interface ModuleDef {
  id: string
  label: string
  order: number
}

export const DEFAULT_MODULE_IDS = [
  'projects',
  'tasks',
  'teams',
  'members',
  'workflows',
  'reports',
  'settings',
] as const

// Computed + cached on /profiles/{uid}. Invalidated by a permissionsVersion
// stamp bump on any role/grant/level edit.
export interface EffectivePermissions {
  // moduleId → unioned grant down the level chain.
  grants: Record<string, ModuleGrant>
  // Every role id the user effectively holds (own + inherited-down + bridged).
  effectiveRoleIds: string[]
  // Lowest level number the user occupies (= highest authority). null when the
  // user holds no role. Drives the Layer-2 inheritance test j <= k.
  topLevel: number | null
}

// ─── Rules engine: outcomes & effects (Layer 2 runtime) ───────────────────────

// Every author-named outcome resolves to exactly one of these four shapes. This
// bounds the engine while leaving outcome naming open.
export type OutcomeShape = 'advance' | 'branch' | 'hold' | 'close'

export type EffectKind =
  | 'set_field' // ENABLED in v2 — runs client-side in the action transaction
  | 'notify' // coming soon (needs Functions)
  | 'create_subtask' // coming soon
  | 'allocate' // coming soon (auto-allocation)
  | 'spawn_project' // coming soon (awarded → execution)
  | 'webhook' // coming soon

export interface Effect {
  kind: EffectKind
  // false → rendered as a greyed "coming soon" row, never executed. Only
  // set_field can be authored enabled in v2.
  enabled: boolean
  // set_field: { fieldId, value } | { fieldId, fromInputId }
  params: Record<string, unknown>
}

// Minimal v2 condition (single comparison). Richer multi-clause logic + computed
// attributes are coming-soon.
export interface FieldCondition {
  fieldId: string
  op: 'eq' | 'neq' | 'gt' | 'lt' | 'in'
  value: unknown
}

// One author-named branch ("Approved", "Sent back", "Partial"). When a
// StageAction carries outcomes[], it supersedes the legacy single `effect`.
export interface Outcome {
  id: string
  label: string
  shape: OutcomeShape
  toStageId?: string // required for advance | branch
  terminalStatusId?: string // required for close → which statusOption
  effects?: Effect[] // zero or more (v2: set_field only, when enabled)
  // First-class "assign a person" (Phase 3.6): when set, performing this outcome
  // assigns the user picked in input `fromInputId` to the project lead, or to a
  // workflow project role (project.roleAssignments[roleId] → shown in
  // ProjectRolesSection). executeOutcome performs it + recomputes accessKeys.
  assign?: { target: 'lead' | { roleId: string }; fromInputId: string }
  // When this outcome was synthesized from a legacy ActionEffect, these carry
  // the source semantics so executeOutcome can replay lead/counter writes
  // faithfully (see outcomeAdapter.ts).
  legacyEffectKind?: string
  legacyCounter?: 'escalation' | 'iteration'
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

export interface CanvasNode {
  taskId: string
  x: number
  y: number
}
export interface CanvasEdge {
  id: string
  fromTaskId: string
  outcomeId: string
  toTaskId: string
}
export interface CanvasLayout {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

// ─── Subtasks (simple work item — no recursion in v2) ─────────────────────────
// Stored at /projects/{projectId}/subtasks/{subtaskId} via tenantCol.
export interface Subtask {
  id: string
  title: string
  assigneeId?: string
  status: 'todo' | 'in_progress' | 'done'
  dueDate?: string
  parentStageId?: string // which task it sits under, optional
  createdBy: string
  createdAt: Timestamp
}

// ─── Analytics counters (query-ready denormalisation) ─────────────────────────
// Stored at /config/analytics. Maintained transactionally inside executeOutcome
// so the tally can never drift. Dashboards (a later phase) read this directly.
export interface AnalyticsCounters {
  statusTally: Record<string, number>
  version: number
  updatedAt: Timestamp
}

// One entry appended to project.outcomeLog on every action transaction. The v2
// analogue of a stage-history entry; additive and optional on Project.
export interface OutcomeLogEntry {
  actionId: string
  outcomeId: string
  shape: OutcomeShape
  by: string
  at: Timestamp
  inputs?: Record<string, unknown> | null
}
