# Phase 1 — Org Structure Decoupling: Verification Guide

This is the end-to-end check-list to run before declaring phase 1 shippable.
Every scenario below is independent — failures don't gate the others, but
all must pass before deployment.

Run against a **dev** Firebase project (not production). Reset state between
scenarios where noted.

## Pre-flight

```bash
# Type-check is clean
npx tsc --noEmit

# Production build succeeds
npx vite build

# Grep audit — only seedTender.ts (Client-A intentional) and an example
# comment in models.ts should appear
git grep -nE "(Vertical Head|VH pool|Copy & Strategy|Client Servicing|2D team|2D Graphic|2D & 3D Events)" -- 'src/*'

# Resolver-replacement audit — should show only resolveValidatorTeam /
# resolveCoordinatorTeam usage, no remaining ctTeam/csTeam/regex lookups
git grep -nE "(ctTeam|csTeam|isCtLead|isCsLead|isCtMember|/copy\|strategy|/client servicing)" -- 'src/*'
```

## Dev server

```bash
npm run dev
# In another shell, sign in via the local URL (typically http://localhost:5173)
```

## Reset helpers (run from DevTools console while signed in)

```js
// Wipe the org-structure doc (forces fresh-tenant auto-launch on next reload).
const { doc, deleteDoc } = await import('firebase/firestore')
const { db } = await import('/src/lib/firebase.ts')
await deleteDoc(doc(db, 'config', 'orgStructure'))

// Clear localStorage caches.
localStorage.removeItem('orgStructure:v1')
localStorage.removeItem('appConfig:v1')
// Wizard draft (replace <uid> with your actual uid).
localStorage.removeItem('orgSetupWizard:v1:<uid>')
```

---

## Verification matrix

### 1. Fresh tenant auto-launch
- **Setup**: Run the wipe helper above; reload.
- **Steps**: You should be signed in already; observe landing behavior.
- **Pass**: Redirected from `/` to `/admin/setup` automatically. Page shows
  the lottie orb, "Set up your organization" header, "Step 1 of 6" progress
  bar, and Step 1 (leadership role) prompt.

### 2. Wizard happy path
- **Setup**: After #1.
- **Steps**: Walk through all six steps with realistic answers. Tick all
  three team-types in Step 2. Add a few work types in Step 3. Map 1–2 teams
  in Step 4. Hit Continue through Step 5. Hit Finish in Step 6.
- **Pass**: Loading overlay shows three substeps ticking through. Redirects
  to `/`. Inspect Firestore — `/config/orgStructure` exists with the entered
  values, `setupCompleted: true`, `version: 1`, `updatedBy: <your uid>`.
  Reload `/` — no re-redirect.

### 3. Skip every step
- **Setup**: Re-run the wipe helper, reload.
- **Steps**: From step 1, hit Skip immediately. Confirm navigation to `/`.
- **Pass**: Skip closes the wizard without writing the doc. The doc still
  doesn't exist; auto-launch fires again on reload.

### 4. Mid-flow exit & resume
- **Setup**: Wipe doc, reload.
- **Steps**: Fill Step 1, hit Continue. Toggle Step 2's three cards (any
  combination). Close the tab without finishing. Reopen `/admin/setup`.
- **Pass**: Wizard resumes on Step 3 (or Step 4 if specialist toggle was
  off) with the Step 1 + Step 2 values intact.
  DevTools → Application → Local Storage → check for
  `orgSetupWizard:v1:<uid>` entry containing the draft.

