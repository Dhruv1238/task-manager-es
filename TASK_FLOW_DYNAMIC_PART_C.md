# Phase 2c — Workflow Authoring & Unified Setup

## Context

Phase 2a moved workflows from code into Firestore. Phase 2b made multiple workflows coexist within a tenant, with operator-driven activation and seed buttons. Phase 2c is the final piece of the workflow platform — **tenants author their own workflows through a UI** instead of relying on operator-run seed scripts.

Phase 2c also unifies the entry experience. Today, fresh tenants run the phase 1 org-structure wizard, then are dropped into `/admin/config` to figure out how to seed workflows. In 2c, the org wizard flows directly into a workflow wizard. By the time a fresh tenant lands on the home screen, they've configured their org *and* at least one workflow.

Built on the actual shipped state:

- `/workflows/{workflowId}` collection with `/workflows/_registry` singleton from 2b.
- Per-workflow localStorage cache (`workflow:{id}:v1`, 24h TTL, cross-tab sync).
- Rich evaluator schema from 2a: `ActorRef` with `team_role`/`pipeline_role`/`creator`/`global_role` kinds plus `alsoAllow`; `ActionEffect` with `transition`/`transition_with_counter`/`assign_lead`/`clear_lead`/`set_status`/`mark_complete{outcomes[]}`; `Stage` with `headline`/`hint`/`shortDisplayName`; `StageAction` with `intent`; `ActionInput.type` including `status_select` and `user_picker` with `pickerScope`.
- `WorkflowValidationError` already exported.
- `ActorMatchMode: 'permission' | 'inbox'` — fallback chain semantics.
- Three seeded workflows: `basic`, `collab-default`, `sales-default`.
- Phase 1 org-structure wizard at `/admin/setup` with `setupCompleted` flag.

In-scope:

1. **Project-pinned workflow snapshots.** Refactor every workflow read from `useWorkflow(project.workflowId)` to read from `project.pinnedWorkflow`. Workflow docs are only fetched for new project creation. Eliminates the "edit-affects-running-projects" problem entirely.
2. **Project schema additions:** `pinnedWorkflow: Workflow`, `description: string` (for the redefined Simple Project flow).
3. **Workflow doc additions:** `description`, `creationModalDescription`, `creationModalCardSubtitle`. Optional fields that let the wizard collect copy for the picker and creation modal.
4. **Workflow authoring wizard** at `/admin/workflows/new`:
   - 4-card template picker (Start blank pre-selected; Simple Project / Collaborative Project / Sales Pipeline templates).
   - Conversational skeleton flow for blank starts (workflow name + flow type + stage list).
   - Side-by-side stage editor (horizontal flow + details panel).
   - Sentence-template action editor.
   - Inline validation surfacing `WorkflowValidationError`.
5. **Standalone workflow editor** at `/admin/workflows/{id}/edit`:
   - Same side-by-side editor as the wizard's tail end, but loaded with an existing workflow.
   - Reachable from `/admin/config` Workflows section via pencil icons next to each workflow.
6. **Unified onboarding flow.** When `orgStructure.setupCompleted === false` OR `workflowRegistry.activeWorkflowIds === []`, auto-launch the unified wizard. Phase 1's wizard runs first if its half isn't done, then transitions into the workflow wizard.
7. **Redefined Simple Project (basic) template.** Creation form gets a Description field. Project schema gets a `description: string`. The workflow itself stays at 2 stages.
8. **Templated workflow card names** in user-facing UI: "Simple Project" / "Collaborative Project" / "Sales Pipeline". Internal IDs unchanged.
9. **Workflow registry section in `/admin/config` updated.** "Seed" buttons replaced by "Create new workflow" CTAs that launch the authoring wizard. Pencil icons next to each workflow open the standalone editor. Existing activation toggles + recommended-leads management stay.

Out of scope:

- Optional/skippable stages — explicitly dropped per the option-B decision. Workflows that vary per project = new workflow.
- AI assistance in the authoring wizard — deterministic UX in 2c; AI can be layered later.
- Mid-flight workflow change UI — schema is there from 2b, no UI in 2c.
- Pool / auto allotment — phase 3.
- Telemetry hooks for the intelligence layer.

---

## Decisions pinned

