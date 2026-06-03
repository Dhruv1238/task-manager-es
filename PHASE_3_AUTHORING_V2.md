# Phase 3 — Authoring v2: Role Hierarchy, Task/Flow Canvas & the Rules Engine

> **Status:** Proposed (not yet implemented). A major reframe of the authoring + onboarding experience, derived from the company "Task Management System – Company Workflow Structure" document and the CEO's flow model. **Absorbs and extends Phases 2c.1 and 2d.** Stays on **Firebase** with the existing per-project-per-tenant model unchanged. The authoring surface is a **rewrite**; the runtime surface is an **evolution**. **No Cloud Functions in this phase** — notifications, scheduled alerts, and auto-allocation are deferred behind disabled "coming soon" controls. Composite indexes and denormalized counters are accepted as the cost of analytics on Firestore.

## Context

This phase reorganizes the whole setup experience around a four-block spine the CEO sketched: **(1) Role definition** (access + approval hierarchy + analytics scope), **(2) Task definition** (the stages, their actions/inputs, and their rules), **(3) Allocation** (mapping roles to tasks/actions, plus deferred auto-allocation), and **(4) UI** (templates, analytics, alerts, comms). A tenant moves through these in order and ends up with a fully configured system.

The platform already has the substrate this builds on: workflows as data with a snapshot-pin guarantee (2a–2c), `actorMatches` + `ActorRef` resolution, `ProjectFieldsConfig` + `statusOptions` + `canUpdateStatusActors` (2c.1), and the project-roles / custom-fields / stage-action-permissions work (2d). Phase 3 keeps that substrate and layers on what the CEO's model needs that doesn't exist yet: a **configurable N-level role hierarchy with inheritance**, a **module × CRUD access matrix**, an **outcome-branching rules engine**, and an **editable canvas flow builder**.

**In scope (v2, enabled):**

1. **Role & hierarchy builder.** N configurable levels (not fixed L1–L8); roles sit at a level; higher levels inherit lower levels' permissions (union down the chain), computed on resolve and cached.
2. **Module access (RBAC).** Per role, per module, the four toggles View / Create / Update / Delete. The concrete module list is filled in later with the code-level agent; the plan ships the mechanism and a placeholder registry.
3. **Tasks / stages with actions + inputs.** The CEO's "Task" is our **Stage**; "Task attributes" are its **actions and their inputs** (`StageAction` + `ActionInput`); "Task description" is stage setup.
4. **The rules engine — outcomes & effects.** Author-named outcomes (predefined set + custom within guardrails), each resolving to one of four **shapes** (advance / branch / hold / close) plus zero-or-more **effects**. v2 enables `set_field` and the transition shapes; all other effects ship disabled ("coming soon"). A minimal `availableWhen` field condition is enabled; richer conditions and computed/calc attributes are coming-soon.
5. **Role ↔ action mapping (allocation).** Which roles may perform each action, with hierarchy inheritance, validated at author time (an action with no mapped role is an invalid node).
6. **Editable canvas flow builder.** React Flow (xyflow): task nodes, author-drawn outcome edges, a node inspector for editing, on-canvas validation, auto-layout, and publish (snapshot-pin). Seeds from a template or blank.
7. **Simple subtasks.** A work item with assignee + status; no recursion.
8. **Gated onboarding spine.** Steps 1 (roles/hierarchy) and 2 (tasks/stages) are mandatory and sequential, then the canvas (3) maps it; afterwards the workspace is freely editable.
9. **Analytics scaffolding.** Denormalized counters maintained inside the action transaction so dashboards can read without `GROUP BY`. The dashboards themselves are a later phase; this phase lays the counters + indexes.
10. **Owner retirement** carried forward from 2d (`createdBy` audit-only; `assignedUserIds` for visibility).

**Out of scope (deferred — shipped as disabled "coming soon" where a control is implied):**

- **Notifications & email** (in-app or transactional) — needs Cloud Functions; deferred entirely.
- **Scheduled alert/reminder engine** (deadline countdowns) — needs a scheduled Function; deferred.
- **Auto-allocation strategies** (round-robin / least-loaded / by-attribute) — UI control present but disabled; manual assignment + role-gating only in v2.
- **`spawn_project` effect** (awarded → execution project) — modeled, disabled.
- **`create_subtask`, `allocate`, `webhook` effects** — modeled, disabled.
- **Recursive subtasks** — simple work items only.
- **Computed/calculated attributes and multi-clause conditions** — engine has the slot; v2 ships only a single-comparison `availableWhen`.
- **Backend migration to Postgres/Supabase** — explicitly rejected for now; Firebase retained.