### 5. localStorage cleared on finish
- **Setup**: Complete a wizard run (scenario #2).
- **Pass**: `localStorage.getItem('orgSetupWizard:v1:<uid>')` returns null;
  `localStorage.getItem('orgStructure:v1')` is populated.

### 6. Client A migration
- **Setup**: Sign in as the Client A super_admin (`taskmanager@ai.com` or
  whatever your dev seed uses). Run from DevTools console:
  ```js
  const mod = await import('/src/lib/seedOrgStructure.ts')
  const result = await mod.seedClientAOrgStructure('<your uid>')
  console.log(result)
  ```
- **Steps**: Reload. Navigate to `/admin/config`. In the new "Organization
  structure" section, locate the "Team mapping" sub-section. For each
  existing team, pick a role:
  - Client Servicing — Marcom → Client coordination
  - Copy & Strategy → Reviews work
  - 2D Graphic Design → Specialist team, work types: 2D
  - 2D & 3D Events → Specialist team, work types: 3D
  - Video Editing → Specialist team, work types: Video
- **Pass after mapping**:
  - Open a stage-7 project as the Copy & Strategy lead. Banner shows the
    "Validation complete — sign off" button.
  - Stage 8 headline reads "Vertical Head reviewing with Copy & Strategy".
  - Stage 8 hint reads "The Vertical Head is reviewing the deliverable with
    Copy & Strategy."

### 7. Resolver fallback (no validator configured)
- **Setup**: After #6.
- **Steps**: In `/admin/config` → Organization structure → Team types →
  toggle "Reviews work" off.
- **Pass**: Reload the stage-7 project — sign-off button is gone for every
  user. Stage 8 headline falls back to "Vertical Head reviewing the
  deliverable" (no team name). Toggle back on — button reappears for the
  Copy & Strategy lead.

### 8. Edit single field — leadRoleName
- **Setup**: After #6.
- **Steps**: In `/admin/config` → Organization structure → Leadership role
  name → change "Vertical Head" to "Account Manager" → click outside the
  input (blur).
- **Pass within ~1s** (no reload needed in the same tab, or cross-tab via
  storage event):
  - `ProjectDetail`'s "Vertical Head" row label reads "Account Manager".
  - "+ New Tender" modal description reads "You'll allocate an Account
    Manager once it's created."
  - `AllocateVhModal` title reads "Allocate to Account Manager".
  - Stage 8 headline reads "Account Manager reviewing with Copy & Strategy".
  - The Members page role select shows "Admin (Account Manager pool)".

### 9. Re-run wizard
- **Setup**: After #6.
- **Steps**: In `/admin/config` → Organization structure footer → click
  "Re-run setup wizard". Walk through with a different leadRoleName
  ("Project Director"). Hit Finish.
- **Pass**: `/config/orgStructure.leadRoleName` updates to "Project
  Director", `version` increments. Labels propagate immediately.

### 10. Cache TTL
- **Setup**: Any time after the cache has populated.
- **Steps**: In DevTools console:
  ```js
  const k = 'orgStructure:v1'
  const entry = JSON.parse(localStorage.getItem(k))
  entry.fetchedAt = Date.now() - 26 * 3600 * 1000
  localStorage.setItem(k, JSON.stringify(entry))
  ```
  Reload.
- **Pass**: Network panel shows exactly one `getDoc` to
  `/config/orgStructure`.

### 11. Cross-tab sync (no Firestore read)
- **Setup**: Open `/admin/config` in tab A; a project page in tab B.
- **Steps**: In tab A, toggle "Specialist teams" off in the Team types
  card. (Save is automatic — save-on-toggle.)
- **Pass**: Tab B reflects the change within ~1s. Network panel on tab B
  shows **no** new Firestore read.

### 12. Wizard empty state (no teams)
- **Setup**: Delete all teams from the `/teams` collection. Wipe org doc.
  Reload.
- **Steps**: Walk through wizard to Step 4.
- **Pass**: Assistant says "You haven't created any teams yet — that's fine
  …". Auto-advances to Step 5 after ~1.5s.

### 13. Allotment placeholders
- **Setup**: Anywhere.
- **Steps**: View Step 5 in the wizard AND the Allotment sub-section in
  `/admin/config`.
- **Pass**: "Pool" and "Auto" cards are visually subdued (50% opacity,
  cursor-not-allowed cursor on hover) with a "Coming soon" pill. Manual is
  the only selected/selectable option.

### 14. Multi-coordinator warning
- **Setup**: After #6.
- **Steps**: In `/admin/config` → Team mapping → mark two teams as
  "Client coordination". (Each select triggers a save on its team doc.)
- **Pass**: Yellow inline warning appears under the team-mapping table:
  "**X** teams set as **Client coordination** — workflows only use the
  first by created date." Workflows continue functioning using the
  earliest-created team.

### 15. Firestore rules
- **Setup**: Sign in as a non-super_admin (regular user).
- **Steps**: In DevTools console:
  ```js
  const { doc, setDoc } = await import('firebase/firestore')
  const { db } = await import('/src/lib/firebase.ts')
  await setDoc(doc(db, 'config', 'orgStructure'), { hacked: true })
  ```
- **Pass**: Firebase returns `permission-denied`. The same read call
  (`getDoc`) succeeds (returns the existing doc).

### 16. Non-super-admin no wizard
- **Setup**: Wipe org doc. Sign in as a regular `user`-role account.
- **Pass**: Lands on `/`. **No** redirect to `/admin/setup`. Project labels
  read whatever's in the cached default ("Project Lead" on a truly fresh
  cache).