| Question | Decision | Implication |
| --- | --- | --- |
| Workflow versioning | Snapshot pin into project doc at creation | Project doc gets `pinnedWorkflow`. Workflow edits never affect in-flight projects. Eager-load fanout shrinks; only active workflows loaded. |
| Authoring paradigm | Conversational skeleton (blank) OR side-by-side editor (templates), both ending in side-by-side | Side-by-side is the authoritative editing surface. Wizard is the soft on-ramp for blank starts. |
| Template card naming | "Simple Project" / "Collaborative Project" / "Sales Pipeline" | Internal workflow IDs (`basic`, `collab-default`, `sales-default`) unchanged. Card names are generic; tenant-set `displayName` is what shows on the actual workflows. |
| Onboarding trigger | `orgStructure.setupCompleted === false` OR `activeWorkflowIds === []` | Both halves of unified wizard auto-launch when missing. If one half is done, only the other runs. |
| Basic flow update | Creation form gets Description; workflow definition stays 2-stage | Project schema gets `description: string`; `BasicFields` adds the textarea. |
| Optional stages | Dropped | If a workflow needs variation per project, tenant authors a second workflow. |

---

## Firestore schema changes

### `projects/{projectId}` — additions

```ts
export interface Project {
  // ... existing fields from 2a/2b unchanged

  // NEW: snapshot of the workflow this project was created on.
  // Set once at creation, never updated. All readers use this instead of
  // fetching /workflows/{workflowId}.
  pinnedWorkflow: Workflow;

  // NEW: free-text description, used by Simple Project flow primarily.
  // Available on all flow types but only required/surfaced for basic.
  description: string;
}
```

`workflowId` stays as a denormalized convenience (Firestore queries, badge color lookups), but the **authoritative source for stage/action/role information is `pinnedWorkflow`**.

### `/workflows/{workflowId}` — additions

```ts
export interface Workflow {
  // ... existing fields from 2a/2b unchanged

  // NEW: optional copy for the picker card subtitle.
  // When missing, falls back to derived "Collaborative flow • 8 stages".
  creationModalCardSubtitle?: string;

  // NEW: optional copy under the modal title in NewProjectModal.
  // When missing, falls back to flowType default copy.
  creationModalDescription?: string;

  // NEW: optional longer description shown in the wizard's first step.
  description?: string;
}
```

All three are optional and have sensible derived defaults — workflows authored before 2c continue to render correctly.

### Workflow registry — no changes

The `/workflows/_registry` doc shape from 2b stays untouched.

---

## The redefined Simple Project (basic) template

The `basic` workflow definition stays minimal (`in_progress` → `completed`), but its creation experience expands.

**Creation form fields for Simple Project:**

- Title (required) — existing
- **Description (required, NEW)** — multi-line textarea, ~200 char target
- Attachments (optional) — existing in NewProjectModal, surfaced for basic
- Owner (required, defaults to creator) — existing pattern

**Workflow content seeded:**

```ts
{
  id: 'basic',
  displayName: 'Simple Project',
  flowType: 'basic',
  leadRoleName: 'Owner',
  description: 'Track work with a title, description, and a small team. Add tasks and mark complete when done.',
  creationModalCardSubtitle: 'Simple status flow',
  creationModalDescription: 'Tracked by status. Add tasks and team members after it\'s created.',
  isSystemDefined: true,
  recommendedLeads: [],
  stages: [
    {
      id: 'in_progress',
      displayName: 'In Progress',
      order: 1,
      isTerminal: false,
      actions: [
        {
          id: 'mark_complete',
          label: 'Mark Complete',
          actor: { kind: 'creator', alsoAllow: [{ kind: 'pipeline_role', role: 'lead' }] },
          effect: { kind: 'mark_complete', outcomes: ['completed'] },
          inputs: [],
        },
      ],
    },
    { id: 'completed', displayName: 'Completed', order: 2, isTerminal: true, actions: [] },
  ],
  version: 2,
  // ...
}
```

The team-adding mechanic and task-creation are existing project features that work on every project regardless of workflow — no changes needed there.

`seedBasicWorkflow.ts` updates to write this new shape. Idempotent re-seed bumps to `version: 2`.

---

## The authoring experience — overview

Two paths into the editor, one editor at the destination.

```
                  ┌─ Start blank ──→ Conversational skeleton ──┐
   /admin/        │   (pre-selected)    (3 quick screens)        │
   workflows/new ─┤                                              ├─→ Side-by-side editor
                  │                                              │
                  └─ Pick template ─────────────────────────────┘
                      (Simple / Collab / Sales)
```

The side-by-side editor is the authoritative editing surface. The conversational skeleton is a soft on-ramp for users who don't have a clear shape in mind. Templates skip the on-ramp because they already have a shape.

Standalone editing (existing workflows) skips both entries and goes straight to the side-by-side editor at `/admin/workflows/{id}/edit`.

---

## Entry: the template picker

Route: `/admin/workflows/new`. Gated to super_admin.

Four cards in a 2×2 grid:

```
┌──────────────────────┐  ┌──────────────────────┐
│ ● Start blank        │  │ ○ Simple Project     │
│   (recommended)      │  │   Simple status flow │
│   Build from scratch │  │   1 stage            │
└──────────────────────┘  └──────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐
│ ○ Collaborative Proj │  │ ○ Sales Pipeline     │
│   Multi-team flow    │  │   Individual flow    │
│   8 stages           │  │   5 stages           │
└──────────────────────┘  └──────────────────────┘
```

