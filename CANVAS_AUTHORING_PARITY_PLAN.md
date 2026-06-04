# Close the side-editor → canvas-editor authoring gap

> **Status: IMPLEMENTED** (2026-06-04) — all items below shipped except the explicitly-deferred `flowType` editing. Kept as the design record.

## Context

The canvas editor (`src/components/authoring/canvas/*` + `FlowAuthoring.tsx`) is now the primary workflow-authoring surface; the old "side-by-side" editor (`src/pages/WorkflowWizard/SideEditor/*`, `WorkflowEdit.tsx`) is legacy and only survives because the canvas *reuses three of its sub-editors verbatim* (`ProjectRolesEditor`, `CustomFieldsEditor`, `StatusOptionsEditor` — imported by the canvas `WorkflowSettingsDrawer`).

When the canvas/v2 model replaced v1 (`effect → outcomes[]`, `actor/alsoAllow → actors[]`) it left a gap: several fields the **runtime still renders** were never exposed in the canvas, and first-class **counters were dropped** (only legacy replay survives). Net effect: a workflow authored 100% on the canvas produces a *degraded* end-user experience versus a seeded flow — plain `displayName` stage banners, all-`primary` buttons, and no iteration/escalation loops.

**Runtime-verified delta** (what the runtime reads vs. what the canvas can set):

