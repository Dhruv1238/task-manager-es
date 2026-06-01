# Phase 2d — Project Roles, Stage-Action Permissions & Custom Fields

> **Status:** Proposed (not yet implemented). Builds on **2c** (workflow authoring + snapshot-pin + unified onboarding) and **2c.1** (workflow-author-controlled `projectFields`, `statusOptions`, `canUpdateStatusActors`, `actorMatches`). This phase delivers the three things a workflow author still can't shape: **who** is on a project (named, per-project roles), **who may act at each stage** (per-action permission pills), and **what arbitrary data** a project captures (custom fields, usable as list columns and filters). It also **retires the project `owner`** in favour of role assignments plus a non-privileged `createdBy`.

## Context

Built on the actual shipped/spec'd state after 2c.1:

- `/workflows/{workflowId}` with snapshot-pin: every project carries `project.pinnedWorkflow: Workflow`. Workflow edits never touch in-flight projects.
- `ProjectFieldsConfig` on the workflow (built-in fields with `enabled`/`required`/`label`), with a documented `customFields?` expansion slot.
- `statusOptions` + `canUpdateStatusActors` on the workflow; `project.status` widened to `string`.
- The evaluator's `actorMatches(actor, profile, project, projectTeams, org, mode)` resolver and `ActorRef` union (`global_role` / `creator` / `team_role` / `pipeline_role`, plus `alsoAllow`).
- `StageAction` with `intent`, `inputs[]` (`ActionInput` incl. `status_select`, `user_picker` with `pickerScope`), and `effect` (`transition` / `transition_with_counter` / `assign_lead` / `clear_lead` / `set_status` / `mark_complete{outcomes[]}`).
- The 2c side-by-side workflow editor and the 4-step authoring wizard (Step 1 picker → 2 name → 3 `projectFields` checklist → 4 statuses + permissions → side editor for stages/actions).
- `usePermissions`, `useAccessibleProjects`, `NewProjectModal`, `ProjectDetail`, project list (`ProjectsTable`), and `ProjectStatusPill` all reading from the pinned workflow.

**In 

1. **Workflow-defined project roles.** A workflow declares the role slots its projects use — author-named (`label`), stable-id'd, single or multiple, required or optional. For this tenant they're "Vertical Head", "Admin Head", "Functional Head"; for another they might be "Accounts Manager"; the platform never hardcodes any of them. Filled per-project at creation against **any** user in the org (no global role registry, no picker filtering).
2. **Stage-action permissions.** Every stage action carries `actors: ActorRef[]` — the set of roles allowed to perform it. A new `project_role` actor kind resolves against the project's role assignments. The author edits this through plain-English pills, never a matrix. **Configuration is limited to stage actions** — see *Out of scope* for what stays fixed.
3. **Custom project fields.** `ProjectFieldsConfig.customFields[]`: arbitrary author-defined fields (`text`, `longText`, `number`, `currency`, `date`, `select`, `multiSelect`, `user`, `email`, `phone`, `url`) with a `surfaces[]` array controlling where each appears — create form, sidebar, list column, and/or filter. Values live in `project.fields`.
4. **Filterable project list.** Fields marked `filter` produce filter controls on `/projects`; fields marked `listColumn` produce columns. Type-aware rendering shared between list and sidebar.
5. **Owner retirement.** `project.ownerId` is no longer written on new projects. `project.createdBy` becomes a pure audit field with no permission meaning. A denormalized `project.assignedUserIds[]` carries visibility and "my projects" queries.

**Out of scope (stays fixed platform behaviour, not author-configurable):**

- **Always-on project operations** — create task, upload document, edit project fields, edit role assignments. Available to any user holding a project role on the project, plus global admins, at any stage. These are deliberately *not* surfaced in the authoring UI; a one-line note in the editor tells authors they're automatic. Rationale: per the co-founder's directive, operators configure *operations* (who acts at which stage), not an access-control panel. Mapping arbitrary operations to arbitrary buttons opens a configuration surface tenants are not equipped to manage. The data model (`actors[]` on every action) already supports promoting any of these to a configured action later with **no migration** — we are choosing not to expose the editing UI now.
- **Per-role / per-field edit permissions** (e.g. "VH can edit POC fields but FH can't", or "only VH may assign AH"). `edit_fields` and role reassignment are blanket capabilities in 2d. The `actors[]` model can express finer gating later; deferred.
- **User-level role positions.** No `user.workflowRoles`. Roles are workflow-scoped and assigned per project. Cross-workflow "who is an AH everywhere" reporting is not supported (see *Risks*).
- **Cross-workflow / cross-vertical analytics.** No `verticalId` anywhere — verticals exist only in the org's vocabulary (decision pinned in design). No vertical-scoped rollups.
- **New field types beyond the day-one set** — rich text, file-attachment fields (task attachments already exist separately), formula/computed fields, project-to-project relations. Deferred until asked.