---

## Relationship to prior phases

- **2c.1 substrate — retained.** `ProjectFieldsConfig`, `statusOptions`, `canUpdateStatusActors`, `actorMatches`, and the `project.status` widening all stay and underpin this phase.
- **2d — absorbed and reframed.** Project roles fold into the new role/hierarchy system; stage-action permissions become the Layer-2 role↔action mapping; custom fields remain (now framed as "inputs" + project fields). The `assignedUserIds` denormalization, soft-delete fields, and owner retirement from 2d all carry forward. **Where Phase 3 and the 2d plan overlap, Phase 3 supersedes** — the coding agent should treat this document as the authority for roles, permissions, and fields, and use the 2d doc only as background for the parts not re-specified here.
- **Net-new in Phase 3:** N-level hierarchy + inheritance, module CRUD RBAC, the outcome-branching rules engine with an extensible effect framework, the React Flow canvas authoring app, the vocabulary remap, simple subtasks, analytics counters, and the gated onboarding spine.

---

## The vocabulary, locked

The CEO's model maps onto the existing schema. **Internal names do not change — no database migration for vocabulary.** The tenant sees the CEO's words; the code keeps `stage`/`workflow`. This is the same stable-id / editable-label split already used for roles and fields.

| CEO / tenant term | Our internal concept | Notes |
| --- | --- | --- |
| Task | `Stage` | A phase with a description, actions, and rules. |
| Subtask | `Subtask` (simple work item) | Assignee + status; no recursion in v2. |
| Task description | `Stage` setup/metadata | Label + description on the stage. |
| Task attributes | `StageAction[]` + `ActionInput[]` | The actions on a stage and the inputs each collects. |
| Task rules | `Outcome[]` on an action | On success / partial / fail / custom → shape + effects. |
| Flow | `Workflow` | The whole task pipeline; now also carries `canvasLayout`. |
| Roles & task mapping | `StageAction.actors` (Layer 2) | Which roles may perform which actions. |
| Allocation rules | (deferred) auto-allocation | Coming-soon. |
| Access | Module × CRUD grid (Layer 1) | Platform RBAC, separate from action mapping. |

---

## Decisions pinned

| Question | Decision |
| --- | --- |
| Backend | **Firebase**, per-project-per-tenant unchanged. Composite indexes + denormalized counters accepted. No Cloud Functions in v2. |
| Vocabulary | Internal `stage`/`workflow` retained; tenant-facing labels follow CEO terms via id/label split. No migration. |
| Two permission systems | **Kept separate.** Layer 1 = module × CRUD (platform RBAC). Layer 2 = role↔action mapping (workflow permission). They govern different operation classes. |
| Hierarchy | N **configurable** levels (not fixed L1–L8). A role sits at one level. **Higher level inherits the union of all lower levels' permissions.** Computed on resolve, cached on the profile. |
| Rule outcomes | **Not fixed.** Predefined set + author-defined, but every outcome must resolve to one **shape**: advance / branch / hold / close. |
| Effects | **Extensible framework.** v2 enables `set_field` + transition shapes (run client-side in the action transaction). `notify` / `create_subtask` / `allocate` / `spawn_project` / `webhook` modeled but disabled ("coming soon"). |
| Conditions | Minimal `availableWhen` single-field comparison enabled. Computed attributes + multi-clause logic deferred. |
| Outcome selection | **Manual** at action time (actor picks the outcome, e.g. Success/Partial/Fail). No auto-evaluating condition engine in v2. |
| Allocation | Role-gating is the must-have; **an action with no mapped role is an invalid node** (author-time validation). Manual assignment supported; auto-allocation deferred (disabled control). |
| Subtasks | Simple work item (assignee + status). No recursion. |
| Canvas | **Editable** React Flow (xyflow), not just visual. Seeds from template or blank. On-canvas validation. Publish = snapshot-pin. |
| Onboarding | Steps 1 (roles/hierarchy) → 2 (tasks/stages) → 3 (canvas) are **mandatory and sequential** on first run; the workspace is freely editable afterward. |
| Owner | **Retired** (carried from 2d). `createdBy` audit-only; `assignedUserIds` for visibility. |
| Idiot-proofing constraint | **Lifted** (per CEO). Optimize for a robust, classy, intuitive authoring product, not lowest-common-denominator simplicity. |