"Start blank" is pre-selected with the "(recommended)" hint — most authors will tweak less by starting blank with an opinionated wizard than by cloning a template and unpicking what they don't want. Templates exist for power users who know exactly what shape they want.

Below the grid: **[Continue →]** (primary), **[Cancel]** (secondary).

Clicking Continue:
- If "Start blank" picked → routes to conversational skeleton (next section).
- If a template picked → clones the template's content into a new workflow in memory and routes directly to the side-by-side editor with all stages pre-filled.

---

## Conversational skeleton flow (Start blank only)

Three screens, similar visual language to phase 1's org wizard (assistant bubble, user reply, single primary action per screen). Lives at `/admin/workflows/new/setup` (sub-route of the picker).

### Step 1 — Name your workflow

**Assistant**: "Let's create a new workflow. What's it called?"

**Inputs**:
- Name (text, required, pre-filled with "Untitled Workflow") — becomes `displayName`
- Description (textarea, optional, placeholder: "What kind of work does this workflow track?") — becomes `description`

**Continue** → step 2. **Back** → returns to picker.

### Step 2 — Pick a flow type

**Assistant**: "What shape is this work? Pick the closest match."

Three cards (radio):

- **Owner-driven** — *One person owns each project from start to finish. They add teams as needed.* (`flowType: 'basic'`)
- **Multi-team collaborative** — *Multiple teams hand off work between stages — assignment, review, delivery.* (`flowType: 'collaborative'`)
- **Individual pipeline** — *Each item is owned by one person who moves it through defined stages — like a sales flow.* (`flowType: 'individual'`)

Pre-selected: **Multi-team collaborative** (the most common shape for the events vertical).

Hint at the bottom: "Don't worry if you're between two — you can change this later by editing the workflow."

### Step 3 — Name your stages

**Assistant**: "What stages do projects move through? Add 2-15 stages in order — you'll define the details next."

**Inputs**:
- Lead role name (text, required, pre-filled based on flow type — "Owner" / "Project Lead" / "Sales Rep") — becomes `leadRoleName`
- Stage list — accordion of text inputs, "+ Add stage" button. Min 2, max 15. Pre-filled with 2 stages: "In Progress" and "Completed."

Each stage row:
- Stage name (text)
- Drag handle (reorder)
- × button (remove, disabled if only 2 stages left)
- Auto-derived stage ID shown faintly to the right (e.g. "in-progress")

The last stage is auto-marked as terminal (visualized with a small flag icon and a tooltip: "This is the final stage — projects here are considered complete").

**Finish skeleton** → drops user into the side-by-side editor, with the workflow now populated with stage skeletons. No actions yet — that's the next step.

---

## The side-by-side editor

The authoritative editing surface for workflows. Used by:

- The wizard, after the skeleton flow finishes.
- The wizard, after a template is cloned.
- The standalone editor at `/admin/workflows/{id}/edit`.

### Layout

Three regions:

```
┌────────────────────────────────────────────────────────────┐
│ Workflow header — name, flow type pill, lead role          │
│ [⚙ Settings]  [💾 Save & Activate]  [Cancel]                │
├────────────────────────────────────────────────────────────┤
│ ┌──┐  →  ┌──┐  →  ┌──┐  →  ┌──┐  →  ┌──┐                  │  Stage flow
│ │S1│     │S2│     │S3│     │S4│     │S5│                   │  (horizontal,
│ └──┘     └──┘     └──┘     └──┘     └──┘                   │  scrollable)
│  +        +        +        +        +                      │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Stage editor panel                                         │
│  (slides in from right when a stage card is clicked)        │
│                                                             │
│  Stage name: [In Execution     ]                            │
│  Headline:   [optional         ]                            │
│  Actions:                                                   │
│    ┌──────────────────────────────────────────┐             │
│    │ When the Project Lead clicks "Submit",   │             │
│    │ the project moves to "Validation".       │             │
│    │ Collect: nothing                         │             │
│    └──────────────────────────────────────────┘             │
│    [ + Add action ]                                         │
│                                                             │
├────────────────────────────────────────────────────────────┤
│ Validation panel (collapsible, sticky at bottom)            │
│   ⚠ Stage "Lead Review" has no actions                       │
│   ⚠ Action "Decline" references a role that doesn't exist   │
└────────────────────────────────────────────────────────────┘
```

### Stage flow region

Horizontal row of stage cards. Each card shows:

- Stage number + name
- Action count badge ("2 actions" / "no actions")
- Validation status (red border if errors)
- Terminal flag if `isTerminal: true`

Between cards: small `+` button on hover → inserts a new blank stage at that position.