---

## Decisions pinned

| Question | Decision | Implication |
| --- | --- | --- |
| Are roles fixed (VH/AH/FH) in code? | No. Author-named `label` + stable `id`. | A tenant can call a role "Sexy Boy"; the platform never references role labels in logic. |
| Role scope | Workflow-scoped, assigned per-project. No global registry. | Each workflow configures its own roles. Duplicate-workflow is the relief valve for reuse. |
| Who can be assigned to a role? | Any user in the org. Picker is unfiltered. | No user-level role concept needed. At large scale the picker is noisy; an optional `limitToProjectTeams` flag is the cheap future mitigation. |
| Multiple users per role? | Per-role `multiple: boolean`. | FH is typically `multiple: true`; VH/AH single. Multi-value roles resolve to a *set* in the evaluator. |
| Project owner | **Retired.** `createdBy` stays as audit only. | Resolves the owner-vs-VH confusion. Powers move to role-gated stage actions + the fixed-capability set. Supersedes 2c.1's "Owner always on". |
| What's configurable in the UI? | **Stage actions only** — who can perform each. | Always-on operations (create task, upload doc, edit fields, edit roles) are fixed. Keeps the operator's surface to "who acts when". |
| How is the permission edited? | Inline plain-English pills inside the action sentence. Never a matrix. | The word "permission" never appears. Operators experience it as "who does this part of the work". |
| Custom fields location | `ProjectFieldsConfig.customFields[]` on the workflow. | The documented 2c.1 expansion slot. Values in `project.fields`. Snapshot-pinned. |
| Where a field appears | Per-field `surfaces[]`: createForm / sidebar / listColumn / filter. | A field can be captured but hidden from the list, or be a full citizen everywhere. Configured independently per field. |
| Field deletion | Soft delete (`deprecated: true`). | Hidden on new projects, retained on existing. No hard delete. |
| Field ordering | One shared `order` across create form + sidebar. | Simpler; matches most tools. Independent per-surface order deferred. |
| Field validation | Type-level only on day one (number is numeric, email is email-shaped). | Custom rules (min/max, regex) deferred. |
| "My projects" / visibility query | Denormalized `project.assignedUserIds[]`. | `array-contains` query for "projects I'm on". Maintained on every role/team change. Doubles as the visibility list. |
| Lead concept (`assign_lead`) | Kept as-is, alongside the new general roles. | `lead` is the pre-existing single-role special case; not force-migrated into `projectRoles`. |

---

## Firestore schema changes

### `/workflows/{workflowId}` — additions

```ts
// ---- Custom fields: extends 2c.1's ProjectFieldsConfig (its documented customFields slot) ----

export type CustomFieldType =
  | 'text' | 'longText' | 'number' | 'currency'
  | 'date' | 'select' | 'multiSelect' | 'user' | 'email' | 'phone' | 'url'

export type FieldSurface = 'createForm' | 'sidebar' | 'listColumn' | 'filter'

export interface CustomFieldOption {
  id: string                      // stable slug; what project.fields stores
  label: string
  color?: WorkflowStatusColor     // reuse 2c.1's 8-colour palette for select pills
}

export interface CustomFieldDef {
  id: string                      // stable slug, NEVER reused: 'pocName', 'leadCategory'
  label: string                   // editable display name
  type: CustomFieldType
  required: boolean               // enforced only when 'createForm' is in surfaces
  surfaces: FieldSurface[]        // where this field shows up
  options?: CustomFieldOption[]   // select / multiSelect only
  placeholder?: string
  helpText?: string
  order: number                   // shared create-form + sidebar order
  deprecated?: boolean            // soft delete: hidden on new, retained on old
}

export interface ProjectFieldsConfig {
  // ...existing 2c.1 built-ins unchanged:
  // description?, deadline?, submissionDate?, presentationDate?
  customFields?: CustomFieldDef[]            // NEW in 2d
}

// ---- Project roles ----

export interface ProjectRoleDef {
  id: string                      // stable slug: 'vh' | 'ah' | 'fh' | 'sexy_boy'
  label: string                   // editable display name: 'Vertical Head'
  multiple: boolean               // one user (false) or a list (true)
  required: boolean               // must be filled at creation
  assignedToCreatorOnNew?: boolean// auto-fill this slot with the creator on create
  description?: string            // optional helper text shown under the picker
  order: number
}

// ---- Actor ref: one new kind ----

export type ActorRef =
  // ...existing kinds unchanged:
  // | { kind: 'global_role'; role: 'super_admin' | 'admin' }
  // | { kind: 'creator' }
  // | { kind: 'team_role'; teamRole: ...; scope: ... }
  // | { kind: 'pipeline_role'; ... }
  | { kind: 'project_role'; roleId: string }   // NEW in 2d → resolves to project.roleAssignments[roleId]
  // `alsoAllow` semantics unchanged

export interface Workflow {
  // ...existing 2c / 2c.1 fields unchanged
  projectRoles?: ProjectRoleDef[]              // NEW in 2d
  // projectFields.customFields                // NEW (above)
  // stages[].actions[].actors: ActorRef[]     // now author-edited (see below)
}
```