### 17. Lottie loads
- **Setup**: Open `/admin/setup` on any scenario.
- **Pass**: Network panel shows `/kieth-ai.lottie` loading with a 200
  response. The orb in the header animates continuously; assistant-bubble
  orb avatars animate.

### 18. Production build clean
- **Pass**: `npx vite build` succeeds with no errors. The chunk-size
  warning ≥500kB is pre-existing and unrelated.

---

## Smoke test — full Client A tender flow

Before declaring phase 1 shippable, run the full 10-stage tender flow on
Client A end-to-end. This catches regressions the matrix above might miss.

1. **Create a tender** via the "+ New Tender" CTA. Description reads
   "You'll allocate a Vertical Head once it's created." (or whatever
   leadRoleName is set to).
2. **Stage 1 → 2: Allocate VH**. Modal title reads "Allocate to <Lead
   Role>". Pick an admin user.
3. **Stage 2 → 4 or 3: VH accepts or escalates**. Sign in as the assigned
   VH. Click Accept on the stage-2 banner.
4. **Stage 4 → 5: Super admin eligibility review**. Sign in as super_admin;
   click Eligibility review. Approve.
5. **Stage 5 → 6: VH adds fanout tasks** for each specialist team.
6. **Stage 6 → 7: Specialist teams submit tasks for review**. Each task's
   reviewer suggestion is the coordinator lead (the team mapped as
   "Client coordination").
7. **Stage 7 → 8: Validator team's lead signs off**. Sign in as the lead
   of the team mapped as "Reviews work". Click "Validation complete — sign
   off". Modal copy reads "I confirm <Validator Team Name> has validated
   all deliverables…".
8. **Stage 8 → 10: VH approves**. Sign in as VH; click Approve on banner.
   (Or Reject → stage 9 → rework loop.)
9. **Stage 10: Coordinator marks delivered**. Sign in as coordinator lead;
   click Update status. Mark as `submitted` or `awarded`.

### Smoke-test pass criteria
- Console is clean of "no validator team" / "no coordinator team"
  warnings — every stage that requires a role resolves to a team.
- Every "Vertical Head" / "VH" label in the UI uses the configured
  `leadRoleName` (verifiable by changing it in `/admin/config` between
  steps and reloading).
- Stage history events all log per audit-event pattern, and the audit log
  captures `org_structure.setup_completed` for the initial wizard run.

---

## Common failure modes & fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Stage-7 sign-off button never shows | Operator hasn't mapped the validator team in `/admin/config` | Map a team as "Reviews work" |
| All UI says "Project Lead" instead of "Vertical Head" | Cache miss or seed didn't run | Run `seedClientAOrgStructure(<uid>)` or save in `/admin/config` |
| Wizard auto-launches for the wrong user | `setupCompleted: false` in Firestore | Seed the doc or finish the wizard once |
| Cross-tab sync isn't firing | Tabs are in different storage origins | Confirm both tabs are on the same origin |
| Lottie shows a static circle | Network failed to load `/kieth-ai.lottie` | Hard-reload; check file is in `public/` |

---

## What's NOT in scope (deferred to phase 2)

These behaviors are intentional, not bugs:

- `AllocateVhModal` still filters candidate users by `globalRole === 'admin'`. Making the lead-role pool configurable is a phase-2 task — only the label changes in phase 1.
- The 10 stage definitions and their transitions remain code-defined.
- Per-pipeline org-shape variation (one tenant, multiple pipelines with different team structures) is phase 2b.
- Pool/Auto allotment modes — phase 3.
- Breakage warnings ("you're about to disable validator but the Tender pipeline references it") — phase 2.
