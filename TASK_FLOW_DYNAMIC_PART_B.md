# Phase 2b — Multi-Workflow Support

## Context

Phase 2a moved a single workflow from code into Firestore. The engine, evaluator, and permission API now drive off `/config/workflows/{workflowId}`, but a tenant can effectively only have one workflow active at a time — `appConfig.pipelineEnabled` toggles between `collab-default` and `basic`, and new projects pin one or the other based on that toggle.

Phase 2b removes the single-workflow constraint. After phase 2b, a tenant can have an arbitrary number of workflow docs active simultaneously. Project creation picks a workflow as part of the form. Heads (leads) are recommended-associated with workflows, so the lead picker suggests sensible defaults. The admin dashboard shows per-workflow funnels as tabs. The `pipelineEnabled` toggle is retired.

Phase 2b ships **no authoring wizard** — operators still seed workflows via the buttons in `/admin/config` (added in 2a, extended here). The wizard is phase 2c. What 2b delivers is the data model, project-creation UX, allocation UX, and admin surfaces required for multiple workflows to coexist coherently.

Phase 2b builds on:

- `admin-config-init` — the `/admin/config` screen, the seed-button pattern.
- Phase 1 — org structure resolver.
- Phase 2a — workflow doc schema, evaluator, generic `ActionModal`, `canPerform` API.

In-scope:

1. Multiple `/config/workflows/{workflowId}` docs coexist; phase 2a's schema stays unchanged.
2. New `/config/workflowRegistry` singleton doc tracking which workflows are *active* for the tenant.
3. Workflow doc gains `recommendedLeads: string[]` for head-workflow association.
4. Project schema: `workflowId` becomes the source of truth (already added in 2a). `pipelineEnabled` retired from `appConfig`.
5. New-project modal: workflow picker step, recommended lead suggestion based on workflow choice.
6. `/admin/config` workflows section: list active workflows, activate/deactivate, manage recommended leads, run seed buttons (now three: `collab-default`, `basic`, `sales-default`).
7. New `sales-default` seed: a 7-stage individual-flow workflow exercising every effect type.
8. Project list (`/projects`) and `/me` inbox: merged across workflows with a workflow badge per row, plus a workflow filter.
9. AdminDashboard: per-workflow funnels rendered as tabs.
10. Stage-history audit: workflow assignment becomes a first-class event type alongside stage transitions.

Out of scope (later phases):

- Workflow authoring wizard — phase 2c.
- Optional/skippable stages with creation-time preconditions — phase 2c.
- Mid-flight workflow change for in-flight projects (data path exists; no dedicated UI) — phase 2c or never.
- Pool / auto allotment — phase 3.
- Strict (required) head-workflow enforcement — out of scope; recommended-only as per Q2.
- Multi-tenant isolation — single-tenant deployment confirmed.

---

## Firestore schema changes

### `/config/workflowRegistry` (new singleton doc)

The list of active workflows for this tenant. Workflows that exist in `/config/workflows` but aren't in the registry are dormant — seeded but not selectable by project creators.

```ts
// add to src/types/workflow.ts
export interface WorkflowRegistry {
  version: number;
  updatedAt: Timestamp;
  updatedBy: string;
  activeWorkflowIds: string[];      // e.g. ['collab-default', 'sales-default']
  defaultWorkflowId: string | null; // pre-selected in the new-project modal; null = no default
}
```

Why a separate doc and not a field on `appConfig`? Two reasons:

- Independent versioning. Workflow activation changes don't invalidate `appConfig` caches (which already include the chat toggle and other phase-1 flags).
- Phase 2c's wizard writes to `workflows/` and `workflowRegistry` together but never to `appConfig`. Clean separation per editor.

Defaults when doc missing: `activeWorkflowIds: ['basic']`, `defaultWorkflowId: 'basic'`. This means a fresh tenant who skips workflow setup still gets a usable system — the basic flow is implicitly always available.