`StageAction.actors: ActorRef[]` already exists in the 2a schema. What changes in 2d is that it becomes **author-editable** and that `project_role` is a valid entry. No structural change to `StageAction` itself.

### `projects/{projectId}` — additions and removals

```ts
export interface Project {
  // ---- REMOVED on new projects (kept on legacy rows for back-compat) ----
  // ownerId: string

  // ---- Audit only, no permission meaning ----
  createdBy: string
  createdByName?: string

  // ---- NEW in 2d ----
  roleAssignments: Record<string, string | string[]>
  //   { vh: 'uid1', ah: 'uid2', fh: ['uid3','uid4'] }
  //   single-value roles store a string; multiple-value roles store string[]

  fields?: Record<string, unknown>
  //   { pocName: 'Anita', pocEmail: 'a@x.com', leadCategory: 'international', budget: 250000 }
  //   keyed by CustomFieldDef.id; select stores option id; multiSelect stores option id[]; user stores uid

  assignedUserIds: string[]
  //   DENORMALIZED: Object.values(roleAssignments).flat() ∪ (members of attached teams)
  //   drives visibility + "projects I'm on". Recomputed on every role/team mutation.

  // ...existing 2c fields unchanged (pinnedWorkflow carries projectRoles + customFields)
}
```

### Snapshot-pin note

`projectRoles` and `customFields` are part of `pinnedWorkflow`, so they snapshot at creation exactly like stages/actions/statuses do today. Renaming "Admin Head" → "Account Director" on the workflow tomorrow does **not** relabel yesterday's projects; they keep rendering against their pinned snapshot. This is the same guarantee 2c already provides — no new caching or invalidation logic.

---

## Worked example — tender workflow, `decision` stage

Workflow fragment (authored, stored under `/workflows/tender-default`):

```jsonc
{
  "projectRoles": [
    { "id": "vh", "label": "Vertical Head",   "multiple": false, "required": true,  "order": 0,
      "assignedToCreatorOnNew": false },
    { "id": "ah", "label": "Admin Head",      "multiple": false, "required": false, "order": 1 },
    { "id": "fh", "label": "Functional Head", "multiple": true,  "required": false, "order": 2 }
  ],
  "projectFields": {
    "description": { "enabled": true },
    "customFields": [
      { "id": "pocName",      "label": "Lead POC Name",  "type": "text",  "required": true,
        "surfaces": ["createForm", "sidebar"], "order": 0 },
      { "id": "pocEmail",     "label": "Lead POC Email", "type": "email", "required": false,
        "surfaces": ["createForm", "sidebar"], "order": 1 },
      { "id": "leadCategory", "label": "Lead Category",  "type": "select", "required": true,
        "surfaces": ["createForm", "sidebar", "listColumn", "filter"], "order": 2,
        "options": [
          { "id": "international", "label": "International", "color": "blue" },
          { "id": "indian",        "label": "Indian",        "color": "green" }
        ] }
    ]
  },
  "stages": [
    {
      "id": "decision",
      "headline": "Decision",
      "actions": [
        { "id": "accept",  "label": "Accept",            "effect": { "kind": "transition", "to": "live" },
          "actors": [ { "kind": "project_role", "roleId": "vh" }, { "kind": "project_role", "roleId": "ah" } ] },
        { "id": "reject",  "label": "Reject",            "effect": { "kind": "set_status", "status": "lost" },
          "actors": [ { "kind": "project_role", "roleId": "vh" }, { "kind": "project_role", "roleId": "ah" } ] },
        { "id": "escalate","label": "Escalate",          "effect": { "kind": "transition", "to": "triage" },
          "actors": [ { "kind": "project_role", "roleId": "vh" }, { "kind": "project_role", "roleId": "ah" } ] },
        { "id": "tender_review", "label": "Send to Tender Review",
          "effect": { "kind": "transition", "to": "tender_review" },
          "actors": [ { "kind": "project_role", "roleId": "vh" }, { "kind": "project_role", "roleId": "ah" } ] }
      ]
    }
  ]
}
```

A project created on this workflow:

```jsonc
{
  "createdBy": "uid-super-admin",
  "roleAssignments": { "vh": "uid-meera", "ah": "uid-rohit", "fh": [] },
  "fields": { "pocName": "Anita Desai", "pocEmail": "anita@client.com", "leadCategory": "international" },
  "assignedUserIds": ["uid-meera", "uid-rohit"],
  "status": "in_progress",
  "currentStageId": "decision",
  "pinnedWorkflow": { /* full snapshot incl. projectRoles + customFields above */ }
}
```