---

## The two permission layers

Two orthogonal axes, governing different operation classes. Collapsing them into one grid would lose the ability to say "can edit tasks in general, but cannot perform Accept at the Decision stage" — the exact distinction Jira keeps between project permission schemes and workflow conditions.

**Layer 1 — Module Access (platform RBAC).** Per role, per module, the four CRUD toggles. Governs coarse capabilities: can this role *create projects*, *delete tasks*, *view reports*, *update settings*. Subject to hierarchy inheritance.

**Layer 2 — Role ↔ Action mapping (workflow permission).** Per stage action, which roles may perform it (`StageAction.actors`). Governs fine workflow operations: can an L5 *Accept* at the Decision stage. Project-scoped, stage-scoped, subject to inheritance, validated at author time.

**How they compose at runtime.** A coarse operation (create/delete a project, view a module) is gated by Layer 1. A workflow action (a stage transition) is gated by Layer 2. Editing a project's data is gated by Layer 1 (`update` on the relevant module) *and* project membership. They rarely overlap; where they do, both must pass.

**Firebase enforcement posture.** Both layers are enforced primarily in `usePermissions` (app code), with Security Rules enforcing what they practically can. A dynamic role × module matrix requires multiple `get()` lookups per rule evaluation (hard-capped at 10, billed as reads, hard to test), so the database is **not** the security boundary for the fine-grained matrix — this is the known Firestore tradeoff implicitly accepted by staying on Firebase. Coarse, stable rules (tenant isolation, project membership via `assignedUserIds`, super-admin) remain in Security Rules.

---

## Role & hierarchy model

```ts
export interface HierarchyLevel {
  level: number          // 1..N; 1 = highest authority
  label: string          // tenant-facing, e.g. 'Vertical Head' or 'L1'
}

export interface ModuleGrant {
  view: boolean; create: boolean; update: boolean; delete: boolean
}

export interface RoleDef {
  id: string             // stable slug, never reused
  label: string          // tenant-facing display name
  level: number          // which HierarchyLevel this role occupies
  moduleGrants: Record<string, ModuleGrant>  // keyed by moduleId (Layer 1)
  description?: string
  order: number
}
```

Stored at `/config/hierarchy` (`{ levels: HierarchyLevel[] }`) and `/config/roles/{roleId}`. Module grants are folded onto the role doc to minimize reads.

**Inheritance.** A role's *effective* permissions = its own `moduleGrants` unioned with the `moduleGrants` of every role at a **lower** level (higher number = lower authority). "Higher level inherits lower levels' permissions." Effective grants are computed once when a user's profile is resolved and cached on `/profiles/{uid}.effectivePermissions` with a `permissionsVersion` stamp; bump the stamp on any role/grant edit to invalidate. The same inheritance applies to Layer 2: a user at level *j* can perform an action mapped to a role at level *k* iff *j ≤ k*.

```ts
// ActorRef gains one kind (alongside existing global_role / creator / team_role /
// pipeline_role / project_role):
| { kind: 'role'; roleId: string }
// actorMatches: true if the viewer's role.level <= referenced role.level (inheritance),
// OR exact role match. Super-admin always passes.
```

---

## Module access model

```ts
export interface ModuleDef {
  id: string             // 'projects' | 'tasks' | 'teams' | ... (final list TBD with code agent)
  label: string
  order: number
}
```

Stored at `/config/modules/{moduleId}`. **The concrete module list is intentionally left open** — it will be filled in with the code-level agent that can map module ids to actual routes/collections. This plan ships the registry + the grid UI + the enforcement map keyed on `moduleId`, with a placeholder set (`projects`, `tasks`, `teams`, `members`, `workflows`, `reports`, `settings`) to be confirmed.