### `/config/workflows/{workflowId}` — schema addition

```ts
export interface Workflow {
  // ... all phase 2a fields unchanged
  recommendedLeads: string[];       // uids; the lead picker in new-project surfaces these first
}
```

Defaults when field missing: `[]` (no recommendations — lead picker shows all admins alphabetically).

### `/config/appConfig` — field retired

`pipelineEnabled: boolean` is removed from the type and stops being read. The migration script clears the field from existing docs (sets to `null`) so old clients don't get confused. New writes never include it.

### `projects/{projectId}` — no schema changes

Phase 2a already added `workflowId`, `currentStageId`, etc. Phase 2b uses them as-is. Existing in-flight projects on staging are recreated as part of 2a's deploy; phase 2b doesn't touch project data shape.

---

## The active vs seeded distinction

Phase 2b distinguishes two concepts that phase 2a conflated:

- **Seeded**: a workflow doc exists at `/config/workflows/{id}`. Created by running a seed button. Not necessarily usable by project creators.
- **Active**: the workflow's id is in `workflowRegistry.activeWorkflowIds`. Listed in the new-project modal's workflow picker, counted in dashboard tabs, included in project-list filters.

This matters because seeding is destructive (overwrites the doc, bumps version) while activation is reversible (a single registry write). An operator can seed `sales-default` to inspect or test the doc without making it available to project creators.

The `/admin/config` workflows section surfaces both: a "Seeds" subsection with the seed buttons, and an "Active workflows" subsection with toggles per workflow.

---

## The new sales-default workflow

Seeded by a new script `scripts/seedSalesWorkflow.ts`. Doc written to `/config/workflows/sales-default`.

```ts
{
  id: 'sales-default',
  displayName: 'Sales Pipeline',
  flowType: 'individual',
  leadRoleName: 'Sales Manager',
  isSystemDefined: true,
  recommendedLeads: [],             // seeded empty; operator assigns
  stages: [
    {
      id: 'new_lead',
      displayName: 'New Lead',
      order: 1,
      isTerminal: false,
      actions: [
        {
          id: 'assign_to_rep',
          label: 'Assign Rep',
          actor: { kind: 'global_role', role: 'super_admin' },
          effect: { kind: 'assign_lead', toStage: 'assigned' },
          inputs: [
            { id: 'leadUid', label: 'Sales Rep', type: 'user_picker',
              required: true, pickerScope: 'global_role:admin' },
          ],
        },
      ],
    },
    {
      id: 'assigned',
      displayName: 'Assigned to Rep',
      order: 2,
      isTerminal: false,
      actions: [
        {
          id: 'start_engagement',
          label: 'Start Engagement',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'transition', toStage: 'engaged' },
          inputs: [],
        },
        {
          id: 'decline',
          label: 'Decline Lead',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'transition_with_counter', toStage: 'unassigned', counter: 'escalation' },
          inputs: [
            { id: 'reason', label: 'Reason for declining', type: 'textarea', required: true },
          ],
        },
      ],
    },
    {
      id: 'unassigned',
      displayName: 'Awaiting Reassignment',
      order: 3,
      isTerminal: false,
      actions: [
        {
          id: 'assign_to_rep',
          label: 'Reassign Rep',
          actor: { kind: 'global_role', role: 'super_admin' },
          effect: { kind: 'assign_lead', toStage: 'assigned' },
          inputs: [
            { id: 'leadUid', label: 'Sales Rep', type: 'user_picker',
              required: true, pickerScope: 'global_role:admin' },
          ],
        },
      ],
    },
    {
      id: 'engaged',
      displayName: 'In Engagement',
      order: 4,
      isTerminal: false,
      actions: [
        {
          id: 'submit_proposal',
          label: 'Submit Proposal',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'transition', toStage: 'proposal_sent' },
          inputs: [],
        },
        {
          id: 'mark_unqualified',
          label: 'Mark Unqualified',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'mark_complete', outcome: 'lost' },
          inputs: [
            { id: 'reason', label: 'Why unqualified', type: 'textarea', required: true },
          ],
        },
      ],
    },
    {
      id: 'proposal_sent',
      displayName: 'Proposal Sent',
      order: 5,
      isTerminal: false,
      actions: [
        {
          id: 'mark_won',
          label: 'Mark Won',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'mark_complete', outcome: 'won' },
          inputs: [],
        },
        {
          id: 'mark_lost',
          label: 'Mark Lost',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'mark_complete', outcome: 'lost' },
          inputs: [
            { id: 'reason', label: 'Reason for loss', type: 'textarea', required: true },
          ],
        },
        {
          id: 'request_revision',
          label: 'Request Revision',
          actor: { kind: 'pipeline_role', role: 'lead' },
          effect: { kind: 'transition_with_counter', toStage: 'engaged', counter: 'iteration' },
          inputs: [
            { id: 'feedback', label: 'Client feedback', type: 'textarea', required: true },
          ],
        },
      ],
    },
    {
      id: 'won',
      displayName: 'Won',
      order: 6,
      isTerminal: true,
      actions: [],
    },
    {
      id: 'lost',
      displayName: 'Lost',
      order: 7,
      isTerminal: true,
      actions: [],
    },
  ],
  version: 1,
  updatedAt: serverTimestamp(),
  updatedBy: '<bootstrap super_admin uid>',
}
```