| Field | Runtime renders it | Canvas can set | Action |
|---|---|---|---|
| Stage `headline` | ✅ StageBanner main text ([workflowEvaluator.ts:71-80](src/lib/workflowEvaluator.ts#L71), [StageBanner.tsx:82](src/components/workflow/StageBanner.tsx#L82)) | ❌ | **Add** |
| Stage `hint` | ✅ StageBanner subtext ([StageBanner.tsx:130](src/components/workflow/StageBanner.tsx#L130)) | ❌ | **Add** |
| Stage `shortDisplayName` | ✅ PipelineFunnel axis ([PipelineFunnel.tsx:54](src/components/charts/PipelineFunnel.tsx#L54)) | ❌ | **Add** |
| Action `intent` | ✅ button color ([StageBanner.tsx:149](src/components/workflow/StageBanner.tsx#L149)/224-237, [ActionModal.tsx:176](src/components/workflow/ActionModal.tsx#L176)) | ❌ hardcoded `primary` | **Add** |
| Canonical actor (My Tasks inbox routing) | ✅ `actors[0]` is the only actor surfaced in /me ([workflowEvaluator.ts:210-220](src/lib/workflowEvaluator.ts#L210), inbox mode via [useProjectsAwaitingMyAction.ts:71](src/hooks/useProjectsAwaitingMyAction.ts#L71)) | ❌ flat list, no marker (old editor had "make canonical") | **Add** |
| `creationModalDescription` | ✅ NewProjectModal ([NewProjectModal.tsx:346](src/components/admin/NewProjectModal.tsx#L346)) | ❌ | **Add** |
| Counters (iteration/escalation) | ✅ StageBanner badges + history + table | ❌ v2 `Outcome` has only `legacyCounter` | **Add (model extension)** |
| Live action preview ("who sees what") | n/a (authoring aid) | ❌ canvas has graph + validity only | **Add** |
| Workflow `description` | ❌ nothing renders it | ❌ | **Leave out** (dead) |
| `creationModalCardSubtitle` | ❌ nothing renders it | ❌ | **Leave out** (dead) |
| `flowType` editing | n/a | ❌ (set at creation) | **Defer** (risky: changes status defaults + lead semantics) |

**Decisions (confirmed with user):** full port **except** `flowType` editing (circle back later); **leave the two dead fields out** of the canvas (don't propagate config nothing renders). Everything below is additive and stays within the v2 model — `legacyCounter` keeps working, seeded flows are untouched.

## Implementation

### 1. Stage presentation fields — [NodeInspector.tsx](src/components/authoring/canvas/NodeInspector.tsx) (stage meta section, ~286-310)
Add three inputs alongside the existing Description + isTerminal:
- `shortDisplayName` — text, placeholder = `stage.displayName`.
- `headline` — text; hint below: "Supports `{leadRoleName}` and `{validatorTeamName}`." (these interpolate at render via `renderStageHeadline`).
- `hint` — text.
Each writes via the existing `onChangeStage({ ...stage, <field>: e.target.value })`. All three fields already exist on the `Stage` type — UI only.

### 2. Action button intent — [NodeInspector.tsx](src/components/authoring/canvas/NodeInspector.tsx) (action card, after the label row ~356)
Add a compact 4-option control (Primary / Success / Danger / Neutral) writing `patchAction(action, { intent })`. Reuse the swatch styling from the old `intentClass` map in [ActionPreviewRail.tsx:14-19](src/pages/WorkflowWizard/SideEditor/ActionPreviewRail.tsx#L14). `addAction` already seeds `intent: 'primary'`; this just makes it editable. Rendered by StageBanner/ActionModal already.

### 3. creationModalDescription — [WorkflowSettingsDrawer.tsx](src/components/authoring/canvas/WorkflowSettingsDrawer.tsx) (top meta block, ~98-115)
Add one textarea under the existing lead-label block (NOT in a tab — it's workflow meta), writing `onChange({ creationModalDescription: e.target.value })`. Label "New-project modal description", hint "Shown under the title when someone creates a project with this workflow." Do **not** add `description` or `creationModalCardSubtitle` (dead).

### 4. Native counters (model extension)
- **[types/v2.ts](src/types/v2.ts) `Outcome`** (~120): add `counter?: 'escalation' | 'iteration'` (sibling of the existing `legacyCounter`).
- **[executeOutcome.ts](src/lib/rules/executeOutcome.ts):181** change the bump to read either: `const counter = outcome.counter ?? outcome.legacyCounter; if (counter) patch[counter === 'iteration' ? 'iterationCount' : 'escalationCount'] = increment(1)`. (Project already has `iterationCount`/`escalationCount`; StageBanner/history/table already render them.)
- **[NodeInspector.tsx](src/components/authoring/canvas/NodeInspector.tsx)** outcome card (after the target dropdown, ~452): for `advance`/`branch` shapes only, add a Counter control (None / Iteration / Escalation) writing `setOutcome(action, o.id, { counter: v || undefined })`. (The canonical use is a self-loop "send back" bumping iteration, or an escalate edge bumping escalation.)
- No `outcomeAdapter` change needed — legacy synthesis still sets `legacyCounter`, and executeOutcome now honours both. No new validation required (advance/branch already require a target).

### 5. Live action preview ("who sees what") — new collapsible section in [NodeInspector.tsx](src/components/authoring/canvas/NodeInspector.tsx) (per selected stage, non-terminal only)
Rebuild the old [ActionPreviewRail](src/pages/WorkflowWizard/SideEditor/ActionPreviewRail.tsx) for the canvas, on the **v2** actor list:
- Viewer archetypes: each hierarchy `RoleDef` (sorted by level/order) as `{kind:'role', roleId}`, each project role as `{kind:'project_role', roleId}`, the lead `{kind:'pipeline_role', role:'lead'}`, and the creator `{kind:'creator'}`. (NodeInspector already receives `roles`, `org`, `leadRoleName`, `workflow.projectRoles`.)
- Visible actions = `stage.actions.filter(a => previewMatches(viewer, readActors(a).all))` — reuse `previewMatches` ([actorPreview.ts](src/lib/actorPreview.ts)) and `readActors` ([outcomeAdapter.ts](src/lib/rules/outcomeAdapter.ts)), rendering each as a chip styled by `intent`.
- **Known limitation (state in a code comment + a one-line UI note):** the preview is *symbolic* — it matches actor refs by identity and does NOT expand hierarchy downward-inheritance, mirroring the existing `previewMatches` contract ("preview-only, not real gating"). Accurate gating still lives in `canPerform`/`actorMatches` at runtime.

### 6. Canonical actor — "shows in My Tasks for" — [NodeInspector.tsx](src/components/authoring/canvas/NodeInspector.tsx) `ActorEditor` (~106-149)
The runtime already routes an action to the inbox of `actors[0]` only (the canonical actor); the rest of `actors[]` can perform it from the banner but are never nagged in /me ([workflowEvaluator.ts:210-220](src/lib/workflowEvaluator.ts#L210)). The canvas just doesn't expose which actor is canonical. **No model or runtime change** — purely reorder `actors[]` so the chosen one sits at index 0:
- On the canonical pill (the first), show a small badge — e.g. an inbox icon + "My Tasks" — and a tooltip "This action shows up in this person's My Tasks."
- On every other pill, add a "Make this the My Tasks owner" affordance (small inbox/pin icon button) that calls `onChange([picked, ...others])` to move it to index 0.
- When there is only one actor, it is implicitly canonical (still show the badge so the routing is legible).
- `readActors` ([outcomeAdapter.ts](src/lib/rules/outcomeAdapter.ts)) already returns `primary = actors[0]`, so the preview (#5) and runtime stay consistent for free.
Keep the section copy honest: "Anyone here can perform it; the marked one also gets it in their My Tasks."

## Out of scope (explicit)
- `flowType` editing (deferred — changes default status options + lead concept).
- Workflow `description` + `creationModalCardSubtitle` (dead fields; not propagated).
- Resurrecting the legacy `effect` UI — superseded by `outcomes[]`.

## Files
- **Edit:** [NodeInspector.tsx](src/components/authoring/canvas/NodeInspector.tsx) (stage fields + intent picker + counter control + preview section + ActorEditor canonical/My-Tasks marker), [WorkflowSettingsDrawer.tsx](src/components/authoring/canvas/WorkflowSettingsDrawer.tsx) (creationModalDescription), [types/v2.ts](src/types/v2.ts) (`Outcome.counter`), [executeOutcome.ts](src/lib/rules/executeOutcome.ts) (bump on `counter ?? legacyCounter`).
- **Reuse:** `renderStageHeadline` ([workflowEvaluator.ts](src/lib/workflowEvaluator.ts)), `previewMatches` ([actorPreview.ts](src/lib/actorPreview.ts)), `readActors`/`readOutcomes` ([outcomeAdapter.ts](src/lib/rules/outcomeAdapter.ts)), `describeActorShort` ([actorRefs.ts](src/lib/actorRefs.ts)), the `intentClass` swatch map pattern.

## Verification
1. `npm run build` clean (`tsc -b && vite build`).
2. **Presentation parity:** author a flow on the canvas — set a stage `headline` with `{leadRoleName}` + a `hint` + `shortDisplayName`; set an action's intent to Danger. Publish, create a project on it: the stage banner shows the interpolated headline + hint, the Danger button is red ([StageBanner.tsx](src/components/workflow/StageBanner.tsx)), and the pipeline funnel uses the short name.
3. **creationModalDescription:** set it in the drawer → it appears under the title in NewProjectModal; cleared → falls back to the derived sentence.
4. **Counters:** add a self-loop "send back" advance outcome with Counter = Iteration; perform it on a live project → `iterationCount` increments and the "Iteration N+1" badge shows on the banner. Repeat with Escalation. Confirm a seeded flow's legacy `transition_with_counter` still bumps (legacyCounter path intact).
5. **Preview:** select a stage in the inspector → switch viewer archetype (a hierarchy role, a project role, the lead, the creator) → the chips reflect exactly the actions whose `actors[]` include that archetype, styled by intent; terminal stages show the "no buttons" note.
6. **Canonical / My Tasks:** on an action with 2+ actors, mark a non-first actor as the My-Tasks owner → it moves to index 0, the badge follows it. Log in as a holder of that actor → the project appears in My Tasks; log in as a holder of a non-canonical actor → the action button still shows on the project banner but the project does NOT appear in their My Tasks. (Verifies the reorder drives [useProjectsAwaitingMyAction.ts](src/hooks/useProjectsAwaitingMyAction.ts) inbox routing.)
7. **Regression:** open a seeded system flow (read-only) → all new controls render disabled, nothing writes; the three reused sub-editors still work in the settings drawer.