At the `decision` stage, `getAvailableActions(project, viewer)` returns `[accept, reject, escalate, tender_review]` only if the viewer is Meera (vh), Rohit (ah), or a super-admin. Everyone else at this stage sees a read-only banner.

---

## The evaluator — one new actor kind, one merged lookup

`src/lib/workflowEvaluator.ts`:

```ts
// Inside actorMatches(actor, profile, project, projectTeams, org, mode):
case 'project_role': {
  const assigned = project.roleAssignments?.[actor.roleId]
  if (!assigned) return false
  return Array.isArray(assigned)
    ? assigned.includes(profile.uid)
    : assigned === profile.uid
}
```

Super-admin remains universally allowed (existing baseline). All existing kinds and `alsoAllow` are untouched. `ActorMatchMode` (`'permission' | 'inbox'`) semantics carry over for free — a multi-value `project_role` resolves to the set of assigned uids in inbox mode.

`canPerform(actionId)` and `getAvailableActions()` keep their current shape; the only change is that the action's `actors[]` may now contain `project_role` entries, which the resolver above handles. **No change to effect execution** — the effects this phase touches (`assign_project_role`, below) are additive.

### New effect: `assign_project_role` (used only by reassignment surfaces, not stage transitions)

Role assignment after creation is a **fixed sidebar capability** in 2d (not a configured stage action). It is implemented as a direct write, mirrored as an effect so it can be promoted to a configured action later without a schema change:

```ts
export type ActionEffect =
  // ...existing
  | { kind: 'assign_project_role'; roleId: string }   // reserved; sidebar uses the firestore helper directly in 2d
```

In 2d the sidebar calls `setProjectRole(projectId, roleId, value)` in `src/lib/firestore.ts`, which writes `roleAssignments[roleId]`, recomputes `assignedUserIds`, and stamps an audit event. The `assign_project_role` effect kind is declared now so a future "VH assigns AH as a gated stage action" needs no migration.

---

## Custom-field rendering — write once, reuse everywhere

A single type-driven renderer powers the create form, the sidebar, and list columns, so each field type's display/edit logic exists in exactly one place.

`src/components/fields/` (new):

- **`FieldInput.tsx`** — renders the correct input for a `CustomFieldDef` in the create form / edit context. `text`→text input, `longText`→textarea, `number`/`currency`→numeric with formatting, `date`→date picker, `select`→single-select (reuses the status-pill colour palette), `multiSelect`→chip multi-select, `user`→`UserPicker` (existing), `email`/`phone`/`url`→typed text inputs with format validation.
- **`FieldValue.tsx`** — read-only display of a stored value for sidebar + list cells. `select`→coloured pill, `currency`→right-aligned with symbol, `user`→avatar + name, `date`→tenant-locale format, `url`→link, others→text.
- **`useFieldValidation.ts`** — type-level validation (required-when-on-create-form, numeric, email/url/phone shape). Returns per-field error strings for the create form.