Coverage check — every `ActionEffect` variant exercised: `transition` (start_engagement), `transition_with_counter` with `escalation` (decline) and `iteration` (request_revision), `assign_lead` (assign_to_rep), `mark_complete` with outcomes `won` and `lost` (mark_won, mark_lost, mark_unqualified). Two distinct loops (decline-reroute, revision). Mixed actor kinds (super_admin and lead). Suitable for stress-testing.

---

## Project creation flow

Currently `NewProjectModal` writes a project with `workflowId` derived from `pipelineEnabled`. After 2b:

### Step 1: Workflow picker

A new first step shown when `workflowRegistry.activeWorkflowIds.length > 1`. When only one workflow is active, the step is skipped and the workflow is auto-pinned.

The picker shows one card per active workflow:

- Title: workflow's `displayName`
- Subtitle: derived from `flowType` ("Multi-team collaborative flow" / "Individual ownership flow" / "Simple status flow")
- Pre-selected: the registry's `defaultWorkflowId` if set, otherwise the first active workflow

Once selected, the rest of the form follows.

### Step 2: Form fields adapt to the workflow

The form fields shown depend on the picked workflow's `flowType`:

- `collaborative` — current tender form (title, deadline, submission/presentation dates, etc.).
- `individual` — minimal form (title, optional deadline). No team-assignment fields.
- `basic` — minimal form (title only).

This is handled inside `NewProjectModal` via a switch on `flowType`. Each flow's field set lives in a small subcomponent (`CollaborativeFields.tsx`, `IndividualFields.tsx`, `BasicFields.tsx`). The fields read what's required from the workflow's first stage — specifically, any input that the first action would need (e.g. `assign_lead` action with a `user_picker` input means the create form shows a lead picker too, so creation can directly call the first stage's first action).

### Step 3: Lead picker with recommendations

When the workflow's first stage has an `assign_lead` action (or the workflow has `recommendedLeads`), the form shows a lead picker. Recommended leads from the workflow appear at the top of the dropdown under a "Recommended" header; other admins follow alphabetically. The recommendation is a soft hint — any admin can be picked.

If the project creator picks a recommended lead, the project is auto-allocated and lands in stage 2 (`assigned` for sales, `allocated` for collab). If they don't pick a lead at all, the project lands in stage 1 awaiting allocation.

---

## `/admin/config` workflows section

Replaces the current Project pipeline section (which housed `pipelineEnabled`).

### Layout

**Section: Workflows**

Subsection 1: **Active workflows** — list of seeded workflows with toggles.