Drag-to-reorder via vertical drag handles on each card.

Click any card → opens the editor panel below for that stage.

### Settings (workflow-level)

Cog icon in the header opens a small drawer:

- Display name (editable)
- Description
- Flow type (pill display + warning if user tries to change it after stages are defined: "Changing flow type may invalidate some action settings.")
- Lead role name
- Card subtitle (optional)
- Modal description (optional)

### Save & Activate

The primary CTA. On click:

1. Run validation. If errors exist, scroll to the first error and pulse the validation panel. Block save.
2. If new workflow: write to `/workflows/{newId}` with auto-derived ID, bump registry to include it if "Activate immediately" is checked (default for new workflows).
3. If editing: bump `version`, write back to `/workflows/{id}`.
4. Show toast and route to `/admin/config` with the workflow highlighted.

A secondary **[Save as draft]** writes the workflow but doesn't activate (so it shows in the registry section but isn't selectable in new-project flow). Drafts are not loaded for project rendering since no project ever pins a draft.

---

## Stage editor panel

Opens when a stage card is clicked. Replaces the content area below the stage flow row (not a modal — keeps the flow visible).

### Top-level stage fields

```
Name:               [In Execution           ]
Short name:         [Exec       ] (optional, used in pills)
Headline:           [Build is in progress.  ] (optional, top of stage banner)
Hint:               [optional               ] (smaller subtext)
[ ] Mark as terminal stage (no further transitions; projects considered complete here)
```

### Actions section

A vertical list of action cards. Each card is the sentence-template view (see next section). Click any card to expand inline for editing.

```
ACTIONS

┌──────────────────────────────────────────────────────────┐
│ When the Project Lead clicks "Submit", the project       │
│ moves to "Validation". Collect: nothing.                 │
│                                                          │
│ [ Edit ]  [ Delete ]                                     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ When the Validator Team Lead clicks "Sign Off", the      │
│ project moves to "Closed" with outcome won. Collect:     │
│ Signoff note (textarea).                                 │
│                                                          │
│ [ Edit ]  [ Delete ]                                     │
└──────────────────────────────────────────────────────────┘

[ + Add action ]
```

Empty state when stage has no actions and isn't terminal: red banner — "This stage has no actions. Projects entering this stage can't move forward. Add an action or mark this stage as terminal."

---

## The sentence-template action editor

The hardest UX in 2c, designed to make complex configuration feel like reading and writing a sentence.

### Read-only sentence view (default)

```
When the Project Lead clicks "Accept",
the project moves to "Accepted".
Collect: nothing.
```

Each underlined phrase is editable. Click any of them to inline-edit. Click "Edit" on the card to expand the whole action into form fields.

### Expanded edit view

Five fields, in order:

**1. Actor** — "Who can click this button?"

A picker that resolves to `ActorRef`. Three top-level choices:

- A specific role in your org (sub-picker: lead role, coordinator team lead, validator team lead, specialist team member, ...)
- The project creator
- Anyone with global super-admin

Selecting "a specific role in your org" reveals a second dropdown populated from `orgStructure`. Each option shows the resolved role name from the org doc, not the internal `team_role` enum.

Below: a small toggle — **"Also allow super-admin to step in"**. When checked, adds `super_admin` to `alsoAllow`. Defaults on for collaborative-flow actions; off for individual-flow actions.

**2. Label** — "What does the button say?"

Text input. Required. ~20 char limit. Shows live preview of the button below.

**3. Effect** — "What happens when they click?"

A picker with these top-level choices, mapped to `ActionEffect` kinds:

- **Move to another stage** — opens sub-picker: target stage (dropdown of stages in this workflow). Maps to `{ kind: 'transition', toStage }`.
- **Move to another stage and increment a counter** — sub-picker: target stage + counter type (escalation/iteration). Maps to `{ kind: 'transition_with_counter' }`.
- **Assign the project lead and move to a stage** — sub-picker: target stage. Forces an `ActionInput` of type `user_picker` to be added. Maps to `{ kind: 'assign_lead', toStage }`.
- **Clear the project lead and move to a stage** — sub-picker: target stage. Maps to `{ kind: 'clear_lead', toStage }`.
- **Change the project status** — sub-picker: which status. Maps to `{ kind: 'set_status' }`.
- **Mark the project complete** — sub-picker: which outcomes are allowed (multi-select). Maps to `{ kind: 'mark_complete', outcomes }`.

**4. Inputs to collect** — "Anything to ask the user when they click?"

A list of input cards. Empty by default. **[ + Add input ]** button below.

Each input card lets the author specify:

- Label (text)
- Type (dropdown: short text, long text, date, dropdown, choose a user, status picker)
- Required (toggle)
- For dropdown type: list of options
- For "choose a user" type: scope (any admin / any specialist / any team lead — maps to `pickerScope`)