Selecting/storing rules: `select` stores the option `id` (not label, so renames don't orphan values); `multiSelect` stores `string[]` of option ids; `user` stores a `uid`. `FieldValue` resolves option id → label/colour and uid → profile at render time against the pinned workflow + a profiles cache.

---

## The authoring UX (idiot-proof)

Built on the 2c side-by-side editor and the 2c.1 four-step wizard. No matrices, the word "permission" never appears.

### Wizard — Step 3 gains custom fields

2c.1's Step 3 ("What info do you collect?") keeps the built-in toggles (Description / Deadline / Submission / Presentation) and gains a **"+ Add a field"** section below them:

- Clicking reveals an inline form: **label** (text), **type** (dropdown of the day-one types), **required** toggle, and a **"Show on…"** chip-row (`Create form` / `Sidebar` / `List column` / `Filter`) defaulting to `Create form + Sidebar`.
- `select` / `multiSelect` reveal an options editor (add option → name + colour swatch from the 8-colour palette).
- Added fields list with drag-to-reorder (sets `order`) and remove (soft-delete → `deprecated`).
- The field `id` is auto-slugged from the first label and frozen; relabeling later never changes the id.

### Wizard — Step 3b / editor gains project roles

A **"Who's on a project?"** sub-section (in the wizard for blank starts, and always in the editor's Settings drawer):

- **"+ Add a role"** → inline form: **name** (text → slug id), **"More than one person can hold this"** toggle (`multiple`), **"Required when creating a project"** toggle (`required`), optional **"Auto-assign the creator"** toggle (`assignedToCreatorOnNew`).
- Roles list with reorder + remove. Templates pre-populate sensible roles (tender template → Vertical Head, Admin Head, Functional Head).

### The side editor — permission pills inside the action sentence

The stage editor keeps the 2c sentence-template layout. Each stage action reads as plain English with the **who** as clickable pills:

> At the **Decision** stage, **Vertical Head** · **Admin Head** can **Accept** → moves the project to **Live**

- Clicking a role pill (or the **+ who** affordance) opens a small popover: a checklist of *this workflow's project roles* plus the existing actor options surfaced by 2c.1 (team-role leads/members where the org config enables them, "Anyone on an attached team", "Any global admin"; super-admin shown as a locked-on baseline row). Tick = allowed. Each tick writes one `ActorRef` into the action's `actors[]`.
- New actions default to **"Anyone assigned to the project can do this"** (a synthetic default that expands to every defined `project_role`), so authors never face an empty/locked action.

### Live preview earns its keep

A right-rail preview: pick a role from a dropdown ("Viewing as: Admin Head") and the editor shows the **actual buttons** that role would see at the selected stage — `[Accept] [Reject] [Escalate] [Send to Tender Review]`. Ticking/unticking roles updates it live. Abstract permission config becomes concrete buttons.

### The "where's task creation?" note

Because create-task / upload-doc / edit-fields / edit-roles are fixed and never appear in the action palette, the editor shows a one-line muted note under the stage actions: *"Creating tasks, uploading documents, and editing project info are always available to anyone on the project — you don't need to configure them here."* Pre-empts the inevitable hunt.

### Validation (extends 2c's validator)

- Every stage needs ≥ 1 action whose effect moves the project forward (transition/terminal) — else projects get stuck. (existing)
- **NEW:** every action needs ≥ 1 entry in `actors[]` — else nobody can perform it. Inline warning on the action card; blocks Save & Activate.
- **NEW:** every `required` project role must be collectable — trivially true since the create form always renders required roles; the check guards against a required role with no picker (e.g. a role referenced by an action but deleted). Surfaced as a stage-card-level warning, consistent with 2c.

---

## Reader-side changes

### NewProjectModal — roles + custom fields at creation

`src/components/admin/NewProjectModal.tsx`:

- After the built-in fields (2c.1), render a **Roles** section: one picker per `pinnedWorkflow.projectRoles` (single → `UserPicker`, multiple → multi `UserPicker`). Required roles block submit when empty; optional roles show a "Skip for now" hint. Honour `assignedToCreatorOnNew` by pre-filling the creator.
- Render a **Details** section: one `FieldInput` per `customFields` entry with `'createForm'` in `surfaces` and not `deprecated`, ordered by `order`. Run `useFieldValidation` on submit.
- On create, write `roleAssignments`, `fields`, `createdBy` (current uid), and compute `assignedUserIds`. **Do not write `ownerId`.**
- The existing `flowType` / built-in-field fallbacks from 2c.1 stay for legacy workflows.

### ProjectDetail — sidebar roles + fields, inline edit

`src/pages/ProjectDetail.tsx`:

- **Roles** sidebar section: list each role with its assigned user(s); inline edit via `UserPicker` for users who hold the fixed edit capability (admin OR any current role-holder). Calls `setProjectRole`. This is how the doc's "Vertical Head assigns Admin Head" is satisfied in 2d (blanket capability; finer gating deferred).
- **Details** sidebar section: render `FieldValue` for each `customFields` entry with `'sidebar'` in `surfaces` (or where the project has a value, for back-compat). Inline edit gated by the same blanket `edit_fields` capability.
- The 2c.1 derived rows (Lead, Submission/Presentation/Deadline) are unchanged.
- Remove any "Owner" sidebar row; replace with the Roles section. Show `createdBy` only as a muted "Created by … on …" line in the header/meta, with no actions attached.

### Project list — columns + filters

`src/pages/Projects.tsx` / `ProjectsTable`:

- **Columns:** defaults (title, status, due date, lead) plus one column per `customFields` entry with `'listColumn'` in `surfaces`, rendered via `FieldValue`. Columns derive from each project's pinned workflow; for a mixed list, union the columns and render blank cells where a project's workflow lacks the field.
- **Filters:** a filter bar with one control per `customFields` entry with `'filter'` in `surfaces`. `select`/`multiSelect`→option chips; `date`→range; `number`/`currency`→min/max; `user`→user picker; text-like→contains. Filters compose with the existing workflow/status filters.
- Query: `select` filter → `where('fields.<id>', '==', optionId)`; `multiSelect` → `array-contains`; combined with status/workflow filters needs composite indexes (below).

### useAccessibleProjects — generalize past owner

`src/hooks/useAccessibleProjects.ts`:

```ts
// was: admin OR project.ownerId === uid OR team-assigned
// now: admin OR project.assignedUserIds.includes(uid) OR team-assigned
```

`assignedUserIds` already unions role-holders and team members, so this is one predicate swap. Visibility (doc §6: "only members added can view") is enforced by the same array.

### usePermissions — fixed-capability helpers + owner removal

`src/hooks/usePermissions.ts`:

- Add `canEditProjectMeta` = `isAdmin || project.assignedUserIds.includes(uid)` — gates sidebar field edit, role reassignment, create-task, upload-doc.
- 2c.1's `canUpdateStatusByFlow` keeps working; its actor checklist gains the workflow's `projectRoles` as options (each maps to a `project_role` `ActorRef`). **The "Owner" checkbox/`ActorRef` is removed** from the 2c.1 status-permission picker; existing workflows that stored an owner-based `canUpdateStatusActors` entry fall back gracefully (an owner actor against a project with no `ownerId` simply never matches; super-admin + admin still pass).
- Remove any remaining `project.ownerId === uid` checks; route them through `canEditProjectMeta` or the relevant `project_role`.

### firestore.ts — helpers

`src/lib/firestore.ts`:

- `createProject(...)` writes `roleAssignments`, `fields`, `createdBy`, `assignedUserIds`; stops writing `ownerId`.
- `setProjectRole(projectId, roleId, value)` — writes the slot, recomputes `assignedUserIds`, appends a `stageHistory`/audit event (`{ type: 'role_assigned', roleId, value, by, at }`).
- `setProjectField(projectId, fieldId, value)` — writes `fields[fieldId]`, validates type server-adjacent (trust-based, frontend-enforced as elsewhere in the MVP).
- `assignTeams(...)` / team mutations — already exist; extend to recompute `assignedUserIds` so it stays honest when team membership changes.

---

## `assignedUserIds` — keeping it honest

It must be recomputed wherever its inputs change:

1. **Project create** — from initial `roleAssignments` + attached teams.
2. **Role assignment / reassignment** — `setProjectRole`.
3. **Team attached / detached** — `assignTeams`.
4. **A user joins/leaves a team that's attached to live projects** — the riskiest edge. v1 approach: recompute lazily on project read for the editing user is *not* enough for queries. Pragmatic v1: when team membership changes, the team-management code already touches each affected project's team list; piggyback an `assignedUserIds` recompute there. Document that a user removed from a team mid-project loses list-visibility on next recompute, which is the intended behaviour.

Formula: `assignedUserIds = unique([ ...Object.values(roleAssignments).flat(), ...membersOfAttachedTeams ])`. Always derived, never hand-edited.

---

## Backward compatibility

- Every new workflow field (`projectRoles`, `projectFields.customFields`) is optional. Workflows authored before 2d (the three system seeds + tenant-created ones) keep working: no roles → the create-form Roles section is empty; no custom fields → no extra inputs/columns/filters.
- **Legacy projects with `ownerId`:** the field stays on the row, their pinned snapshot still references "owner" wherever it did, and they keep working through closure. New writes never set it. `useAccessibleProjects` swap is safe because legacy projects need `assignedUserIds` too — see migration note.
- **One-time backfill (no schema migration, additive):** a script computes `assignedUserIds` for existing projects from `ownerId` (if present) + current `roleAssignments` (absent on legacy → just owner) + attached team members. Run once per environment. Legacy projects whose only "member" was the owner get `assignedUserIds: [ownerId]`, preserving visibility.
- Seed files updated to declare `projectRoles` + a couple of `customFields` defaults that match each template's character (tender → VH/AH/FH + Lead POC + Lead Category; basic → no roles, no custom fields; collab/sales → their existing leads expressed as roles only if desired, else left on the `assign_lead` path).
- `project_role` in `actors[]` is additive; existing `actorMatches` calls are unchanged for non-`project_role` entries.

---

## Touchpoints — files that change

### New

- `src/components/fields/FieldInput.tsx` — type-driven field input.
- `src/components/fields/FieldValue.tsx` — type-driven read-only render (sidebar + list).
- `src/components/fields/useFieldValidation.ts` — type-level validation.
- `src/components/workflow/editor/CustomFieldsEditor.tsx` — wizard Step 3 "+ Add a field" + options editor.
- `src/components/workflow/editor/ProjectRolesEditor.tsx` — roles add/reorder/remove (wizard + Settings drawer).
- `src/components/workflow/editor/ActionActorsPopover.tsx` — the role-pill checklist on each action.
- `src/components/workflow/editor/ActionPreviewRail.tsx` — "Viewing as <role>" live button preview.
- `src/components/project/ProjectRolesSection.tsx` — sidebar roles list + inline edit.
- `src/components/project/ProjectFieldsSection.tsx` — sidebar custom-fields list + inline edit.
- `src/components/project/ProjectFilterBar.tsx` — list filters from `filter`-surfaced fields.
- `scripts/backfillAssignedUserIds.ts` — one-time, per environment.

### Modified

- `src/types/models.ts` — `CustomFieldDef`, `CustomFieldOption`, `FieldSurface`, `ProjectRoleDef`, `ProjectFieldsConfig.customFields`, `ActorRef` `project_role`, `ActionEffect` `assign_project_role`, `Project` (`roleAssignments`, `fields`, `assignedUserIds`, drop `ownerId` from the write path).
- `src/lib/workflowEvaluator.ts` — `project_role` case in `actorMatches`; default-actor expansion for new actions.
- `src/lib/workflowValidation.ts` — "every action needs ≥1 actor"; required-role-collectable check.
- `src/lib/firestore.ts` — `createProject`, `setProjectRole`, `setProjectField`, `assignTeams` recompute.
- `src/hooks/usePermissions.ts` — `canEditProjectMeta`; remove owner checks; add project roles to status-permission picker; drop owner actor.
- `src/hooks/useAccessibleProjects.ts` — `assignedUserIds` predicate.
- `src/components/admin/NewProjectModal.tsx` — Roles + Details sections; stop writing `ownerId`.
- `src/pages/ProjectDetail.tsx` — Roles + Details sidebar; remove Owner row; `createdBy` meta line.
- `src/pages/Projects.tsx` / `ProjectsTable` — dynamic columns + filter bar.
- `src/components/workflow/editor/*` (2c side editor + wizard) — mount the new editors; the "task creation is automatic" note; permission pills in the action sentence.
- `src/components/workflow/UpdateProjectStatusModal.tsx` — unaffected logically, but its actor list source now includes project roles.
- Seed files (`scripts/seed*Workflow.ts`) — declare `projectRoles` + default `customFields`.
- `firestore.indexes.json` — composite indexes for filterable fields (below).
- `firestore.rules` — project read rule keyed on `assignedUserIds` (+ admin + super-admin); writes to `roleAssignments`/`fields` allowed for assigned users (trust-based, matching MVP posture).

### Removed

- Any `project.ownerId` write paths and owner-based permission checks. The type field is retained (read-only, legacy) but excluded from new writes.
- 2c.1's "The project's Owner" checkbox in the status-permission picker.

---

## Firestore composite indexes

Map fields index natively, but combined filters need composites. Approach:

- A small build step walks every active workflow's `customFields`, collects entries with `'filter'` in `surfaces`, and emits index entries for the common pairs: `(fields.<id>, status)`, `(fields.<id>, currentStageId)`, and `(fields.<id>, pinnedWorkflow.workflowId)` where applicable. `multiSelect` uses `array-contains` composites.
- At early scale (hundreds–low thousands of projects per workflow) you can ship without exhaustive composites — Firestore auto-creates single-field indexes and surfaces a console link for any missing composite on first query in dev; add reactively. Flagged because this is the one spot where the pattern is more painful on Firestore than on a relational store.

---

## Verification

1. **Role authoring round-trip.** In a blank workflow, add roles "Vertical Head" (single, required), "Admin Head" (single, optional), "Functional Head" (multiple). Save & Activate. Confirm the pinned snapshot on a new project carries all three.
2. **Per-stage permission gating.** On the `decision` stage, tick only VH + AH for Accept. Create a project, assign Meera (VH) and Rohit (FH). Sign in as Meera → sees `[Accept]`. As Rohit (FH) → does not. As super-admin → does. As an unrelated user → read-only.
3. **Default actor.** Add a new action without touching actors. Confirm every assigned role can perform it (the "anyone assigned" default) and validation passes.
4. **Empty-actor block.** Untick every role on an action → inline warning, Save & Activate blocked.
5. **Custom-field capture.** Define POC Name (text, required, createForm+sidebar), Lead Category (select International/Indian, all surfaces). Create a project: required POC blocks empty submit; values persist; sidebar shows them; list shows the Lead Category column; filter by "International" returns the right set.
6. **Field rename safety.** Relabel "Lead Category" → "Region" on the workflow. Existing project still renders (pinned snapshot keeps old label); a newly created project shows "Region". Stored option ids unaffected.
7. **Soft delete.** Mark a field deprecated. New create form hides it; an existing project that had a value still displays it (greyed).
8. **Owner retirement.** New project has no `ownerId`; `createdBy` set; `assignedUserIds` = role-holders ∪ team members. `/projects` visibility and `/me` "projects I'm on" both resolve via `assignedUserIds`.
9. **Reassignment.** As an assigned VH, change the AH in the sidebar → `roleAssignments.ah` updates, `assignedUserIds` recomputes (old AH drops if not otherwise present, new AH appears), audit event appended.
10. **Legacy regression.** A pre-2d project (with `ownerId`, no `roleAssignments`) after backfill: owner still sees it, status pill still works, no console errors. The three system seeds render unchanged when re-seeded.
11. **Multi-value role in evaluator.** With two FHs assigned and an action allowing FH, both FHs can perform it; removing one revokes only that user.
12. **Filter composability.** Filter `leadCategory = International` AND `status = In Progress` together → correct results (add the composite index when the console prompts).

---

## Risks & mitigations

- **Unfiltered user picker noise at scale.** Hundreds of users in every role picker. *Mitigation:* searchable picker (exists); optional `limitToProjectTeams` flag per role is a cheap future add. Not built now.
- **`assignedUserIds` drift.** If a recompute site is missed, visibility/queries go stale. *Mitigation:* funnel all role/team writes through the three `firestore.ts` helpers; never hand-edit the array; backfill script is idempotent and re-runnable.
- **No cross-workflow role reporting.** "Anita's leadership load across all workflows" is unanswerable (roles are workflow-scoped, no `verticalId`). *Mitigation:* accepted trade (design decision). Day-to-day queries run on `assignedUserIds` / task ownership. A generic `capabilities: ['leadership']` tag on roles is a future option if reporting demands it.
- **Composite index gaps surface as runtime query errors.** *Mitigation:* generate indexes for filterable fields at build; add reactively from console links in dev before prod.
- **Operator confusion over fixed vs configured operations.** *Mitigation:* the editor note; "anyone assigned" default; live preview shows real buttons.
- **Owner-retirement regressions in untouched code paths.** *Mitigation:* grep audit for `ownerId` and `\.owner`; route survivors through `canEditProjectMeta` or a `project_role`; backfill guarantees `assignedUserIds` exists everywhere before the `useAccessibleProjects` swap ships.
- **Self-destructive role config (e.g. one role given the terminal action and then unassigned).** *Mitigation:* snapshot-pin limits blast radius to projects created after the bad save; recovery is "edit the workflow"; validation catches empty-actor and stuck-stage cases.

---

## Implementation order

1. **Types** (`models.ts`) — fields, roles, `project_role` actor, project additions. Compiles against existing readers via optionals.
2. **Evaluator** — `project_role` case + default-actor expansion. Unit-test `actorMatches` with single + multi-value roles.
3. **firestore.ts helpers** — `createProject` (drop owner, write new fields), `setProjectRole`, `setProjectField`, team recompute; `assignedUserIds` formula in one place.
4. **Backfill script** + run in dev. Then flip `useAccessibleProjects` to `assignedUserIds`.
5. **Field renderers** (`FieldInput` / `FieldValue` / `useFieldValidation`) — the reused core; unit-test each type.
6. **NewProjectModal** — Roles + Details sections; stop writing owner. End-to-end create test (verification 5, 8).
7. **ProjectDetail** — Roles + Details sidebar, inline edit, remove Owner row.
8. **Project list** — dynamic columns, then filter bar; add composites as prompted.
9. **Authoring editors** — `ProjectRolesEditor`, `CustomFieldsEditor`, then `ActionActorsPopover` + the action-sentence pills, then `ActionPreviewRail`. Wizard Step 3 wiring + Settings-drawer mounts + the "automatic operations" note.
10. **Validation** — empty-actor + required-role checks into `workflowValidation.ts`.
11. **usePermissions** — `canEditProjectMeta`; remove owner; add roles to status picker; drop owner actor.
12. **Seeds + rules + indexes** — declare roles/fields on seeds, project read rule on `assignedUserIds`, generated composites.
13. **Full verification pass** (1–12) incl. legacy regression and re-seed.

The riskiest piece is the **action-sentence permission pills + live preview** — it's where authors meet the actor model, and the place a bad UX silently produces unperformable or stuck stages; lean on the validation guards and the preview. The safest is the **field renderers** — self-contained, type-driven, no new patterns.

Rough envelope: **~2.5–3 weeks** of focused work on top of 2c.1.

---

## What ships after Phase 2d

- A workflow author shapes the *people* on a project: named role slots ("Vertical Head", "Admin Head", "Functional Head", or anything they like), single or multi-holder, required or optional, assignable to any user — with zero code and zero platform-level role vocabulary.
- A workflow author shapes *who acts at each stage* through plain-English pills, never a permission matrix — honouring the directive that operators configure operations, not access control.
- A workflow author shapes *what data* a project captures: arbitrary typed fields, each independently placed on the create form, sidebar, list, and/or filter bar. The "International vs Indian" lead split, POC contact details, budgets, regions — all configuration, not code.
- The project list becomes per-workflow column- and filter-configurable, driven entirely by the captured fields.
- The owner-vs-heads confusion is gone: `createdBy` is audit, roles are structure, `assignedUserIds` carries visibility and "my projects".
- The data model already supports the next layer — finer per-role/per-field permissions and promoting fixed operations to configured actions — with **no migration**, so the deferred perm-editing work is purely additive when a tenant asks for it.