**The grid UI** (block 1a "Access"): rows = roles, columns grouped by module with four CRUD checkboxes each; inherited grants render as checked-but-muted (from a lower level) and can be additively overridden, never removed below the inherited floor. `usePermissions` exposes `can(module, op)` reading the cached effective grants.

---

## The flow: tasks, actions, inputs

The existing `Workflow` becomes the **Flow** and gains a canvas layout. The existing `Stage`/`StageAction` carry the CEO's "task"/"task attributes" semantics.

```ts
export interface CanvasNode { taskId: string; x: number; y: number }
export interface CanvasEdge { id: string; fromTaskId: string; outcomeId: string; toTaskId: string }
export interface CanvasLayout { nodes: CanvasNode[]; edges: CanvasEdge[] }

export interface Workflow {              // = "Flow"
  // ...existing 2a–2d fields retained (projectRoles, projectFields incl. customFields,
  //    statusOptions, canUpdateStatusActors, etc.)
  canvasLayout?: CanvasLayout            // NEW — React Flow positions + edge labels
  entryStageId: string                   // NEW — where new projects start
}

export interface Stage {                 // = "Task"
  id: string
  label: string                          // tenant-facing task name
  description?: string                   // "task description"
  actions: StageAction[]                 // "task attributes"
}
```

`ActionInput` (2c.1) is unchanged — `status_select`, `user_picker` with `pickerScope`, plus the field-typed inputs from 2d. Inputs collected when an action is performed feed `project.fields` or drive an outcome.

---

## The rules engine: outcomes & effects

The single `StageAction.effect` of 2a–2c generalizes into a set of **outcomes**, each a labeled branch. This is the CEO's "task rules — what happens on success, partial, fail."

```ts
export type OutcomeShape = 'advance' | 'branch' | 'hold' | 'close'

export type EffectKind =
  | 'set_field'        // ENABLED in v2 (runs client-side in the action transaction)
  | 'notify'           // coming soon (needs Functions)
  | 'create_subtask'   // coming soon
  | 'allocate'         // coming soon (auto-allocation)
  | 'spawn_project'    // coming soon (awarded → execution)
  | 'webhook'          // coming soon

export interface Effect {
  kind: EffectKind
  enabled: boolean                       // false → rendered as "coming soon", never executed
  params: Record<string, unknown>        // set_field: { fieldId, value } | { fieldId, fromInputId }
}

export interface FieldCondition {        // minimal v2 condition; richer logic = coming soon
  fieldId: string
  op: 'eq' | 'neq' | 'gt' | 'lt' | 'in'
  value: unknown
}

export interface Outcome {               // = one "task rule"
  id: string
  label: string                          // author-named: 'Approved', 'Sent back', 'Partial'
  shape: OutcomeShape
  toStageId?: string                     // required for advance | branch
  terminalStatusId?: string              // required for close → which statusOption
  effects: Effect[]                      // zero or more (v2: set_field only)
}

export interface StageAction {
  id: string
  label: string
  inputs?: ActionInput[]                 // existing
  actors: ActorRef[]                     // Layer-2 mapping; ≥1 required (validated)
  availableWhen?: FieldCondition         // optional, enabled (single comparison)
  outcomes: Outcome[]                    // ≥1 required; replaces single `effect`
}
```

**Guardrail.** Outcomes are named freely but must resolve to one of the four shapes — that bounds the engine while leaving naming open. An action with a single outcome behaves exactly like today's single-effect action; an action with several presents an outcome choice when performed.

**Execution, on Firebase, no Functions.** When an actor performs an action and selects an outcome, a single client-side Firestore **transaction** applies the outcome's shape (set `currentStageId` for advance/branch, no-op for hold, set terminal `status` for close), runs each `enabled` effect (`set_field` writes `project.fields[fieldId]`), appends an `outcomeLog` entry, recomputes `assignedUserIds`, and updates analytics counters. Disabled effects are skipped (they can't be authored as enabled in v2). No effect requires a server round-trip, which is why v2 needs no Functions.

**Back-compat shim.** Existing workflows whose actions carry a single `effect` are read through an adapter that wraps it as `outcomes: [{ shape, toStageId|terminalStatusId, effects: [] }]`, so legacy flows run unchanged.

---

## The canvas (React Flow)