If the parent action's effect is `assign_lead`, a required `user_picker` input is auto-added and locked (can't be deleted, but can be relabeled).

**5. Intent (optional advanced)** — "How should this action be styled?"

Hidden behind an "Advanced" expand. Three options: Primary / Secondary / Destructive. Maps to `StageAction.intent`. Default depends on effect kind (`mark_complete` → primary, `transition_with_counter` → secondary, etc.).

### Live validation in the expanded view

As the author edits, validation issues for this action update inline. Missing required fields underlined red. Invalid combinations (e.g. `assign_lead` without a `user_picker` input) flagged immediately rather than at save.

---

## Validation UI

`WorkflowValidationError` is already exported from phase 2a's evaluator. Phase 2c wires it into the authoring surface.

### Validation runs

Two trigger points:

- **As-you-type debounce**: 500ms after the last edit, re-run validation. Update inline indicators (red borders on cards, validation panel contents).
- **On save attempt**: hard-validation. Errors block save; warnings allow save with a confirmation.

### Validation rules (run by the existing evaluator-side validator)

- Every non-terminal stage has at least one action.
- Every action's `effect.toStage` (where applicable) references an existing stage in this workflow.
- Every action's `actor` references a role that exists in `orgStructure` (for `team_role` actors) or is a valid built-in (for `global_role`/`creator`/`pipeline_role`).
- Every required `ActionInput` has a label.
- `user_picker` inputs have a defined `pickerScope`.
- `select` inputs have at least one option.
- `assign_lead` actions have at least one `user_picker` input.
- At least one terminal stage exists.
- All stages are reachable from the first stage via some action chain.
- No duplicate stage IDs or action IDs within a stage.

### Validation panel

Always-visible collapsible region at the bottom of the editor. Shows error count: "⚠ 3 errors" / "✓ Looks good". Expanding the panel shows a list of each error with a click-to-jump link that scrolls the relevant stage card into view and opens its editor panel.

### Stage-card-level surfacing

Each stage card in the flow shows:

- ✓ Green check (no issues)
- ⚠ Amber dot (warnings only)
- ⚠ Red dot (errors — blocks save)

Hovering any indicator shows a tooltip with the issue. Clicking jumps into the panel.

---

## Standalone workflow editor

Route: `/admin/workflows/{id}/edit`. Gated to super_admin.

Same side-by-side editor as the wizard's tail, but loaded with an existing workflow. Reached via:

- Pencil icon next to each workflow in `/admin/config` → Workflows section.
- Direct URL.

### Editing semantics

Since workflows are snapshot-pinned into projects at creation:

- Editing a workflow does **not affect any in-flight project**.
- The workflow doc is only used when *new* projects are created.
- The editor needs no "X projects on this workflow will be affected" warning, because none are.
- A small footer note clarifies: *"This workflow has 12 active projects. They'll continue on their existing definitions. Your changes apply to new projects only."*

### Bumping version on save

`workflow.version` increments on every save. The version isn't read by anything functionally (since snapshot-pin makes it informational), but it's surfaced in the workflows table for operator awareness.

---

## Unified onboarding flow

When a fresh tenant logs in, the unified wizard auto-launches. Detection logic:

```ts
const orgIncomplete = !orgStructure?.setupCompleted;
const noActiveWorkflows = (workflowRegistry?.activeWorkflowIds ?? []).length === 0;

if (orgIncomplete || noActiveWorkflows) {
  // route to /admin/setup with mode='unified'
}
```

### Routes

- `/admin/setup?step=org` — phase 1 org wizard. Existing.
- `/admin/setup?step=workflow` — kicks off the workflow authoring wizard with a slightly different chrome (no "Cancel" button; only "Continue").

The org wizard's final review screen gains a new button: **[Finish setup → Create your first workflow]** (instead of just "Finish setup"). Clicking it writes the orgStructure doc and routes to `?step=workflow`.

If a tenant arrives with `setupCompleted: true` but `activeWorkflowIds === []`, the unified wizard skips org and goes straight to workflow.

If both are done, the wizard doesn't auto-launch — they're already set up.

### Workflow wizard inside unified mode

Same wizard as standalone (`/admin/workflows/new`), but:

