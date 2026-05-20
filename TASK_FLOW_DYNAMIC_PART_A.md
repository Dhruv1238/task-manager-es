# Phase 2a — Workflow as Data

## Context

Phase 1 took org structure (lead role name, team roles, work types, team mappings) out of code and into Firestore. After phase 1, the codebase no longer hardcodes "CT lead" or "2D team" — it asks the org-structure resolver. But the **shape of the workflow itself** — the 10 stages, the transitions between them, which actions exist at each stage, who can perform them — is still hardcoded in TypeScript across `StageBanner`, `usePermissions`, `firestore.ts`, and a handful of stage modals.

Phase 2a moves that into Firestore. After phase 2a, the codebase knows how to *render* a workflow but not what any specific workflow contains. A new workflow shape (sales, basic, a tenant's custom flow) means a new Firestore doc, not a code change. The same engine renders all of them.

This is the architectural keystone of the whole platform. It's also the riskiest phase — every stage banner, every permission check, every transition write gets touched. Phase 2a deliberately scopes *only* to the engine and the data; no authoring UI, no multi-pipeline, no head-to-workflow association. Those are phases 2b and 2c.

Phase 2a builds on top of:

- `admin-config-init` — the `/config/appConfig` doc with `pipelineEnabled` toggle.
- Phase 1 — the `/config/orgStructure` doc and the `lib/orgResolver.ts` resolver.

In-scope:

1. New `/config/workflows/{workflowId}` Firestore docs holding stages, actions, and transitions.
2. New `src/lib/workflowEvaluator.ts` — pure functions that read a workflow doc plus a project state and produce "what can be rendered, what can be done, what happens when."
3. `usePermissions` API change: named flags (`canAcceptOrEscalate`, `canSignOffValidation`, etc.) replaced with generic `canPerform(actionId)`.
4. `StageBanner` and stage modals refactored into a single generic banner + a single generic action modal that read from the workflow doc.
5. Project schema gets `workflowId` and stage IDs become stable strings.
6. Rename `src/components/tender/` → `src/components/workflow/`. No "tender" string in code anywhere.
7. Two seeded workflow docs: `collab-default` (Client A's 10-stage flow with generic naming) and `basic` (3-state stub for non-pipeline tenants).
8. `pipelineEnabled` from admin-config-init now controls which workflow new projects pin at creation (`true` → `collab-default`, `false` → `basic`).

Out of scope:

- Multi-workflow per tenant — phase 2b. Phase 2a still has one workflow active at a time, chosen by `pipelineEnabled`.
- Head-to-workflow association — phase 2b.
- Workflow authoring wizard — phase 2c.
- Optional/skippable stages with preconditions — phase 2c.
- Sales workflow seed — phase 2b. Phase 2a only seeds `collab-default` and `basic`.
- In-flight project migration. Existing projects break on phase 2a deploy; the team recreates them.
- Pool / auto allotment — phase 3.

---

## Firestore schema — `/config/workflows/{workflowId}`

### The workflow doc

```ts
// add to src/types/workflow.ts (new file)
export type FlowType = 'collaborative' | 'individual' | 'basic';

export interface Workflow {
  id: string;                       // matches doc id: 'collab-default', 'basic', etc.
  displayName: string;              // tenant-facing label: "Tender", "Sales Pipeline"
  flowType: FlowType;               // coarse-grained classification
  leadRoleName: string;             // per-workflow lead label: "Vertical Head", "Sales Manager"
  isSystemDefined: boolean;         // true for seeds; false for tenant-authored (phase 2c)
  stages: Stage[];                  // ordered, identity-bearing
  version: number;
  updatedAt: Timestamp;
  updatedBy: string;
}
```

### Stages

```ts
export interface Stage {
  id: string;                       // stable: 'created', 'allocated', 'in_execution', ...
  displayName: string;              // tenant-facing: "Awaiting Lead Decision"
  order: number;                    // 1-indexed; used for display sorting
  isTerminal: boolean;              // true ⇒ no further transitions; project.status set to 'completed'
  actions: StageAction[];           // empty for terminal stages
}
```

### Actions

An action is anything a user can do *at* a stage — accept, escalate, sign off, mark complete. Every action has an actor, an effect, and (optionally) modal inputs.

```ts
export interface StageAction {
  id: string;                       // 'accept', 'escalate', 'sign_off', 'reject', 'mark_delivered'
  label: string;                    // button text
  actor: ActorRef;                  // who can perform this
  effect: ActionEffect;             // what happens
  inputs: ActionInput[];            // modal fields (empty array if action is a one-click)
}

export type ActorRef =
  | { kind: 'global_role'; role: 'super_admin' | 'admin' }
  | { kind: 'pipeline_role'; role: 'lead' }                         // project.leadUid
  | { kind: 'team_role'; role: TeamRoleId; member: 'lead' | 'any' } // from phase 1 orgResolver
  | { kind: 'creator' };                                            // project.ownerId

export type ActionEffect =
  | { kind: 'transition'; toStage: string }
  | { kind: 'transition_with_counter'; toStage: string; counter: 'escalation' | 'iteration' }
  | { kind: 'assign_lead'; toStage: string }                        // sets project.leadUid + transitions
  | { kind: 'mark_complete'; outcome: 'won' | 'lost' | 'completed' };

export interface ActionInput {
  id: string;                       // 'feedback', 'eta', 'priority', 'leadUid'
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select' | 'user_picker';
  required: boolean;
  options?: string[];                                               // for type: 'select'
  pickerScope?: 'global_role:admin' | 'team_role:specialist/any';   // for type: 'user_picker'
}
```

### Why this shape

- **Array of stages, not subcollection.** Stages are bounded (~10) and edited together. Atomic updates, single read, version-coherent. A subcollection would buy nothing.
- **`id` separate from `displayName`.** The engine references stages and actions by stable id; users see and edit display names. This is the same separation phase 1 used for team roles.
- **`actor` as a discriminated union.** Each `kind` is a different way of referring to "someone allowed to act." The evaluator dispatches on `kind`. Adding a new actor type later (e.g. `{ kind: 'specific_user'; uid: string }`) means one new case in the evaluator, no schema migration.
- **`effect` discriminated similarly.** All current behaviors expressible: simple transition, transition that increments a counter (escalation/iteration), allocation (assign lead and transition in one go), terminal completion with outcome. New effects extend the union; existing docs keep working.
- **No `involvedRoles` field on Stage.** "Who's involved at this stage" is derivable from `actions[].actor` — the evaluator computes it on demand for the `/me` inbox. One less field, one less thing the eventual wizard has to ask about.

---

## Worked example — stage `allocated` from `collab-default`

To show the schema in use, this is one stage of the seeded collaborative workflow. Pulled out because it's the most action-rich stage — accept + escalate, two effect types, modal inputs on one of them.

```ts
{
  id: 'allocated',
  displayName: 'Awaiting Lead Decision',
  order: 2,
  isTerminal: false,
  actions: [
    {
      id: 'accept',
      label: 'Accept',
      actor: { kind: 'pipeline_role', role: 'lead' },
      effect: { kind: 'transition', toStage: 'accepted' },
      inputs: [],
    },
    {
      id: 'escalate',
      label: 'Escalate Back',
      actor: { kind: 'pipeline_role', role: 'lead' },
      effect: { kind: 'transition_with_counter', toStage: 'created', counter: 'escalation' },
      inputs: [
        { id: 'reason',   label: 'Reason for escalation', type: 'textarea', required: true  },
        { id: 'eta',      label: 'ETA',                   type: 'date',     required: false },
        { id: 'priority', label: 'Priority',              type: 'select',   required: true,
          options: ['low', 'medium', 'high'] },
      ],
    },
  ],
}
```

The evaluator reads this and tells `StageBanner`: "render two buttons — `Accept` (no modal) and `Escalate Back` (opens modal with three fields). Both only visible to the project's lead." `StageBanner` itself contains zero knowledge that `accept` and `escalate` exist; it iterates `currentStage.actions`, filters by allowed-for-this-user, and renders.

---

## Schema changes to existing collections

### `projects/{projectId}`

```ts
export interface Project {
  // ... existing fields unchanged except as noted

  // NEW: which workflow this project is following. Pinned at creation.
  workflowId: string;                  // e.g. 'collab-default', 'basic'

  // CHANGED: stage is now a stable string id, not a number
  currentStageId: string;              // replaces `stage: number`

  // CHANGED: stage history references string ids
  stageHistory: StageEvent[];          // see below

  // RENAMED: vhId → leadUid (matches per-workflow `leadRoleName`)
  leadUid: string | null;              // was `vhId`

  // UNCHANGED: existing tender-specific fields
  escalationCount: number;
  iterationCount: number;              // was `vhIterationCount`, renamed
  ownerId: string;
  status: 'active' | 'completed' | 'archived';  // archived stays orthogonal to stages
  // ...
}

export interface StageEvent {
  stageId: string;                     // was numeric `stage`
  enteredAt: Timestamp;
  enteredBy: string;
  payload?: Record<string, unknown> | null;
}
```

### `/config/appConfig`

No schema change. The existing `pipelineEnabled: boolean` keeps its semantics, but its *effect* moves: it now controls which `workflowId` new projects pin at creation. `true` → `'collab-default'`, `false` → `'basic'`. The per-stage enable/disable toggles from admin-config-init are removed in phase 2a (their job moves into the workflow doc — a "disabled stage" becomes "a stage with no actions for any user," which the wizard surfaces in phase 2c).

---

## The evaluator — `src/lib/workflowEvaluator.ts` (new file)

Pure functions, no React. Called from hooks for live rendering, called from `firestore.ts` helpers for writes. The single source of truth for "what can happen, what happens when."

```ts
// Read the current stage object for a project.
export function getCurrentStage(project: Project, workflow: Workflow): Stage;

// Given a project + workflow + viewing user + org context, return the actions
// this user is allowed to perform right now.
export function getAllowedActions(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  orgStructure: OrgStructure,
): StageAction[];

// Boolean version — does this user have permission for this specific action?
export function canPerform(
  project: Project,
  workflow: Workflow,
  user: User,
  teams: Team[],
  orgStructure: OrgStructure,
  actionId: string,
): boolean;

// Execute an action. Validates inputs against ActionInput[] declarations,
// writes the transition + counter increment + stageHistory append in one batch,
// records audit event. Throws on permission/input violation.
export async function performAction(
  project: Project,
  workflow: Workflow,
  user: User,
  actionId: string,
  inputs: Record<string, unknown>,
): Promise<void>;

// Derive "who's involved at this stage" from actions[].actor.
// Used by the /me inbox filter ("projects awaiting my action").
export function getInvolvedActors(
  stage: Stage,
  project: Project,
  orgStructure: OrgStructure,
  teams: Team[],
): ActorRef[];
```

### Actor resolution

The evaluator's `canPerform` dispatches on `actor.kind`:

| `actor.kind` | Resolution |
| --- | --- |
| `global_role` | `user.globalRole === actor.role` |
| `pipeline_role: lead` | `user.uid === project.leadUid` |
| `team_role: { role, member: 'lead' }` | `user.uid === orgResolver.resolveLeadOf(role, teams, users)` |
| `team_role: { role, member: 'any' }` | `user.uid ∈ orgResolver.resolveTeamOf(role).memberIds` |
| `creator` | `user.uid === project.ownerId` |

All five resolve through helpers that already exist in phase 1's `orgResolver.ts` (or get added in this phase). No new global state, no new collections to read.

### Effect execution

`performAction` switches on `effect.kind`:

- `transition` → single `updateDoc(project, { currentStageId: effect.toStage, stageHistory: arrayUnion(...) })` plus audit event.
- `transition_with_counter` → same plus the counter increment (`escalationCount: increment(1)` or `iterationCount: increment(1)`).
- `assign_lead` → reads `leadUid` from inputs (must be a `user_picker` input), writes it plus the transition.
- `mark_complete` → writes `status: 'completed'`, optionally `outcome` to project doc, appends terminal stage event.

All writes go through `writeBatch`, identical pattern to existing `firestore.ts` helpers.

### Input validation

Before executing the effect, `performAction` validates the `inputs` argument against the action's `ActionInput[]` declaration:

- Required inputs must be present and non-empty.
- `type: 'select'` values must be in `options`.
- `type: 'user_picker'` values must resolve to an actual user matching `pickerScope`.

Throws a typed error on violation. Frontend modals also validate before submit, but the evaluator is the authoritative check.

---

## Permission API change — `canPerform(actionId)` replaces named flags

Phase 1 left `usePermissions` returning named flags like `canAcceptOrEscalate`. Phase 2a replaces those with a single generic call:

```ts
// Before (phase 1):
const perms = usePermissions(projectId);
if (perms.canAcceptOrEscalate) { ... }
if (perms.canSignOffValidation) { ... }

// After (phase 2a):
const perms = usePermissions(projectId);
if (perms.canPerform('accept') || perms.canPerform('escalate')) { ... }
if (perms.canPerform('sign_off')) { ... }
```

The hook reads workflow + project + org + user from context, memoizes, and exposes `canPerform: (actionId: string) => boolean`. Internally it calls the evaluator's `canPerform`.

**Why this is worth the churn now:** every named flag is a place where the workflow doc and the code can drift. Adding a new action to a workflow shouldn't require adding a new flag in TypeScript. With generic `canPerform`, the workflow doc is genuinely the source of truth — code asks the doc, doesn't duplicate it. Phase 2c's authoring wizard would otherwise require touching `usePermissions` for every new action a tenant creates; with the generic API, the wizard never needs the code to change.

The cost is real but bounded: ~15-20 call sites change. Mostly in `StageBanner`, the action modals, and a few buttons scattered through project detail and the dashboard. Acceptable given the staging-env freedom to break things.

---

## Touchpoints — files that change

| File | Change |
| --- | --- |
| `src/types/workflow.ts` (NEW) | `Workflow`, `Stage`, `StageAction`, `ActorRef`, `ActionEffect`, `ActionInput` types. |
| `src/types/models.ts` | `Project`: add `workflowId`, rename `stage` → `currentStageId`, rename `vhId` → `leadUid`, rename `vhIterationCount` → `iterationCount`, `stageHistory[].stage` → `stageHistory[].stageId`. |
| `src/lib/workflowEvaluator.ts` (NEW) | All evaluator functions. Pure. |
| `src/contexts/AppConfigContext.tsx` | Add `useActiveWorkflow()` hook + non-React `getActiveWorkflowSnapshot()`. Reuses the localStorage 24h-TTL pattern. Cache key: `workflow:{id}:v1`. |
| `src/hooks/usePermissions.ts` | Replace named flags with `canPerform(actionId)`. Internally calls evaluator. Pipeline-aware gating from phase 1 simplifies: now always asks evaluator. |
| `src/lib/firestore.ts` | `addProject`: reads `appConfig.pipelineEnabled` → sets `workflowId` to `'collab-default'` or `'basic'`; sets `currentStageId` to the workflow's first stage. `transitionStage` is removed — replaced by `workflowEvaluator.performAction`. |
| `src/components/workflow/` (RENAMED from `tender/`) | Folder rename. All imports update. |
| `src/components/workflow/StageBanner.tsx` | Rewritten generic. Iterates `currentStage.actions`, filters by `canPerform`, renders one button per allowed action. No knowledge of specific action names. |
| `src/components/workflow/ActionModal.tsx` (NEW) | Generic modal that renders `ActionInput[]` as form fields. Replaces `AcceptOrEscalateModal`, `AllocateVhModal`, `SignOffModal`, `MarkDeliveredModal`, `RejectModal`. On submit, calls `performAction`. |
| `src/components/workflow/StageHistory.tsx` | Reads stage display names from the workflow doc via `getCurrentStage`-style lookup. No hardcoded stage labels. |
| `src/components/admin/NewProjectModal.tsx` | No structural change; the existing fields (submission/presentation dates, etc.) stay tied to `pipelineEnabled`. New: writes `workflowId` to the new project. |
| `src/pages/ProjectDetail.tsx` | Lead row label uses `workflow.leadRoleName` (was phase 1's `orgStructure.leadRoleName`). Stage label uses current stage's `displayName`. |
| `src/pages/AdminDashboard.tsx` | `TenderPipelineFunnel` renamed `PipelineFunnel`, reads stage IDs from the active workflow doc and counts projects by `currentStageId`. `AtRiskBySubmission` unchanged (still gated by `pipelineEnabled`). |
| `src/pages/Projects.tsx` | `StagePill` reads stage display name from the active workflow doc. |
| `src/App.tsx` | No route changes. |

### Stage modals being merged

Currently there are several modals — `AllocateVhModal`, `AcceptOrEscalateModal`, `SignOffModal`, `MarkDeliveredModal`, `RejectModal`. After phase 2a these all collapse into one generic `ActionModal` that:

- Reads the `StageAction` for the action being performed.
- Renders one form field per `ActionInput` (text → input, textarea → textarea, select → dropdown, date → date picker, user_picker → existing UserPicker component).
- Validates on submit, calls `performAction`, shows toast.

The old modals are deleted. Their copy and field arrangement gets translated into the seeded workflow doc.

---

## The seeded workflows

Two seed scripts shipped with phase 2a, run once per environment.

### `scripts/seedCollabWorkflow.ts`

Writes `/config/workflows/collab-default` matching Client A's current 10-stage flow, with generic naming. The full stage list:

| `id` | `displayName` | order | Actions |
| --- | --- | --- | --- |
| `created` | Project Created | 1 | `allocate` (super_admin → assign_lead, transition `allocated`) |
| `allocated` | Awaiting Lead Decision | 2 | `accept` (lead → `accepted`), `escalate` (lead → `created` w/ escalation counter) |
| `accepted` | Lead Accepted | 3 | `proceed` (lead → `task_setup`) — usually auto-advanced by client UI |
| `task_setup` | Task Setup | 4 | `confirm_setup` (lead → `in_execution`) |
| `in_execution` | In Execution | 5 | `request_validation` (lead → `validation`) |
| `validation` | Validation Review | 6 | `sign_off` (validator team lead → `lead_review`), `request_changes` (validator team lead → `in_execution` w/ iteration counter) |
| `lead_review` | Lead Review | 7 | `approve` (lead → `ready_for_client`), `request_rework` (lead → `in_execution` w/ iteration counter) |
| `ready_for_client` | Ready for Client | 8 | `mark_delivered` (coordinator team lead → `delivered`) |
| `delivered` | Delivered | 9 | `record_outcome` (coordinator team lead → mark_complete with outcome input) |
| `closed` | Closed | 10 | terminal; no actions |

(Stages 3 and 4 currently auto-advance via UI; that behavior is preserved by the client clicking through them. Phase 2c can add a `auto_advance: true` field on Stage to formalize this; phase 2a doesn't.)

The seed script is idempotent: re-running it overwrites the doc, bumps `version`, preserves nothing about prior edits. Run it once per environment after deploy.

### `scripts/seedBasicWorkflow.ts`

Writes `/config/workflows/basic`. Three stages, intentionally minimal:

| `id` | `displayName` | order | Actions |
| --- | --- | --- | --- |
| `in_progress` | In Progress | 1 | `mark_complete` (creator or owner → mark_complete with outcome `completed`) |
| `completed` | Completed | 2 | terminal |

(`archived` is a project status, not a stage. Any project from any stage can be archived via the existing status mechanism. The basic flow keeps this.)

### `scripts/migrateClientA.ts`

One-shot script: for every existing project doc in Client A's tenant, set `workflowId: 'collab-default'` and translate the numeric `stage` to its string equivalent (`1 → 'created'`, `2 → 'allocated'`, etc.). The team is recreating in-flight projects so this script is a backstop only — the verification path is "create fresh, walk through, prove it works."

---

## Critical files (new)

- `src/types/workflow.ts` — types.
- `src/lib/workflowEvaluator.ts` — evaluator.
- `src/components/workflow/ActionModal.tsx` — generic modal.
- `scripts/seedCollabWorkflow.ts` — Client A seed.
- `scripts/seedBasicWorkflow.ts` — stub seed.
- `scripts/migrateClientA.ts` — one-shot migration.

## Critical files (modified)

- `src/types/models.ts` — Project schema changes.
- `src/contexts/AppConfigContext.tsx` — active workflow loading and caching.
- `src/hooks/usePermissions.ts` — `canPerform` API.
- `src/lib/firestore.ts` — `addProject` writes `workflowId`; `transitionStage` removed in favor of `performAction`.
- `src/components/workflow/StageBanner.tsx` — generic renderer.
- `src/components/workflow/StageHistory.tsx` — reads display names from workflow.
- `src/components/admin/NewProjectModal.tsx` — writes `workflowId`.
- `src/pages/ProjectDetail.tsx` — workflow-aware labels.
- `src/pages/AdminDashboard.tsx` — pipeline funnel reads from workflow.
- `src/pages/Projects.tsx` — stage pill reads from workflow.

## Files removed

- `src/components/tender/AcceptOrEscalateModal.tsx`, `AllocateVhModal.tsx`, `SignOffModal.tsx`, `MarkDeliveredModal.tsx`, `RejectModal.tsx` — all merged into `ActionModal.tsx`.
- The stage-aware constants in `models.ts` (`STAGE_NAMES`, `STAGE_SHORT_NAMES`) — replaced by reads from the workflow doc.
- Phase 1's per-stage enable/disable toggle UI in `/admin/config` — that information now lives in the workflow doc (a "disabled stage" = a stage with no actions). The pipelineEnabled master toggle stays.

---

## Reused existing patterns

- **`/config/appConfig` localStorage cache pattern** — copied for the workflow doc cache. Same TTL, same cross-tab sync.
- **Phase 1's `orgResolver.ts`** — the evaluator calls into it for `team_role` actor resolution. No duplication.
- **`writeBatch` + audit-event** — `performAction` uses the same pattern existing `firestore.ts` helpers use.
- **`DevConfigRoute`** — gates the (not-yet-built) workflow inspector page if we add one later. Not needed in 2a since there's no UI.

---

## Verification

1. **Fresh project, collaborative pipeline, full happy path**:
   - `pipelineEnabled: true`. Create a new project as super_admin. Verify `workflowId: 'collab-default'` and `currentStageId: 'created'` are written.
   - Stage banner renders the "Allocate" button (super_admin → assign_lead). Click → modal opens with the lead picker. Pick a lead → project advances to `allocated`, `leadUid` is set.
   - As the lead user: stage banner shows Accept + Escalate Back. Click Accept → project advances to `accepted`, the client auto-advances to `task_setup`.
   - Walk through every remaining stage to `delivered`, recording the outcome. Final state: `status: 'completed'`, `currentStageId: 'closed'`. `stageHistory` has every entry with string `stageId`s.

2. **Fresh project, basic pipeline**:
   - Toggle `pipelineEnabled: false`. Create a new project. Verify `workflowId: 'basic'`, `currentStageId: 'in_progress'`.
   - Stage banner shows "Mark Complete" for the creator/owner.
   - Click → status flips to `completed`, `currentStageId: 'completed'`. Project becomes read-only as before.

3. **Escalation path**:
   - Collaborative pipeline. Create project, allocate to lead. Lead clicks Escalate Back → modal collects reason/eta/priority.
   - Submit → project returns to `created`, `leadUid` cleared, `escalationCount` is 1, `stageHistory` records the escalation event with the payload.

4. **Rework loop**:
   - From `lead_review`, click Request Rework → returns to `in_execution`, `iterationCount` is 1.
   - Walk through again to `lead_review`, approve → advances to `ready_for_client`, `iterationCount` still 1.

5. **Permission gating**:
   - As a non-lead user, the Accept/Escalate buttons do not render on a project in `allocated`. `canPerform('accept')` returns false.
   - As the wrong team lead at `validation`, the Sign Off button does not render.

6. **Workflow doc caching**:
   - Inspect `localStorage.getItem('workflow:collab-default:v1')`. Set `fetchedAt` to 25h ago. Reload — observe one `getDoc` for the workflow doc. Within TTL, no read.

7. **Active workflow swap**:
   - Toggle `pipelineEnabled` off after creating a collab project. The existing project keeps its `workflowId: 'collab-default'` and continues to render correctly (the workflow doc is still fetched on demand). New projects get `workflowId: 'basic'`.

8. **Generic action modal**:
   - Inspect any stage with modal inputs (e.g. `allocated`'s escalate, `validation`'s request_changes). Verify the modal renders one form field per `ActionInput`, required fields block submit, select options match the doc.

9. **Stage history rendering**:
   - Open stage history side panel on a project that's been through 4+ stages. Verify each entry shows the stage's `displayName` from the workflow doc, not a hardcoded label.

10. **Migration script (existing Client A projects)**:
    - Run `scripts/migrateClientA.ts` against a staging tenant with old projects. Verify each gets a `workflowId` and the numeric `stage` becomes the matching string `currentStageId`. (Backstop only; the team is recreating in-flight projects regardless.)

---

## Open questions / decisions

Small enough to decide during implementation; flagging so they don't surprise the reviewer.

- **Auto-advancing stages.** Stages 3 (`accepted`) and 4 (`task_setup`) currently auto-advance via UI. Phase 2a preserves this behavior in the client. Phase 2c should formalize with an `autoAdvance: true` flag on Stage; phase 2a doesn't add the field.
- **Outcome enum.** `mark_complete` effect takes `outcome: 'won' | 'lost' | 'completed'`. Client A uses won/lost; basic flow uses completed. Phase 2c may want this configurable per workflow. For 2a it's a fixed enum.
- **Audit event shape.** Each `performAction` writes one audit event with `actionId`, `fromStageId`, `toStageId`, `payload`. Existing audit-event renderers may need updates to display these gracefully; not blocking.
- **What if `pipelineEnabled` toggles while a project is open?** The project keeps its `workflowId`. New projects pick up the new toggle state. The currently-open project's UI does not change. Confirmed correct.

---

## What ships after phase 2a

- The codebase no longer hardcodes any specific workflow. The 10-stage flow and the 3-stage stub both run through the same engine.
- "Tender" exists nowhere in code — only in `displayName` strings inside the workflow doc, where tenants can edit it.
- `usePermissions` is a single generic API. New actions don't require code changes.
- The seed scripts plus the evaluator together prove a third workflow (sales) is fundamentally a Firestore doc + a one-line addition to `pipelineEnabled`'s output map. Which is exactly the wedge phase 2b drives in.
- Phase 2c can be designed against a real, used schema rather than speculation.

Phase 2a is roughly **3-4 weeks** of focused work. The riskiest piece is the `StageBanner` + permission refactor; the safest is the seed scripts. Recommended build order: types → evaluator → seeded docs → `firestore.ts` writes → permissions → StageBanner + ActionModal → other surfaces → migration script → verification.
