# Phase 1 — Org Structure Decoupling

## Context

The codebase currently encodes one specific organization's shape in code: a "Vertical Head" leadership role, hardcoded references to "CT lead signs off" and "the 2D team handles 2D work," and a fixed `WorkType` enum. This is fine for Client A but blocks every future tenant from being onboarded without a fork.

Phase 1's job is to take that org shape out of code and into a tenant-configured Firestore document. After phase 1, the existing 10-stage tender pipeline still runs identically for Client A — but the code reads "the validator team's lead signs off" and resolves "validator" through the org-structure config. New tenants (sales-only orgs, agencies with different team structures) configure their own org shape and the same engine renders accordingly.

Phase 1 builds on top of `admin-config-init`, which shipped the pipeline on/off toggle, per-stage toggles, the localStorage 24h-TTL cache, and the `/admin/config` screen gated to `super_admin` + `dhruv.sharma1@eventstrat.ai`. Phase 1 extends the same patterns rather than replacing them.

In-scope:

1. A new `/config/orgStructure` singleton doc.
2. A `teamRoleId` field added to `teams/{teamId}` and a generalized `workTypes: string[]` array replacing the singular `workType` field.
3. A conversational setup wizard at `/admin/setup` for first-time tenant onboarding.
4. An "Organization structure" section added to the existing `/admin/config` screen for ongoing edits.
5. A resolver helper (`lib/orgResolver.ts`) that replaces hardcoded "CT lead" / "2D team" lookups across the codebase.
6. Migration: a seed script that writes Client A's existing structure to the new shape.

Out of scope (later phases):

- Stage definitions, transitions, action button gating — stays code-defined, becomes data in phase 2a.
- Multi-pipeline support, per-pipeline shape, pipeline-per-head association — phase 2b.
- Pipeline authoring wizard — phase 2c.
- Pool-based and rule-based allotment — phase 3.
- Breakage warnings when org-structure edits would conflict with running pipelines — phase 2.
- Telemetry hooks for the eventual intelligence layer.

---

## Firestore schema — `/config/orgStructure` (new singleton doc)

Mirrors the `/config/appConfig` precedent shipped in `admin-config-init`.

```ts
// add to src/types/models.ts
export type TeamRoleId = 'coordinator' | 'validator' | 'specialist';

export interface OrgStructure {
  version: number;              // monotonic; bumped every save
  updatedAt: Timestamp;
  updatedBy: string;            // uid of last editor

  // What the tenant calls the people who lead projects.
  // Display string only — used in UI labels, never in conditional logic.
  leadRoleName: string;         // e.g. "Vertical Head", "Account Manager", "Project Lead"

  // Which team roles exist in this org. All three optional.
  teamRoles: {
    hasCoordinator: boolean;    // a team that handles client communication
    hasValidator: boolean;      // a team that reviews work before client delivery
    hasSpecialist: boolean;     // teams that produce the actual deliverables
  };

  // Work types the specialist teams handle.
  // Empty when hasSpecialist is false.
  workTypes: string[];          // e.g. ['2D', '3D', 'Video', 'Copy']

  // How owners get assigned to new projects.
  // Phase 1 only supports 'manual'; the others appear in UI as "coming soon".
  allotment: {
    mode: 'manual';
  };

  // First-time setup completion. Drives whether the wizard auto-launches.
  setupCompleted: boolean;
}
```

### Defaults when doc missing

```ts
const DEFAULT_ORG_STRUCTURE: OrgStructure = {
  version: 0,
  leadRoleName: 'Project Lead',
  teamRoles: { hasCoordinator: false, hasValidator: false, hasSpecialist: false },
  workTypes: [],
  allotment: { mode: 'manual' },
  setupCompleted: false,
};
```

The default shape is intentionally **minimal**, not tender-shaped. A fresh tenant who hasn't run setup gets owner-only behavior — which is what makes phase 1 simultaneously support both Client A (full tender flow, populated via the seed script) and new tenants doing simpler work.

### Why separate from `/config/appConfig`

Both could live in one doc. Keeping them separate buys two things:

- Independent versioning. Org structure changes are rare (~once a quarter); app config changes are more frequent. Bumping `version` on every appConfig save shouldn't invalidate org-structure caches.
- Independent edit surfaces. The setup wizard writes only to org-structure; the existing admin config screen writes only to app-config until phase 1's edit section ships. No write contention, no merge logic.