- Header copy changes to "Final step — set up your first workflow."
- The "Cancel" button is replaced with **[I'll do this later — use Simple Project]**. Clicking it activates the basic workflow without authoring anything new and exits to the home screen.
- The save button reads **[Finish setup]** instead of "Save & Activate."

This gives the tenant a clean escape hatch — if they're not ready to author a workflow, basic gets activated and they can configure later from `/admin/config`.

---

## Workflow registry section in `/admin/config` — updated

The phase 2b workflows section gets these changes:

### Buttons

- **Seed buttons** removed. Replaced with one **[+ Create new workflow]** button that routes to `/admin/workflows/new`.
- Each workflow row gets a pencil icon → `/admin/workflows/{id}/edit`.
- System-defined workflows (Simple Project, Collaborative Project, Sales Pipeline) get a small "system" badge and the pencil routes to a read-only view of the wizard with a banner: *"This is a system template. Use 'Duplicate' to make an editable copy."* The Duplicate button clones the workflow with a new ID and opens the editor.

### Active workflows table

Stays as 2b shipped it (active toggle, project count, recommended-leads management). Adds:

- Workflow version number ("v3") in a small column
- Last edited date

### The dormant section

Workflows that exist but aren't active still show in a separate "Inactive workflows" subsection (collapsible, defaults closed). Same row layout, but with an "Activate" button instead of the toggle.

---

## Touchpoints

| File | Change |
| --- | --- |
| `src/types/workflow.ts` | Add optional `description`, `creationModalCardSubtitle`, `creationModalDescription` to `Workflow`. |
| `src/types/models.ts` | Add `pinnedWorkflow: Workflow`, `description: string` to `Project`. |
| `src/lib/seedBasicWorkflow.ts` | Update to new shape (description, copy fields, single in_progress stage with creator+lead mark_complete). |
| `src/lib/seedCollabWorkflow.ts` | Add `description`, `creationModalCardSubtitle`, `creationModalDescription`. Display name kept as the operator-chosen value. |
| `src/lib/seedSalesWorkflow.ts` | Same as collab — add the copy fields. |
| `src/lib/firestore.ts` | `addProject`: snapshot the active workflow into `project.pinnedWorkflow` at creation. Read `description` from form when basic flow. |
| `src/lib/workflowEvaluator.ts` | Accept a `Workflow` parameter (already does) — no API change. Callers switch from looking up by id to passing `project.pinnedWorkflow`. |
| `src/contexts/AppConfigContext.tsx` | `useWorkflow(id)` still works for the new-project picker. Add no new hook; readers of project-scoped workflow switch to `project.pinnedWorkflow`. |
| `src/hooks/usePermissions.ts` | Internally pass `project.pinnedWorkflow` to evaluator instead of fetching by id. |
| `src/components/workflow/StageBanner.tsx` | Read from `project.pinnedWorkflow`. |
| `src/components/workflow/ProjectHistory.tsx` | Read from `project.pinnedWorkflow` for stage display name lookups. |
| `src/components/projects/StagePill.tsx` | Read from `project.pinnedWorkflow`. |
| `src/components/projects/WorkflowBadge.tsx` | Can stay as a lookup-by-id for the new-project picker, but project-list rendering uses `project.pinnedWorkflow.displayName` + `flowType` for color. |
| `src/components/admin/NewProjectModal.tsx` | `BasicFields` adds Description textarea. Workflow snapshot happens in `addProject`. |
| `src/components/admin/BasicFields.tsx` | Add Description textarea. |
| `src/pages/AppConfigPage.tsx` | Workflows section: replace seed buttons with "+ Create new workflow." Add pencil icons. Add version + last-edited columns. |
| `src/pages/AdminDashboard.tsx` | Tab data sources read from active workflows for definition but funnel counts read from `project.pinnedWorkflow.id === activeWorkflow.id` matches (so projects on inactive workflows don't pollute the chart). |
| `src/pages/ProjectDetail.tsx` | Read `pinnedWorkflow` throughout. Show project description in the header area below title (basic flow only, or wherever description has content). |
| `src/pages/WorkflowWizard/` (NEW) | Sub-routes: `/picker`, `/setup` (3 conversational steps), `/editor` (the side-by-side). |
| `src/pages/WorkflowWizard/TemplatePicker.tsx` | 4-card grid. Pre-selects "Start blank." |
| `src/pages/WorkflowWizard/Step1Name.tsx`, `Step2FlowType.tsx`, `Step3Stages.tsx` | Conversational skeleton screens. Reuse `WizardShell` + `AssistantBubble` from phase 1. |
| `src/pages/WorkflowWizard/SideEditor/` (NEW directory) | `index.tsx` (layout), `StageFlow.tsx` (horizontal cards), `StageEditorPanel.tsx` (right panel), `ActionCard.tsx` (sentence-template card), `ActionExpandedEditor.tsx` (the form), `ValidationPanel.tsx` (bottom panel), `WorkflowSettingsDrawer.tsx` (cog). |
| `src/pages/WorkflowEdit.tsx` (NEW) | Route handler for `/admin/workflows/{id}/edit`. Loads the workflow doc into the side-editor. |
| `src/lib/workflowAuthoring.ts` (NEW) | Helpers: ID derivation from display name, default action templates per flow type, "duplicate workflow" logic. |
| `src/lib/workflowValidation.ts` | Already exports `WorkflowValidationError` — extend to expose the full ruleset described above in a single callable validator function. Used by both as-you-type and on-save. |
| `src/components/onboarding/UnifiedWizardController.tsx` (NEW) | The auto-launch detection + route orchestrator. Mounted high in the app tree. |

---

## Critical files (new)

- `src/pages/WorkflowWizard/` directory and its components.
- `src/pages/WorkflowEdit.tsx`.
- `src/lib/workflowAuthoring.ts`.
- `src/components/onboarding/UnifiedWizardController.tsx`.

## Critical files (modified)

- `src/types/workflow.ts`, `src/types/models.ts`.
- `src/lib/seedBasicWorkflow.ts`, `seedCollabWorkflow.ts`, `seedSalesWorkflow.ts`.
- `src/lib/firestore.ts`, `workflowEvaluator.ts`, `workflowValidation.ts`.
- `src/hooks/usePermissions.ts`.
- All workflow-reading components (`StageBanner`, `ProjectHistory`, `StagePill`, dashboard tabs, project detail).
- `src/components/admin/NewProjectModal.tsx`, `BasicFields.tsx`.
- `src/pages/AppConfigPage.tsx`, `AdminDashboard.tsx`, `ProjectDetail.tsx`.

---

## Reused patterns

- **Conversational wizard shell** from phase 1 — `WizardShell`, `AssistantBubble`, progress bar, step routing. The skeleton wizard reuses these primitives directly.
- **Snapshot-pin pattern** — same approach Linear and other workflow tools use; well-understood.
- **Side-by-side editor layout** — close to Notion's database editor; familiar to anyone who's used a Notion-style tool.
- **Sentence-template UX for actions** — same idiom as Notion formulas and Zapier triggers; reads as English.
- **24h localStorage cache + cross-tab sync** — already shipped for org, workflow, registry; no new caching needed since workflow reads now come from `project.pinnedWorkflow` (no cache to manage).

---

## Verification

### Setup & snapshot pinning

1. **Pinned workflow on new project** — Create a project on collab-default. Inspect Firestore: `project.pinnedWorkflow` contains the full workflow doc (stages, actions, lead role, etc.). `project.workflowId` is the id.
2. **Edits don't affect existing projects** — Edit the collab-default workflow (change stage 3's display name). Save. Open an existing project on collab-default — old display name still shows. Open a newly created project — new display name shows.
3. **Inactive workflows aren't fetched** — Deactivate sales-default. Reload. Network tab shows no fetch for `/workflows/sales-default`. Existing sales projects still render correctly from their pinned snapshots.

### Simple Project flow

4. **Basic flow with description** — Create a project on Simple Project. Description field is required. Submit. Project detail shows the description prominently below the title.
5. **Basic flow team adding** — On a Simple Project, add a team. Verify the team is attached. Create a task under the project, assign to a team member.
6. **Basic flow completion** — Click "Mark Complete" as the creator. Status flips to completed. Verify the same action works as the project lead (via `alsoAllow`).

### Authoring wizard — template path

7. **Clone Simple Project** — Pick Simple Project template. Editor opens with 2 stages pre-filled. Change the stage 1 display name. Save & Activate. New workflow shows in `/admin/config` with the new name.
8. **Clone Collaborative Project** — Pick template. Editor opens with 8 stages pre-filled. Verify stage flow renders horizontally, all stages have action cards.
9. **Clone Sales Pipeline** — Pick template. Verify all 5 stages render, including terminal stages (won/lost) with visual flag.

### Authoring wizard — blank path

10. **Conversational skeleton — full flow** — Pick Start blank. Walk through 3 conversational screens (name, flow type, stages). Land in editor with skeleton stages, no actions yet. Each non-terminal stage shows the empty-state warning.
11. **Skip the skeleton** — Pick Start blank. In step 3, leave stage names at defaults (just "In Progress" and "Completed"). Click Finish skeleton. Editor opens with 2 stages. Mark stage 2 as terminal, add an action to stage 1, save.

### Sentence-template action editor

12. **Add a transition action** — On a stage, click + Add action. Sentence template expands. Pick actor = "Project Lead", label = "Submit", effect = "Move to another stage" → "Validation". Save. Sentence reads correctly. Action card displays the sentence.
13. **Add an assign_lead action** — Pick effect = "Assign the project lead and move to a stage." Verify a user_picker input auto-appears in the inputs section and can't be deleted. Picker scope defaults to "any admin."
14. **Add a mark_complete action with multiple outcomes** — Pick effect = "Mark the project complete" → outcomes = ['won', 'lost']. Save. Inspect the workflow doc: `mark_complete: { outcomes: ['won', 'lost'] }`.
15. **Edit an existing action** — Click the action card. Inline expand. Change actor. Save. Sentence updates to reflect new actor.

### Validation

16. **Block save on missing actions** — Create a non-terminal stage with no actions. Try Save & Activate. Validation panel surfaces the error, save is blocked, the stage card pulses red.
17. **Block save on invalid actor** — In stage editor, pick actor = "Validator Team Lead" but the orgStructure has `hasValidator: false`. Validation error shows; save blocked.
18. **As-you-type validation** — Edit an action's effect to reference a stage that doesn't exist. Within 500ms, the action card shows a red dot. Hover → tooltip explains the issue.
19. **Click-to-jump from validation panel** — Multiple errors across different stages. Click each in the panel, verify it jumps and opens the right stage's editor.

### Standalone editing

20. **Edit an existing workflow** — From `/admin/config`, click pencil next to Collaborative Project. Editor loads with all 8 stages. Make a small change (rename stage 4). Save. Version bumps from 1 to 2. `/admin/config` shows v2.
21. **Pinned projects unaffected** — From verification step 2 again, but using the standalone editor instead of the wizard.
22. **System workflow read-only** — Click pencil on Simple Project. Banner shows "This is a system template. Use 'Duplicate' to make an editable copy." Try to edit a stage — fields are disabled. Click Duplicate → new editable copy opens in editor with a new id.

### Unified onboarding

23. **Fresh tenant** — Wipe `orgStructure`, `workflowRegistry`. Sign in as super_admin. Lands on `/admin/setup?step=org`. Walk through org wizard. On finish, routes to `?step=workflow`. Walk through workflow wizard. Lands on home screen with both org and at least one workflow set up.
24. **Org done, workflows empty** — Wipe only `workflowRegistry`. Sign in. Routes straight to `?step=workflow`. Skip via the "I'll do this later" CTA → basic activated, home screen.
25. **Both done** — Sign in normally. No auto-launch.

### Migration

26. **Existing projects without `pinnedWorkflow`** — Migration script reads each project, fetches its `workflowId`'s current state, writes the snapshot into the project. Run once after deploy. Verify all projects have `pinnedWorkflow` populated and render unchanged.

---

## Risks and mitigations

- **Snapshot pinning means project docs grow ~3-5KB.** At 10K projects, that's ~50MB extra in Firestore. Acceptable now; if it becomes a concern later, snapshot can be moved to a subcollection (`projects/{id}/state`). Flagged in case a future tenant has many projects on a many-stage workflow.
- **The "every project becomes its own workflow" backfill is destructive.** Mitigation: idempotent migration script that skips projects already having `pinnedWorkflow`. Dry-run mode logs the size-per-project before writing.
- **Editing a workflow that's been duplicated across many projects has no propagation.** This is a feature, not a bug — versioning by snapshot means edits only affect new projects. But operators may not understand this. The footer note in the editor and the dashboard description should both clarify.
- **The wizard is large** — many new files. Risk of inconsistent UX between the conversational and side-by-side surfaces. Mitigation: extract shared primitives (`StageNameInput`, `ActorPicker`, `EffectPicker`) and reuse rigorously. Build the side-by-side editor first; the conversational wizard's final step shares 100% of its rendering with the editor.
- **Sentence-template UX has copy-writing weight.** Bad copy will make this feel cryptic instead of clear. Mitigation: 2c includes a copy review pass after the first MVP build — the team reads every wizard sentence aloud, fixes anything that doesn't land. Half a day, well spent.

---

## What ships after Phase 2c

- Tenants author their own workflows through a UI. No more operator-run seed scripts.
- Workflow edits never affect in-flight projects — snapshot pin closes the loop.
- The unified onboarding flow lands fresh tenants on the home screen with org structure and at least one workflow configured, in ~5-7 minutes total.
- The Simple Project flow becomes the genuinely-easy Jira-style baseline — title, description, attachments, team, tasks, done. Most non-pipeline use cases land here naturally.
- The `/admin/config` Workflows section becomes the operational hub: see all workflows, edit any, create new ones via the wizard, duplicate system templates, activate/deactivate.
- The platform's core promise is delivered: an event-industry operating system where each tenant can shape their workflows without code. Phase 3 builds the intelligence layer on top of the rich behavioral data this enables.

Phase 2c ships as two implementation chunks:

- **2c.1 — Workflow authoring** (~4 weeks): snapshot-pin refactor, template picker, conversational skeleton, side-by-side editor, sentence-template action editor, validation UI, standalone editor, basic flow redefinition.
- **2c.2 — Unified onboarding** (~1-2 weeks): UnifiedWizardController, org-wizard → workflow-wizard transition, "I'll do this later" escape hatch, unified review screen.

Total: **5-6 weeks** of focused work. The riskiest piece is the sentence-template action editor — it's where users hit the actual complexity of the schema. The safest is the standalone editor — it's the side-by-side editor with a different mount.