The centerpiece of the authoring rewrite. Build tool: **React Flow (xyflow)** for the node graph + **dagre** for auto-layout, with a custom node renderer matching the design system.

- **Nodes = tasks (stages).** Each node shows the task label, an action count, and a **validation state** — a node renders invalid (red) if any of its actions has no mapped role, or any non-terminal outcome has no target edge.
- **Edges = outcome transitions.** Drawing an edge from a task's outcome handle to another task sets that outcome's `toStageId`; the edge is labeled with the outcome name. `close` outcomes connect to a terminal marker node; `hold` outcomes need no edge.
- **Node inspector (side panel).** Edits the selected task: description; the action list; per action — label, inputs, **allowed roles (Layer-2 mapping)**, `availableWhen`, and **outcomes (the rules)**; per outcome — shape, target, and effects (with disabled effects shown as greyed "coming soon" rows).
- **Palette.** Add task node; terminal/close node; disabled node types reserved for coming-soon features.
- **Auto-layout.** Seeding from a template or restructuring runs dagre, then the author hand-adjusts; positions persist in `canvasLayout`.
- **Seeds.** A new flow starts from a template (existing 2c templates become canvas seeds) or blank.
- **Validation overlay + publish gate.** A flow cannot be published until it validates: an entry task exists, every action has ≥1 mapped role, every non-terminal outcome routes somewhere, no orphan tasks, at least one path reaches a terminal. **Publish snapshots the flow (including `canvasLayout`) onto new projects** — the same snapshot-pin guarantee as 2c, so editing a flow never disturbs in-flight projects.

---

## The onboarding spine

A mandatory, sequential first-run that hands off to an always-editable workspace.

**Step 1 — Roles & Hierarchy (mandatory).** Define the N levels; create roles at levels; (optionally begin the module-access grid). *Gate:* at least one role exists before proceeding.

**Step 2 — Tasks / Stages (mandatory).** Define the task building blocks — description, actions + inputs, and rules (outcomes). *Gate:* at least one task is defined.

**Step 3 — Canvas (mandatory to activate).** Arrange tasks on the canvas, wire outcome transitions, and complete the role↔action mapping. *Gate:* the flow validates → activate.

**After first run — editable workspace (non-gated).** The Access grid refinement, Analytics scope, Templates, and the deferred blocks are all editable at will from a setup hub; the recommended order is suggested but not enforced. The canvas is the persistent authoring home.

---

## Runtime adaptation

The runtime surface evolves rather than rebuilds. Key changes:

- **NewProjectModal** — reads the flow's `projectRoles` (role pickers) and `projectFields` (custom-field inputs), writes `roleAssignments`, `fields`, `createdBy`, `flowId`, `currentStageId = entryStageId`, and the initial `assignedUserIds`. No `ownerId`. (Mostly as specified in the 2d plan.)
- **ProjectDetail** — the stage banner surfaces the current task's available actions, gated by Layer 2 (`actorMatches` against the viewer, with inheritance). Performing an action that has multiple outcomes opens an **outcome picker** (the named outcomes as buttons); single-outcome actions perform directly. Sidebar shows roles + custom fields with inline edit (Layer 1 `update` + membership).
- **Subtasks panel** — a simple list under the project (or current task): title, assignee, status, optional due date.
- **Project list** — dynamic columns + filters from `listColumn`/`filter`-surfaced fields (from 2d), plus status from the flow's `statusOptions`.
- **`assignedUserIds`** — recomputed in every role/team/outcome transaction (carried from 2d); drives visibility and "my projects."

---

## Subtasks (simple)

```ts
export interface Subtask {
  id: string
  title: string
  assigneeId?: string
  status: 'todo' | 'in_progress' | 'done'
  dueDate?: string
  parentStageId?: string                 // which task it sits under, optional
  createdBy: string
  createdAt: Timestamp
}
// stored at /projects/{projectId}/subtasks/{subtaskId}
```

No nested tasks, no per-subtask actions/rules. Recursion is explicitly deferred.

---

## Analytics scaffolding

Firestore has no `GROUP BY`, so dashboards read **denormalized counters** maintained inside the same transaction that performs an action:

- A tenant-level status tally (`/config/analytics.statusTally: { [statusId]: count }`) incremented/decremented on status change.
- Per-project `stageEnteredAt: Record<stageId, Timestamp>` stamped on each transition → enables time-in-stage / funnel reporting without scans.
- Composite indexes for every `filter`-surfaced custom field combined with status/flow (declared in `firestore.indexes.json`, generated from active flows).

The dashboards themselves (block 4 Analytics) are a **later phase**; this phase only lays the counters + indexes so the data is query-ready. Counter maintenance is centralized in the action-transaction helper so it can't drift.

---

## Backend posture (Firebase, no Functions)

- **All v2 effects run client-side** inside the action's Firestore transaction (transition shapes + `set_field`). Atomicity comes from the transaction; no server round-trip.
- **No Cloud Functions** in this phase. Notifications, email, scheduled deadline alerts, and auto-allocation all need Functions and are deferred.
- **Tenancy unchanged** — one Firebase project per client via the existing CLI/alias workflow. No cross-tenant queries needed (analytics is within-tenant).
- **Security Rules** enforce tenant isolation, project membership (`assignedUserIds`), and super-admin. The dynamic role × module matrix is enforced in app code (the Firestore `get()` cap makes full DB-layer enforcement impractical — the accepted Firebase tradeoff).
- **Inheritance cache** — effective permissions computed on profile resolve, cached on the profile with a `permissionsVersion` stamp, invalidated on role/grant edits.

---

## Frontend scope

- **Rewrite (new authoring product):** role & hierarchy builder, module-access grid, task/stage authoring, role↔action mapping, the React Flow canvas + node inspector, validation, the gated onboarding spine.
- **Evolve (not rebuilt):** project list, project detail, task execution (gains the outcome picker), subtasks panel, the dynamic columns/filters. Same screens, adapted to the new schema.

---

## Snapshot-pin

`canvasLayout`, `stages` (with their `actions` and `outcomes`), `projectRoles`, and `projectFields` all snapshot onto the project at creation (`project.pinnedWorkflow`), exactly as 2c established. Editing or restructuring a flow — renaming a task, rewiring an outcome, remapping a role — never alters in-flight projects; they keep running against their pinned snapshot. No new invalidation logic.

---

## Backward compatibility

- Every new field is optional. Legacy workflows (the three system seeds + any tenant-created) keep working: no `canvasLayout` → the canvas auto-lays-out from stages/edges on first open; single `effect` → read through the outcome adapter; no `projectRoles`/`customFields` → empty sections.
- Legacy projects with `ownerId` keep the field and their pinned snapshot; new writes never set it; the 2d backfill computes `assignedUserIds`.
- Existing roles (Phase 1 `global_role` etc.) coexist with the new `RoleDef` hierarchy; `actorMatches` keeps all prior `ActorRef` kinds working and adds `role`.

---

## Touchpoints — files

### New

- `src/types/v2.ts` — `HierarchyLevel`, `RoleDef`, `ModuleGrant`, `ModuleDef`, `Outcome`, `OutcomeShape`, `Effect`, `EffectKind`, `FieldCondition`, `CanvasNode/Edge/Layout`, `Subtask`; `ActorRef` `role` kind; `StageAction.outcomes`; `Workflow.canvasLayout`/`entryStageId`.
- `src/lib/permissions/effectivePermissions.ts` — inheritance union + cache resolve/invalidate.
- `src/lib/rules/executeOutcome.ts` — the client-side outcome transaction (shape + effects + counters + log + `assignedUserIds`).
- `src/lib/rules/outcomeAdapter.ts` — legacy single-`effect` → `outcomes` shim.
- `src/components/authoring/RoleHierarchyBuilder.tsx` — Step 1.
- `src/components/authoring/ModuleAccessGrid.tsx` — block 1a.
- `src/components/authoring/TaskAuthoring/*` — task description, action editor, input editor, outcome (rule) editor.
- `src/components/authoring/canvas/FlowCanvas.tsx` — React Flow host.
- `src/components/authoring/canvas/TaskNode.tsx` — custom node + validation state.
- `src/components/authoring/canvas/NodeInspector.tsx` — side panel.
- `src/components/authoring/canvas/autoLayout.ts` — dagre wrapper.
- `src/lib/flowValidation.ts` — publish gate (entry task, mapped actions, routed outcomes, reachability, no orphans).
- `src/components/onboarding/SpineGate.tsx` — gated 1→2→3 shell + handoff to workspace.
- `src/components/project/OutcomePicker.tsx` — runtime outcome selection.
- `src/components/project/SubtasksPanel.tsx` — simple subtasks.
- `scripts/seedModules.ts`, `scripts/seedHierarchy.ts` — placeholder registries (module list confirmed later with code agent).