The localStorage cache pattern stays identical: `orgStructure:v1` key, 24h TTL, cross-tab sync via storage events. Same code, parallel implementation in `AppConfigContext`.

---

## Schema changes to existing `teams/{teamId}`

Two field changes, both with backfill:

```ts
export interface Team {
  // ... all v1 fields unchanged

  // New: which role this team plays in the org. Null = uncategorized.
  // Replaces the old `kind: 'department' | 'horizontal'` field.
  teamRoleId: TeamRoleId | null;

  // Generalized: a team can specialize in multiple work types.
  // Replaces the old singular `workType?: WorkType`.
  workTypes: string[];          // empty when teamRoleId !== 'specialist'
}
```

The old `kind` field stays in the doc but stops being read by the application code after phase 1 ships. Removing it is a separate, low-priority cleanup. The old `workType` field gets migrated into `workTypes: [oldValue]` by the backfill script.

---

## Provider / hooks — extending `src/contexts/AppConfigContext.tsx`

The existing context already manages cached config with 24h TTL and cross-tab sync. Extend it rather than creating a parallel context — fewer providers, single source of truth.

```ts
// New hooks exposed from AppConfigContext
export function useOrgStructure(): OrgStructure;
export function useLeadRoleName(): string;
export function useHasCoordinator(): boolean;
export function useHasValidator(): boolean;
export function useHasSpecialist(): boolean;
export function useWorkTypes(): string[];
export function useSetupCompleted(): boolean;

// Non-React snapshot for use in lib/firestore.ts writes
export function getOrgStructureSnapshot(): OrgStructure;
```

Internals reuse the same localStorage primitive, `useState(() => readLocalStorage())` for sync first-render, `useEffect` for TTL-checked refresh, `onSnapshot` swap when the admin screen mounts.

---

## Resolver — new file `src/lib/orgResolver.ts`

This is the single most important file in phase 1. It replaces every hardcoded "find the CT team" or "find the 2D team's lead" in the codebase with config-driven lookups.

```ts
// Pure functions — take teams + orgStructure, return team(s) or user(s).
// Called from React via custom hooks; called from non-React via snapshot helpers.

export function resolveCoordinatorTeam(teams: Team[]): Team | null;
export function resolveValidatorTeam(teams: Team[]): Team | null;
export function resolveSpecialistTeams(teams: Team[], workType?: string): Team[];

export function resolveLeadOf(team: Team | null, users: User[]): User | null;

// Convenience composites used by permission flags
export function resolveValidatorLead(teams: Team[], users: User[]): User | null;
export function resolveCoordinatorLead(teams: Team[], users: User[]): User | null;
```

Resolution rules:

- **Coordinator**: first team where `teamRoleId === 'coordinator'`. If the tenant has multiple, the first by `createdAt` wins. Phase 1 doesn't support multiple coordinator teams as a feature; that's a phase 2 question.
- **Validator**: same shape, first team where `teamRoleId === 'validator'`. Returns null if `orgStructure.teamRoles.hasValidator === false` — the resolver is the single place to honor the "validator absent" case.
- **Specialist by workType**: all teams where `teamRoleId === 'specialist'` AND `team.workTypes.includes(workType)`. Returns an array because multiple teams may share a work type (e.g., two 2D teams).

When the resolver returns null (no validator team configured, or no specialist team for the requested work type), the calling code is responsible for deciding what to do — show no button, fall back to a different actor, etc. Phase 1 keeps these decisions in the calling sites; phase 2 may consolidate them into the workflow engine.

---

## The setup wizard — new files under `src/pages/OrgSetupWizard/`

A conversational, single-question-per-screen flow in the visual language of the existing event-app setup screens — assistant bubble on the left, user reply bubbles on the right above the current question, progress bar at the top.

### Entry points