```
[●] collab-default    "Tender"            10 active projects   [⋯]
[●] sales-default     "Sales Pipeline"     3 active projects   [⋯]
[○] basic             "Basic"              0 active projects   [⋯]
```

Each row: active toggle (writes to `workflowRegistry.activeWorkflowIds`), workflow id, display name, count of in-flight (non-terminal) projects on that workflow, kebab menu with:

- "Set as default for new projects" (writes `defaultWorkflowId`)
- "Manage recommended leads" (opens inline editor)
- "View workflow doc" (opens read-only JSON view; useful while 2c isn't shipped)

Deactivating a workflow with active projects shows a confirmation: *"3 projects are currently on this workflow. They'll continue to function — but creators won't be able to start new projects on this workflow. Continue?"* Toggling off doesn't delete the workflow doc or affect existing projects.

Subsection 2: **Manage recommended leads** (modal opened from kebab) — for the selected workflow, a list of admin users with checkboxes. Checked users are in `recommendedLeads`. Save writes the workflow doc.

Subsection 3: **Seed workflows** — three buttons as in the screenshot you showed:

```
[Run] Seed collab-default     "10-stage collaborative flow"
[Run] Seed basic              "3-stage simple status flow"
[Run] Seed sales-default      "7-stage sales pipeline (NEW in 2b)"
```

Idempotent. Each run overwrites the doc, bumps `version`. Activation status is not touched by seeding — re-seeding `collab-default` doesn't deactivate it if it was active.

### What's removed from the section

The `pipelineEnabled` toggle (your Q6 answer). The per-stage toggles were already removed in phase 2a; that's unchanged.

---

## Project list and `/me` inbox — merged with workflow badge

### `/projects`

Same list layout as today. Two additions:

- **Workflow badge** on each card — small pill showing the workflow's `displayName` and a `flowType`-derived color (collaborative = purple, individual = blue, basic = grey).
- **Workflow filter** in the filter bar — multi-select dropdown listing all *active* workflows. Default: all selected (i.e. show everything). When narrowed, the URL gets a `?workflows=` param so filter state survives navigation.

Stage filter behavior changes too. Currently it's a single dropdown of all 10 stages. Now it becomes workflow-aware:

- If exactly one workflow is selected in the workflow filter, show that workflow's stages in the stage filter.
- If multiple workflows are selected, the stage filter is disabled with a tooltip ("Select a single workflow to filter by stage").
- Removing the workflow filter narrowing re-enables the stage filter.

This avoids the awkward "show me all projects in stage 5" question when stage 5 means different things in different workflows.

### `/me`

Same model — merged, with workflow badge per row. The "awaiting your action" computation already runs through the evaluator's `getInvolvedActors`, so multi-workflow is free for the engine. The UI just adds the badge.

---

## AdminDashboard — per-workflow tabs

The dashboard's pipeline funnel section becomes tabbed:

```
[ Tender (collab-default) ] [ Sales Pipeline (sales-default) ] [ Basic ]
─────────────────────────
[funnel chart for collab-default with its 10 stages]
[at-risk-by-deadline panel scoped to collab-default projects]
```

Each tab shows that workflow's funnel + workflow-scoped panels. The funnel adapts to the workflow's stage list — collab-default shows 10 bars, sales-default shows 7, basic shows 2.

Tabs are rendered for every workflow in `workflowRegistry.activeWorkflowIds`. Default selected tab: the one in `defaultWorkflowId`, falling back to the first active.

Cross-workflow panels (member counts, team rosters, anything that's not workflow-scoped) live **above** the tabbed section, in a header strip. The current `AtRiskBySubmission` chart is tender-specific (uses `submissionDate`) — phase 2b keeps it under the collab-default tab only and ships no equivalent for the other workflows in this phase. If sales needs its own at-risk metric, that's a separate piece of work.

---

## Stage history — workflow assignment as an event

`stageHistory` currently records every stage transition. Phase 2b adds two new event types alongside the existing `StageEvent`:

```ts
export type ProjectHistoryEvent =
  | StageEvent                                          // existing
  | WorkflowAssignmentEvent
  | WorkflowChangeEvent;

export interface WorkflowAssignmentEvent {
  kind: 'workflow_assignment';
  workflowId: string;
  assignedAt: Timestamp;
  assignedBy: string;                                   // uid of creator
}

export interface WorkflowChangeEvent {
  kind: 'workflow_change';
  fromWorkflowId: string;
  toWorkflowId: string;
  changedAt: Timestamp;
  changedBy: string;
  reason: string;
}
```

`stageHistory` becomes `projectHistory: ProjectHistoryEvent[]`. The collection field is renamed (existing projects on staging will be recreated; no migration backstop needed).

Workflow change isn't surfaced in 2b's UI — there's no "Change workflow" button anywhere. But the event type exists in the schema so the data path is ready when 2c (or never) decides to expose it.

---

## Touchpoints — files that change

| File | Change |
| --- | --- |
| `src/types/workflow.ts` | Add `WorkflowRegistry`, `WorkflowAssignmentEvent`, `WorkflowChangeEvent`, `ProjectHistoryEvent`. Add `recommendedLeads` to `Workflow`. |
| `src/types/models.ts` | Rename `stageHistory` → `projectHistory` on `Project`. Remove `pipelineEnabled` from `AppConfig`. |
| `src/contexts/AppConfigContext.tsx` | New hooks: `useWorkflowRegistry()`, `useActiveWorkflows()`, `useDefaultWorkflow()`. Removes `usePipelineEnabled()` (no callers after 2b touchpoints land). New cache key: `workflowRegistry:v1`, 24h TTL. |
| `src/lib/workflowEvaluator.ts` | No API changes. `getInvolvedActors` is already workflow-aware. |
| `src/lib/firestore.ts` | `addProject`: reads workflow picker output from the form. Writes `workflowId`, `currentStageId` = first stage of chosen workflow. If the first action of the first stage is fillable from form inputs (e.g. `assign_lead` with a lead picker), the project is created and immediately advanced via `performAction`. |
| `src/hooks/usePermissions.ts` | No API changes; the evaluator is already workflow-aware. |
| `src/components/admin/NewProjectModal.tsx` | New first step: workflow picker (shown when >1 workflow active). Form fields delegate to per-`flowType` subcomponents. |
| `src/components/admin/CollaborativeFields.tsx` (NEW) | Current tender fields (title, dates, etc.). |
| `src/components/admin/IndividualFields.tsx` (NEW) | Minimal fields for sales-style workflows. |
| `src/components/admin/BasicFields.tsx` (NEW) | Title-only fields. |
| `src/components/admin/WorkflowPicker.tsx` (NEW) | The workflow card picker. |
| `src/components/admin/LeadPickerWithRecommendations.tsx` (NEW) | Lead picker that groups recommended leads at the top. |
| `src/pages/AppConfigPage.tsx` | Rewrites Project pipeline section into Workflows section: active workflows list, manage recommended leads modal, three seed buttons. |
| `src/pages/Projects.tsx` | Workflow badge on cards, workflow multi-select filter, stage filter becomes workflow-aware. |
| `src/pages/MyTasks.tsx` (or wherever `/me` lives) | Workflow badge on row. No filter change. |
| `src/pages/AdminDashboard.tsx` | Tabbed funnel section; per-tab funnel and scoped panels. Cross-workflow strip above. |
| `src/pages/ProjectDetail.tsx` | Project history panel renders all `ProjectHistoryEvent` kinds, not just stage events. |
| `src/components/workflow/StageBanner.tsx` | No change — already drives off the workflow doc. |
| `src/components/workflow/ProjectHistory.tsx` | Renamed from `StageHistory.tsx`. Renders all event kinds. |
| `scripts/seedSalesWorkflow.ts` (NEW) | Seeds `sales-default`. |
| `scripts/seedWorkflowRegistry.ts` (NEW) | Seeds the registry with `activeWorkflowIds: ['basic']`, `defaultWorkflowId: 'basic'` for fresh tenants. (Note: existing tenants on staging where `collab-default` was already in use — the seed is idempotent but should preserve any existing activation; the script checks before overwriting.) |
| `scripts/retirePipelineEnabled.ts` (NEW) | One-shot: clears `pipelineEnabled` from `appConfig`. Run after deploy. |

### Files removed

- `src/components/admin/PipelineToggle.tsx` (if it exists as a standalone) — folded into the new Workflows section.

---

## Critical files (new)

- `src/components/admin/WorkflowPicker.tsx`
- `src/components/admin/CollaborativeFields.tsx`
- `src/components/admin/IndividualFields.tsx`
- `src/components/admin/BasicFields.tsx`
- `src/components/admin/LeadPickerWithRecommendations.tsx`
- `scripts/seedSalesWorkflow.ts`
- `scripts/seedWorkflowRegistry.ts`
- `scripts/retirePipelineEnabled.ts`

## Critical files (modified — see touchpoints)

- `src/types/workflow.ts`, `src/types/models.ts`
- `src/contexts/AppConfigContext.tsx`
- `src/lib/firestore.ts`
- `src/components/admin/NewProjectModal.tsx`
- `src/pages/AppConfigPage.tsx`, `src/pages/Projects.tsx`, `src/pages/AdminDashboard.tsx`, `src/pages/MyTasks.tsx`, `src/pages/ProjectDetail.tsx`
- `src/components/workflow/ProjectHistory.tsx` (renamed from `StageHistory.tsx`)

---

## Reused patterns

- **Phase 1 / 2a localStorage cache with 24h TTL** — applied to `workflowRegistry`. Same shape.
- **Seed-button pattern from 2a** — extended with a third button for `sales-default`. Same idempotent behavior.
- **`writeBatch` + audit-event** — workflow activation toggles use the same batch pattern.
- **Recommended-leads UI** — leans on the same chip-based picker primitive used in phase 1's wizard.
- **Tabbed sections** — reuses any existing tab component in the codebase; if none exists, a thin `Tabs.tsx` primitive is added (3-4 lines of CSS, controlled state).

---

## Verification

1. **Fresh state, only basic active**:
   - Wipe `/config/workflows`, `/config/workflowRegistry`. Reload app.
   - `useActiveWorkflows()` returns `[basic]` (the default when registry doc is missing).
   - Create a new project — workflow picker step is skipped (only one active). Project pins `workflowId: 'basic'`, `currentStageId: 'in_progress'`.

2. **Seed all three, activate all three**:
   - Run all three seed buttons. Toggle all three to active in `/admin/config` workflows section.
   - Create a new project — workflow picker step appears with three cards. Pick "Sales Pipeline" → form shows individual fields only. Pick "Tender" → form shows collaborative fields. Pick "Basic" → minimal title-only form.

3. **Recommended leads**:
   - Open kebab menu on sales-default → "Manage recommended leads." Tick two admins. Save.
   - Create a sales project. Lead picker shows the two ticked admins under "Recommended" at the top, all other admins below alphabetically.

4. **Auto-allocation at creation**:
   - In the sales project creation form, pick a lead from the recommended list. Submit.
   - Verify project lands in `currentStageId: 'assigned'` (not `'new_lead'`) — the first stage's `assign_to_rep` action was auto-executed because the form provided the required input.

5. **Full sales happy path**:
   - From `assigned`, the lead clicks Start Engagement → `engaged`.
   - From `engaged`, the lead clicks Submit Proposal → `proposal_sent`.
   - From `proposal_sent`, the lead clicks Mark Won → `status: 'completed'`, terminal stage `won`, `projectHistory` has all transitions.

6. **Sales decline loop**:
   - Assigned project, lead clicks Decline Lead with reason → returns to `unassigned`, `escalationCount` is 1, `projectHistory` records the decline.
   - Super admin reassigns to a different rep → back in `assigned` with new `leadUid`.

7. **Sales revision loop**:
   - From `proposal_sent`, lead clicks Request Revision → returns to `engaged`, `iterationCount` is 1.

8. **Workflow filter + stage filter interaction**:
   - On `/projects`, filter to just collab-default → stage filter dropdown shows the 10 collab stages.
   - Add sales-default to the filter → stage filter becomes disabled with tooltip. Hover the tooltip; it explains why.
   - Remove sales-default → stage filter re-enables.

9. **Dashboard tabs**:
   - With three active workflows, AdminDashboard shows three tabs.
   - Click each — funnel changes shape (10 bars / 7 bars / 2 bars). The at-risk-by-submission panel renders only under the collab-default tab.

10. **Deactivating a workflow with active projects**:
    - Create three projects on collab-default. Open workflows section, toggle collab-default to inactive. See the confirmation modal listing 3 active projects.
    - Confirm. New projects can no longer pin collab-default; the existing three still render correctly and can still be operated on.

11. **`pipelineEnabled` retirement**:
    - Inspect `appConfig` in Firestore after running `retirePipelineEnabled.ts`. Verify the field is `null` or absent.
    - Inspect the codebase — no `usePipelineEnabled` references remain.

12. **Project history with workflow events**:
    - Open a project's history panel. The first event is `workflow_assignment` (workflow pinned at creation). Subsequent events are `StageEvent`s for transitions.

---

## Open questions / decisions

Small enough to decide during implementation; flagging for review.

- **What if the operator deactivates the workflow that's currently `defaultWorkflowId`?** Phase 2b: clear `defaultWorkflowId` and show a banner in the workflows section ("No default workflow set — project creators will pick manually"). Don't auto-pick a new default; the operator decides.
- **What if all workflows are deactivated?** Phase 2b: block via UI ("At least one workflow must be active"). Toggling off the last active workflow shows an inline error and is rejected.
- **Workflow badge color when `flowType` is something new in the future?** Phase 2b ships three colors for the three known `flowType`s. Future flow types get a neutral fallback color until explicitly handled. Not a real concern; flagged for completeness.
- **Should the workflow picker step in NewProjectModal show a card for inactive workflows that are seeded?** No — only active. Inactive workflows are invisible to project creators.
- **Project counts in the active workflows list** — does "active projects" mean "non-terminal" or "not archived"? Phase 2b: non-terminal (i.e. `currentStageId` is not a terminal stage). Archived-but-not-terminal projects don't count.

---

## What ships after phase 2b

- A single tenant can run multiple coexisting workflows. Project creators pick a workflow at creation; the form adapts to the workflow's shape.
- Heads are softly associated with workflows via `recommendedLeads`. Lead pickers surface them first; no enforcement.
- `/admin/config` has a Workflows section that's the precursor to 2c's authoring UI. Seed buttons, activation toggles, recommended-leads management all live here.
- The `pipelineEnabled` toggle is gone. The mental model is now "which workflows are active," not "is the pipeline on."
- AdminDashboard surfaces multiple workflows via tabs. Project list and `/me` are merged with workflow badges and filters.
- The schema, evaluator, and UI all comfortably support N workflows. Phase 2c's job is to let tenants *create* workflows from scratch instead of running operator seed buttons. The data model and most of the admin surface are already there.

Phase 2b is roughly **4-5 weeks** of focused work. The riskiest pieces are the project-list filter interaction logic and the NewProjectModal refactor; the safest is the sales seed script (a copy-paste of the collab seed shape with different content). Recommended build order: types → registry doc + hooks → sales seed → workflows section in `/admin/config` → NewProjectModal refactor → projects list + filters → dashboard tabs → project history rename → retirement script → verification.