### Modified

- `src/lib/workflowEvaluator.ts` — `role` actor kind with level inheritance; `getAvailableActions` reads `outcomes`.
- `src/hooks/usePermissions.ts` — two-layer API: `can(module, op)` (Layer 1) + action gating (Layer 2); read cached effective grants; remove owner checks.
- `src/hooks/useAccessibleProjects.ts` — `assignedUserIds` predicate (from 2d).
- `src/lib/firestore.ts` — `createProject` (flowId, entry stage, no owner), `executeOutcome` wiring, subtask CRUD, counter maintenance, `setProjectRole`/`setProjectField` (from 2d).
- `src/components/admin/NewProjectModal.tsx` — roles + custom-field inputs; entry stage; no owner.
- `src/pages/ProjectDetail.tsx` — outcome picker, roles + fields sidebar, subtasks panel, remove owner row.
- `src/pages/Projects.tsx` / `ProjectsTable` — dynamic columns + filters; flow `statusOptions`.
- Existing 2c wizard/editor — **largely replaced** by the authoring rewrite; retained pieces (template picker, status/field sub-pickers from 2c.1) are mounted inside the new surface.
- `firestore.rules` — membership on `assignedUserIds`, tenant isolation, super-admin; coarse module rules where practical.
- `firestore.indexes.json` — composites for filterable fields × status/flow.

### Removed

- `project.ownerId` write paths and owner-based checks (carried from 2d).
- The standalone 2c 4-step wizard as the *primary* authoring entry (its useful sub-components are absorbed into the new spine + canvas).

---

## Firestore indexes & counters

- Composite indexes generated from each active flow's `filter`-surfaced custom fields paired with `status` / `flowId` / `currentStageId`; `multiSelect` uses `array-contains` composites. Add reactively from console links in dev where exhaustive generation is overkill at current scale.
- Counters maintained transactionally: tenant `statusTally`, per-project `stageEnteredAt`. Centralized in `executeOutcome` so they never drift.

---

## Verification

1. **Hierarchy inheritance.** Define 4 levels; grant L4 `tasks.create`; confirm an L1 user inherits `tasks.create` (effective grants union), and that revoking it from L4 removes it from L1 after a `permissionsVersion` bump.
2. **Module grid.** Toggle `projects.delete` off for a role; confirm the delete affordance disappears for that role's users and Security Rules + app both refuse.
3. **Two-layer separation.** A role with `tasks.update` but not mapped to the Accept action can edit task data but cannot Accept at the Decision stage; a role mapped to Accept but without `projects.create` can Accept but cannot create a project.
4. **Outcome branching.** A "Mark complete" action with outcomes Success (advance → Live), Partial (hold), Fail (close → Lost): performing each routes correctly, `set_field` effects apply, `outcomeLog` records the choice, all in one transaction.
5. **Coming-soon effects.** `notify`/`spawn_project` appear as disabled rows in the rule editor and cannot be enabled or executed.
6. **Action mapping validation.** An action with zero mapped roles renders its task node invalid (red) and blocks publish.
7. **Canvas round-trip.** Build a flow on the canvas, publish, create a project; confirm the pinned snapshot carries `canvasLayout` + stages/outcomes; reopening a legacy flow auto-lays-out and stays editable.
8. **Snapshot isolation.** Rewire an outcome on a published flow; an in-flight project created earlier still follows its pinned routing.
9. **Onboarding gate.** Skipping Step 1 blocks Step 2; an unvalidated flow blocks activation; once valid, the workspace becomes freely editable.
10. **Subtasks.** Add a subtask with an assignee; status transitions; appears under the project; no nested-task affordances exist.
11. **Owner retirement / visibility.** New project has no `ownerId`; `assignedUserIds` resolves visibility and "my projects"; legacy project still visible to its former owner after backfill.
12. **Analytics counters.** Status changes keep `statusTally` correct across concurrent updates; `stageEnteredAt` stamps on each transition.