- **First-time auto-launch**: on app boot, if `orgStructure.setupCompleted === false` AND the user is `super_admin`, redirect from `/` to `/admin/setup`. Non-super-admin users see the app in default-minimal state until a super_admin completes setup. (For Client A, the seed script sets `setupCompleted: true` so this doesn't auto-launch.)
- **Re-run from config**: a "Re-run setup" link on the `/admin/config` Organization-structure section, gated to super_admin. Clicking it shows a one-line confirmation ("This walks you through setup again. Your current settings stay until you save new ones at the end.") then routes to `/admin/setup`.

### Step 1 — Leadership role name

**Assistant**: "Let's set up your organization. First — who runs projects at your company? Most companies have one person who owns each project end-to-end. What do you call them?"

**Input**: Text field, pre-filled with `"Project Lead"`. Below the field, suggestion chips: `Account Manager`, `Practice Lead`, `Vertical Head`, `Sales Manager`, `Department Head`. Tapping a chip replaces the field value.

**Validation**: Non-empty, max 50 chars. No spaces-only.

**Why pre-filled**: A super admin who has never thought about this question doesn't want to invent terminology. Pre-fill invites review; empty field demands invention.

### Step 2 — Team types

**Assistant**: "Now your teams. Different companies are organized differently — tick the kinds of teams you have. Skip the ones you don't."

**Input**: Three toggle cards stacked vertically. Each card has a name, a one-sentence description, and a real-world example. None pre-selected — this is the one screen where defaults could mislead, since the answer is genuinely org-specific.

- **A team that handles client communication and coordination** — *Sometimes called Client Servicing, Account Management, or Project Coordination. They're the bridge between your clients and your internal teams.*
- **A team that reviews work before it goes to the client** — *Sometimes called Quality Check, Strategy Review, or Editorial. They make sure deliverables are right before they ship.*
- **Specialist teams that produce the actual work** — *Like Design, Video Editing, Copy, or whatever your craft teams are called. Tick this if you have one or more.*

**Hint at bottom**: "Not sure? You can skip this and set it up later."

**Validation**: None — all-empty is a valid answer (this is what a single-rep sales org would pick).

### Step 3 — Work types (conditional)

Only shown if Step 2's third toggle (specialist teams) is on. Otherwise skipped silently.

**Assistant**: "What kinds of work do your specialist teams handle? Add as many as fit."

**Input**: A chip add/remove. Suggestion chips below the input: `2D Design`, `3D Design`, `Video Editing`, `Motion Graphics`, `Copywriting`, `Set Design`, `AV`, `Photography`. Tapping a suggestion adds it; tapping an added chip removes it. Free-text addition via "+ Add custom" input.

**Validation**: At least one work type if this step is shown.

### Step 4 — Team mapping (optional)

**Assistant**: "Here are your existing teams. Tell me what each one does — or skip any you're not sure about. You can map them later from the config screen."

**Input**: A list of team rows, pulled from `/teams`. Each row shows the team name and a dropdown:
- "Client coordination" (only shown if Step 2's coordinator toggle is on)
- "Reviews work" (only if validator toggle is on)
- "Specialist team" (only if specialist toggle is on)
- "Skip for now" (default selection)

When "Specialist team" is selected, a second row appears: a multi-select for which work types this team handles, populated from the workTypes added in Step 3.

**Empty state**: If `/teams` is empty (fresh tenant), the assistant says "You haven't created any teams yet — that's fine. You can map teams to roles after you create them." and the step auto-advances.

**Validation**: None. Every team can be "Skip for now."

### Step 5 — Allotment

**Assistant**: "Last question. When a new project is created, how does it get assigned to a project lead?"

**Input**: Three radio cards.
- **Manual** *(default, selected)* — "Someone picks the lead when creating each project." *Available now.*
- **Pool** — "Projects sit in a queue; leads pick what they want." *Coming soon — available in a future update.* *(card is visually subdued, radio disabled)*
- **Auto** — "Rules decide automatically based on workload, expertise, or territory." *Coming soon.* *(card is visually subdued, radio disabled)*

**Why all three are shown despite only Manual being available**: signals the roadmap to the super admin, manages expectations, primes the language for phase 3.

### Step 6 — Review

**Assistant**: "Here's how we'll set up your organization. Anything you want to change?"

**Layout**: A summary card with four sections, each with an "Edit" link that jumps back to the relevant step:

- **Leadership** — "You call them: Vertical Head"
- **Teams** — "You have: A coordination team, a review team, and specialist teams" (omits absent types)
- **Work types** — "Your specialists do: 2D Design, 3D Design, Video Editing" (only if specialist=true)
- **Project assignment** — "Manual — someone picks the lead when creating each project"

Below the summary: **[Back]** and **[Finish setup]**.

On finish: write to Firestore in a single batch — `/config/orgStructure` doc with `setupCompleted: true, version: 1`, plus per-team updates for any teams mapped in Step 4. Toast: "Setup complete." Redirect to `/`.

### Across all steps

- Persistent **[Skip]** button on every step (except Step 6) — fills in defaults and jumps to review.
- Persistent **[Back]** button on every step except Step 1.
- Progress bar at top: "Step N of 6."
- Saved wizard state lives in component state — leaving and re-entering mid-wizard restarts from Step 1. (Persisting in-progress state is a phase 2 polish, not needed now.)
- Visual style: dark gradient background matching the existing event-app screenshots, assistant orb in the header, conversational bubbles, soft-purple accent for primary CTAs.

---

## Edit surface on `/admin/config`

The wizard handles first-time setup. Ongoing edits happen on the regular config screen. Add a new "Organization structure" section above the existing pipeline section.

### Section layout

- **Heading**: "Organization structure"
- **Subheading**: "How your org is shaped. Pipelines and stages use this — change something here and you may need to update pipelines that reference it."

Sub-sections, each a card:

1. **Leadership role name** — text input pre-filled with current value, save-on-blur.
2. **Team types** — three toggles for coordinator / validator / specialist. Toggling one off doesn't delete the field; it just hides downstream surfaces. (Deletion-with-confirmation is a phase 2 problem.)
3. **Work types** — chip add/remove, identical UX to Step 3 of the wizard.
4. **Team mapping** — table of teams with role + work-type dropdowns. Same UX as Step 4. Inline-editable.
5. **Allotment** — radio cards. Manual selectable, others disabled with "Coming soon."

Footer of the section: **[Re-run setup wizard]** link, super_admin only.

### Edit semantics

- All edits are saved on blur (text inputs) or on toggle/select (radio, dropdown).
- Each save bumps `orgStructure.version` and updates `updatedAt` / `updatedBy`.
- No breakage warnings in phase 1 — there are no flows yet that could be broken. Phase 2 adds the dependency check ("you're about to disable the validator role, but the Tender pipeline references it — review the pipeline before saving").

---

## Touchpoints — files that read org structure

| File | Change |
| --- | --- |
| `src/types/models.ts` | Add `OrgStructure`, `TeamRoleId` types. Update `Team` interface: `teamRoleId`, `workTypes`. Mark old `kind` and `workType` as `@deprecated`. |
| `src/contexts/AppConfigContext.tsx` | Add org-structure state, hooks, snapshot helper. Same TTL/cross-tab pattern as appConfig. |
| `src/lib/orgResolver.ts` (NEW) | All resolver functions. Pure, no React dependencies. |
| `src/lib/firestore.ts` | `addProject`: read `getOrgStructureSnapshot()`. Use `leadRoleName` only for UI; behavior is unchanged. `setProjectVh` (or wherever VH allocation lives): no longer reads global role `'admin'` to find candidates — reads `orgStructure` to know whether a lead role exists at all. |
| `src/hooks/usePermissions.ts` | Every hardcoded check ("user is on the CT team and is its lead") rewritten as `resolveValidatorLead(teams, users)?.uid === user.uid`. Permission flags become null-aware: `canSignOffValidation` returns false if `resolveValidatorTeam` returns null. |
| `src/components/tender/StageBanner.tsx` | The sign-off button visibility check goes through the resolver. The button label still says "Validate" but the actor that owns it is now config-driven. |
| `src/components/admin/NewProjectModal.tsx` | Replaces literal "Vertical Head" string with `useLeadRoleName()`. The VH-picker dropdown stays for now (still defaults to global-role `'admin'` users); making the lead-role pool configurable is a phase 2 task. |
| `src/pages/ProjectDetail.tsx` | The "VH" row label uses `useLeadRoleName()`. Submission/presentation date fields stay tied to `pipelineEnabled` until phase 2 moves them to per-workflow config. |
| `src/components/admin/AdminActionBar.tsx` | Already reads `useCreateProjectLabel()` from `admin-config-init`. No change. |
| `src/pages/AppConfigPage.tsx` | Add the Organization-structure section described above. |
| `src/pages/OrgSetupWizard/` (NEW) | Wizard pages — one component per step plus a parent that handles routing between them. |
| `src/App.tsx` | Add `/admin/setup` route under `DevConfigRoute` (super_admin + email guard). |
| `src/main.tsx` | No change — `AppConfigProvider` already exists and gets the org-structure extension internally. |
| `src/components/Navbar.tsx` | No change — wizard isn't navbar-accessible; it's reached via auto-launch or the config screen. |

### What stays untouched

The 10-stage definitions, stage transition logic in `lib/firestore.ts`, stage history rendering, the audit-event approach, individual stage modals (`AllocateVhModal`, `AcceptOrEscalateModal`, etc.), the `/admin/config` pipeline-toggle section shipped in `admin-config-init`, Firestore collection names, URL paths. All phase 2 problems.

---

## Migration — seed script for Client A

New file: `scripts/seed-org-structure.ts`. Run once against the existing Firebase project.

```ts
// Writes Client A's org structure matching today's hardcoded behavior.
const clientA: OrgStructure = {
  version: 1,
  updatedAt: serverTimestamp(),
  updatedBy: '<bootstrap super admin uid>',
  leadRoleName: 'Vertical Head',
  teamRoles: { hasCoordinator: true, hasValidator: true, hasSpecialist: true },
  workTypes: ['2D', '3D', 'Video'],
  allotment: { mode: 'manual' },
  setupCompleted: true,
};

// Plus per-team backfill:
const teamBackfill = [
  { name: 'Client Servicing — Marcom',  teamRoleId: 'coordinator', workTypes: [] },
  { name: 'Copy & Strategy',            teamRoleId: 'validator',   workTypes: [] },
  { name: '2D Graphic Design',          teamRoleId: 'specialist',  workTypes: ['2D'] },
  { name: '2D & 3D Events',             teamRoleId: 'specialist',  workTypes: ['3D'] },
  { name: 'Video Editing',              teamRoleId: 'specialist',  workTypes: ['Video'] },
];
```

The script does a `getDocs` over `/teams`, matches by `name`, and updates each. Teams that don't match a backfill entry get `teamRoleId: null` and `workTypes: []` (uncategorized — they keep working as v1 teams but don't participate in tender-specific stages).

**Without this script, Client A's stage 7 sign-off button silently disappears** because the resolver finds no validator team. Run it before deploying phase 1 to production.

---

## Critical files (new)

- `src/types/models.ts` — `OrgStructure`, `TeamRoleId` types, updated `Team` interface.
- `src/lib/orgResolver.ts` — pure resolver functions.
- `src/pages/OrgSetupWizard/index.tsx` — wizard parent, step routing.
- `src/pages/OrgSetupWizard/Step1LeadRole.tsx` through `Step6Review.tsx` — one file per step.
- `src/pages/OrgSetupWizard/components/AssistantBubble.tsx`, `UserBubble.tsx`, `WizardShell.tsx` — wizard primitives.
- `scripts/seed-org-structure.ts` — Client A migration script.

## Critical files (modified)

- `src/contexts/AppConfigContext.tsx` — org-structure state and hooks added.
- `src/lib/firestore.ts` — `addProject` and lead-allocation helpers consult org structure.
- `src/hooks/usePermissions.ts` — every hardcoded team-type check rewritten to use the resolver.
- `src/components/tender/StageBanner.tsx` — sign-off button gating via resolver.
- `src/components/admin/NewProjectModal.tsx` — uses `useLeadRoleName()`.
- `src/pages/ProjectDetail.tsx` — uses `useLeadRoleName()`.
- `src/pages/AppConfigPage.tsx` — Organization-structure section added.
- `src/App.tsx` — `/admin/setup` route.

## Reused existing patterns

- `/config/appConfig` localStorage cache and provider pattern from `admin-config-init` — copied verbatim for org structure.
- `DevConfigRoute` from `admin-config-init` — wraps `/admin/setup` too.
- `writeBatch` + audit-event pattern in `lib/firestore.ts` — wizard final save uses it.
- `STAGE_NAMES` constants pattern — `WORK_TYPE_SUGGESTIONS` constant lives next to them in `models.ts` for use in the wizard's suggestion chips.

---

## Verification

1. **Fresh tenant (no `/config/orgStructure` doc, no `setupCompleted`)**:
   - Sign in as super_admin. App redirects to `/admin/setup`.
   - Walk through all six steps. Every "Skip" lands cleanly. Back/forward navigation preserves entered values.
   - Finish wizard. Verify `/config/orgStructure` doc exists with the values entered.
   - Verify no auto-redirect to wizard on next sign-in.

2. **Client A (after seed script runs)**:
   - Sign in as `taskmanager@ai.com`. No wizard redirect (`setupCompleted: true`).
   - App behaves identically to pre-phase-1: stage banners, "Vertical Head" labels, sign-off button on stage 7 for the CT lead.
   - Verify by reading the resolver paths in DevTools: `resolveValidatorTeam` returns the Copy & Strategy team, `resolveValidatorLead` returns its current lead user.

3. **Resolver fallback (no validator configured)**:
   - In `/admin/config` Organization-structure section, turn off "A team that reviews work."
   - Save. Verify stage 7's sign-off button no longer renders for any user.
   - Turn it back on, save. Button reappears for the validator team's lead.

4. **Edit a single field**:
   - Change `leadRoleName` from "Vertical Head" to "Account Manager" in the config screen.
   - Verify the change appears in `ProjectDetail`'s VH row label, `NewProjectModal`'s allocation modal, and the AdminActionBar CTA after a page reload (or immediately, depending on the cross-tab event).
   - Stage logic still works — the rename is display-only.

5. **Re-run wizard**:
   - Click "Re-run setup wizard" in the config screen. Confirm the warning dialog appears.
   - Walk through with different choices. On finish, verify the doc reflects the new values, version bumped.

6. **Cache TTL** (reuses `admin-config-init` verification):
   - Inspect `localStorage.getItem('orgStructure:v1')`. Manually set `fetchedAt` to 25h ago. Reload — observe one `getDoc` for `/config/orgStructure`.

7. **Cross-tab sync**:
   - Two tabs open. Save org-structure changes in tab A. Tab B's UI reflects the change within ~1s without a Firestore read.

8. **Wizard auto-skip when no teams exist**:
   - Wipe `/teams`. Run the wizard. Step 4 shows the empty-state message and auto-advances after a beat.

9. **Allotment options**:
   - Verify Manual is the only selectable option. Pool and Auto are visible but disabled with "Coming soon."
   - Saved orgStructure has `allotment.mode: 'manual'`.

---

## Open questions / decisions

These are minor enough to decide during implementation; flagging so they don't surprise the reviewer.

- **Multiple coordinator or validator teams**: phase 1's resolver returns the first by `createdAt`. If a tenant maps two teams as coordinator, the second is silently ignored at runtime. Surface this as a warning in the config screen's team-mapping table? Or accept the silent behavior? Recommend warning.
- **Wizard mid-flow state persistence**: if a super_admin leaves the wizard halfway, do we preserve their answers (localStorage) or restart? Phase 1 restarts (simpler). If reviewers think this is hostile, change to localStorage-backed.
- **Visibility of the Re-run setup button**: super_admin + dev-email gate (same as `/admin/config`), or super_admin only? Recommend super_admin + dev-email — phase 1's setup is still operator-managed, not tenant-self-service.

---

## What ships after phase 1

After phase 1 ships and the Client A migration runs:

- Client A continues to run the full tender flow, with all behavior preserved.
- A new tenant (Expressions 360, sales-side teams, anyone) can run the setup wizard and have their org configured in 3 minutes.
- The codebase no longer hardcodes "CT," "2D team," or "Vertical Head" anywhere that affects behavior. Strings flip, lookups resolve through config.
- The door is open to phase 2a — moving stage definitions themselves out of code — without further refactor of permissions or stage banner.

Phase 1 itself is shippable in roughly **2-3 weeks** of focused work.

---

## Addendum — Step 4 onboarding enhancements (added post-launch)

> **Note:** This section was added after the original phase 1 doc above shipped. The behavior described in **Step 4** (under "The setup wizard") and **Verification #8** ("Wizard auto-skip when no teams exist") was changed by this addendum. Read this section as the current source of truth for those flows; the original prose above is preserved verbatim for historical context.

### Why this changed

The original Step 4 empty state was passive: when a tenant reached Step 4 with no teams configured, the wizard showed a one-line "you haven't created any teams yet" message and auto-advanced to Step 5 after ~1.5 s. That left a brand-new tenant in a half-configured state — they had an org shape, but no teams to map roles to, no clear next action, and `setupCompleted: true` would have been written without a single role-bearing team in Firestore. Every resolver call (`resolveValidatorTeam`, `resolveCoordinatorTeam`, `resolveSpecialistTeams`) returned null/empty, so downstream stage banners silently degraded.

The addendum gives the operator two clear paths to bootstrap teams right inside Step 4, plus visual nudges in the mapping UI to make role assignment fast and reversible.

### What the operator sees in the empty state

The 1.5 s auto-advance is removed. With zero teams, Step 4 renders an assistant bubble:

> *"Oh, you don't have any teams set up yet — let's get you started. Pick a path below, or skip this step and come back to it later from `/admin/config`."*

Two CTA cards inside the bubble:

1. **Quick start with sample teams** — opens an inline checkbox list of five generic event/agency teams (described below). All checked by default. The operator can uncheck any they don't want and click "Seed N teams." Each team is created in Firestore with `leadId: ''` and `memberIds: []`. The operator assigns leads later from the team page (see "No-lead banner" below).
2. **Add my own teams** — opens an inline name + description form. "Add team" creates a single team (also lead-less), clears the inputs, increments a "Added N teams" counter, and stays open for the next addition. The operator can keep adding until they hit Back.

The wizard footer in the idle empty state shows **[Back] [Skip] [Continue without teams]** so the operator can also bail out without seeding anything — explicit, not auto-advanced.

### Generic seed teams + recommended role mappings

A new module `src/lib/seedTeamsGeneric.ts` exports the seed catalog and the helpers. Team descriptions are kept verbatim from `seedTender.ts` because they generalize cleanly to the event industry; the names are generalized so they don't pre-brand a new tenant as "Client Servicing — Marcom" before they've made a single decision.

| Key | Name | Recommended role | Recommended work types |
| --- | --- | --- | --- |
| `client-servicing` | Client Servicing | coordinator | — |
| `copy-strategy` | Copy & Strategy | validator | — |
| `graphic-design` | Graphic Design | specialist | `2D Design` |
| `events-design` | Events Design | specialist | `3D Design`, `Set Design` |
| `video-editing` | Video Editing | specialist | `Video Editing`, `Motion Graphics`, `AV` |

After a successful seed, the wizard:

1. Populates `draft.teamMappings[teamId]` with `{ roleId, workTypes }` for each seeded team, filtered against the role toggles the operator chose in Step 2 (a `specialist` recommendation is dropped if `hasSpecialist === false`) and against the work types they configured in Step 3 (a recommended `'3D Design'` work type is dropped if the operator never added it).
2. Mirrors the same `{ roleId, workTypes }` into a new `draft.recommendedMappings` (also keyed by `teamId`) — this is the "as-suggested" reference that drives the badges below. It's wizard-local state and is never persisted to Firestore on Finish.

The seed helper is **idempotent** (matches by team name) so re-running with the same selection is safe.

### New WizardDraft field

`useWizardState.ts` adds one field. `readDraft` backfills it onto older drafts so existing localStorage entries keep working.

```ts
recommendedMappings: Record<string, { roleId: TeamRoleId; workTypes: string[] }>
```

### Mapping UI affordances (visible once teams exist)

The regular Step 4 list now renders the following on each row:

- **"Suggested" pill** — shown when `draft.teamMappings[teamId]` exactly matches `draft.recommendedMappings[teamId]`. Disappears the moment the operator changes the role or work-type selection on that row.
- **"Restore suggestion" inline link** — shown when a recommendation exists for the row but the current mapping no longer matches. Clicking restores both `roleId` and `workTypes` to the recommended values.
- **"No lead" pill** — shown whenever `team.leadId === ''`. Independent of recommendations; renders for any lead-less team, seeded or manually added.

Below the list:

- **"+ Add another team"** — toggles an inline name + description form so the operator can keep adding without leaving Step 4 (uses the same `createBareTeam` helper as the empty-state manual path).
- **"Reset all mappings"** — only rendered when ≥1 row has a role selected. Clears `draft.teamMappings` to `{}`. `recommendedMappings` is untouched, so the "Restore suggestion" link reappears on previously seeded rows.

The opening assistant bubble adapts: when `recommendedMappings` has entries, it reads *"I've pre-filled the suggested roles below. Adjust anything that doesn't fit, or hit Continue"* instead of the original prompt.

### No-lead banner on `/teams/:id`

Because both seed and manual paths create lead-less teams, `TeamDetail.tsx` shows a warning banner whenever `team.leadId === ''`. The banner's CTA adapts to the viewer and roster state:

| Viewer | Roster state | Banner CTA |
| --- | --- | --- |
| Admin / super_admin | Empty | "Add at least one member, then promote them to team lead." Inline **Add member** button opens the existing `AddTeamMemberModal`. |
| Admin / super_admin | Has members | "Promote a member to team lead from the list below." No button — the existing per-member **Make lead** action in the roster does the job (it becomes visible for every member when `team.leadId === ''`). |
| Non-admin | Any | Passive line: "An admin needs to assign someone before this team can own work." No CTA. |

### Files added / modified by the addendum

**New**

- `src/lib/seedTeamsGeneric.ts` — `GENERIC_SEED_TEAMS` constant, `seedSelectedGenericTeams(adminUid, keys)`, `createBareTeam(adminUid, name, description)`.

**Modified**

- `src/pages/OrgSetupWizard/Step4TeamMapping.tsx` — full rewrite of the empty-state path; addition of "Suggested" / "Restore suggestion" / "No lead" pills, "+ Add another team" inline form, "Reset all mappings" link.
- `src/pages/OrgSetupWizard/useWizardState.ts` — `recommendedMappings` field on `WizardDraft` + backfill in `readDraft`.
- `src/pages/OrgSetupWizard/index.tsx` — wires the new `recommendedMappings` / `onRecommendedMappingsChange` props through to Step 4.
- `src/pages/TeamDetail.tsx` — no-lead warning banner with role-aware CTA.

### Updated verification

The original Verification #8 (*"Wizard auto-skip when no teams exist"*) is superseded by these scenarios:

8a. **Empty-state two-path UX** — wipe `/teams`, run the wizard, reach Step 4. The assistant bubble shows two CTA cards. No auto-advance fires. Footer reads "Continue without teams."

8b. **Quick-start seed with recommendations** — click "Quick start with sample teams," uncheck *Events Design*, click "Seed 4 teams." Verify: four team docs created in `/teams` with empty `leadId`/`memberIds`; `draft.teamMappings` populated with the four recommended `{roleId, workTypes}` entries (filtered against the Step 2 / Step 3 selections); regular mapping list renders with a "Suggested" pill on every seeded row and a "No lead" pill on each.

8c. **Recommendation override** — change one seeded row's role select away from its suggestion. The "Suggested" pill disappears, a "Restore suggestion" link appears. Click it — the row reverts.

8d. **Manual add inside Step 4** — from the empty state, choose "Add my own teams," add two teams. Switch back to the regular list (which now renders because teams exist) and use "+ Add another team" to add a third. All three appear in `/teams` with empty leads. None show a "Suggested" pill — they were not seeded.

8e. **Reset all mappings** — with any mappings populated, click "Reset all mappings." `draft.teamMappings` becomes `{}`; "Restore suggestion" reappears on every previously seeded row.

8f. **No-lead banner on TeamDetail** — open any seeded or manually-added team. Verify the yellow "No team lead assigned" banner renders with the role-aware CTA from the table above. After promoting a member to lead (via the existing roster UI), the banner disappears.

### Notes for future phases

- The five seed teams' names and descriptions are intentionally event/agency-flavored. A truly domain-agnostic preset (Operations / Production / Review / Delivery) was considered and deferred — most current pipeline targets are agencies, so the event-industry shape is the highest-value default. If the tenant base broadens, swap `GENERIC_SEED_TEAMS` for a configurable preset registry rather than editing the constant in place.
- The "Suggested" badge logic compares against `recommendedMappings` only for seeded teams — manually-added teams never get a recommendation. Future work could compute heuristic recommendations from the team name (e.g. "Design" → specialist + 2D Design) but that's out of scope here.
- `recommendedMappings` is wizard-local. It is **not** written to Firestore on Finish. Only `teamMappings` flow into per-team `teamRoleId` / `workTypes` updates in the final batch.