---

## Risks & mitigations

- **Canvas build cost.** React Flow + custom nodes + inspector + validation + auto-layout is the largest single line item. *Mitigation:* phase it (3.3) after the data model and authoring logic exist; lean on React Flow's built-ins; auto-layout from data rather than hand-placement.
- **Firestore can't enforce the fine matrix.** *Mitigation:* accept app-layer enforcement for the dynamic matrix (the staying-on-Firebase tradeoff); keep coarse, stable rules in Security Rules; centralize permission checks in `usePermissions` so there's one place to audit.
- **Analytics-counter drift.** *Mitigation:* all counter writes inside `executeOutcome`'s transaction; never hand-edited; a periodic reconcile script can recompute tallies from a scan if drift is ever suspected.
- **Inheritance cache staleness.** *Mitigation:* `permissionsVersion` stamp bumped on every role/grant edit; resolve recomputes on mismatch.
- **Scope drift into coming-soon features.** *Mitigation:* the disabled-effect framework makes the v2 boundary explicit in the UI; engine is extensible so enabling later is additive, not a rewrite.
- **Outcome model regressions on legacy flows.** *Mitigation:* the `outcomeAdapter` shim; verification 7–8 cover legacy + snapshot isolation.
- **Authoring rewrite destabilizing runtime.** *Mitigation:* runtime is evolved on the same schema, not rebuilt; the outcome picker and field/role sidebars are the only new runtime surfaces.

---

## Build order

**3.0 — Foundations.** `src/types/v2.ts`; `executeOutcome` + `outcomeAdapter`; `effectivePermissions` resolver + cache; owner-retirement carryover; `actorMatches` `role` kind. Compiles against existing readers via optionals + adapter.

**3.1 — Permissions & hierarchy.** RoleHierarchyBuilder (Step 1); ModuleAccessGrid; `usePermissions` two-layer rewrite; Security Rules; profile cache + version stamp. Verifications 1–3.

**3.2 — Task authoring & rules.** TaskAuthoring components (description, actions, inputs, outcomes); role↔action mapping; `flowValidation`. Verifications 4–6.

**3.3 — The canvas.** FlowCanvas + TaskNode + NodeInspector + autoLayout; validation overlay; publish + snapshot-pin; template seeds. Verifications 7–8.

**3.4 — Runtime adaptation.** NewProjectModal; ProjectDetail + OutcomePicker; SubtasksPanel; dynamic columns/filters; `assignedUserIds`; counter maintenance. Verifications 10–12.

**3.5 — Onboarding spine + analytics scaffolding.** SpineGate (gated 1→2→3 → editable workspace); counters + indexes. Verification 9.

The **canvas (3.3)** is the riskiest and highest-value piece — it's where authors meet the whole model and where a weak UX silently produces invalid flows; lean on `flowValidation` + the on-node validation state. The **foundations (3.0)** are the safest and unblock everything else.

---

## Deferred / coming-soon (explicit)

Modeled in the schema, shipped disabled, enabled in a later phase: **notifications + email** (needs Functions), **scheduled deadline/alert engine** (needs a scheduled Function), **auto-allocation strategies**, **`spawn_project`** (awarded → execution), **`create_subtask` / `allocate` / `webhook` effects**, **recursive subtasks**, **computed/calc attributes + multi-clause conditions**, and the **analytics dashboards** themselves (counters land now, charts later). The backend migration to Postgres/Supabase is explicitly **not** happening in this phase.

---

## What ships after Phase 3

- A tenant configures their **org**: N-level hierarchy, roles at levels, inheritance, and a module × CRUD access grid — the "who and what they can touch" layer.
- A tenant configures their **work**: tasks (stages) with descriptions, actions, inputs, and **branching rules** — what happens on each outcome — authored visually on an **editable canvas**, with role↔action mapping validated on the spot.
- The **runtime** runs those flows: projects move task-to-task by author-defined outcomes, with the right roles gating each action and an outcome picker where work can end multiple ways.
- The whole thing stays on **Firebase** with no new infrastructure, the engine is built **extensible** so notifications, alerts, auto-allocation, and project-spawning switch on later without re-architecture, and **analytics data is query-ready** for the dashboards that follow.
