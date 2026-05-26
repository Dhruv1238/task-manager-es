# Sandbox — Public Try-Before-You-Buy Experience

## Context

Production today runs one client per Firebase project, same React codebase, env-switched at build time. Top-level Firestore paths (`/projects`, `/workflows`, `/config/orgStructure`), no tenant scoping. That stays. The sandbox is a new build of the same codebase pointed at a dedicated **sandbox Firebase project**. Inside that Firebase, each visitor's data lives under `/sandbox/{visitorUid}/...`. One Firebase, many visitors, path-isolated.

This phase ships:

1. **A path-routing helper** in `lib/firestore.ts` that prefixes every collection ref with `sandbox/{uid}` when the build flag is set, and is a no-op otherwise. Production builds are untouched.
2. **A dedicated sandbox Firebase project** with default-deny security rules and a one-rule exception: each visitor can read/write their own subtree.
3. **A modified login screen** for the sandbox host: "Continue with Google" and "Continue with email." Email is captured the moment a visitor commits to entering.
4. **A choice screen** post-entry: take a guided tour, or free-roam in a pre-seeded sandbox. Both are first-class.
5. **Per-visitor sandbox seeding** that runs once on first entry: a fully populated tenant — org structure, three workflows, five teams, nine personas, five sample projects in various stages. The visitor lands in a world that's already alive.
6. **Persona switching** — a floating "Acting as" pill that lets a single visitor experience the workflow from every actor's chair without leaving the session.
7. **A scripted tour** through the collab-default workflow: ~16 steps, persona switches at the right moments, resumable.
8. **Roam mode** with full access to the platform — workflow authoring, org wizard, team management, everything a real super_admin can do. Pre-seeded content is reference; visitor builds on top.
9. **Progressive contact capture** at five moments: entry (email), first-action milestone (name + company), engagement milestone (role), deep intent (problem + meeting), exit intent (recap email). Each tied to a context where the ask is justified.
10. **A global `/leads/` collection** in the sandbox Firebase. Visitor writes their own lead doc directly; security rules lock each visitor to their own. Sales reads via Firebase console or a tiny admin app (deferred).

Built on top of phases 1, 2a, 2b, 2c. Nothing in production changes.

Out of scope:

- TTL cleanup of dormant sandboxes. Deferred. Visitors keep their sandboxes indefinitely; if storage piles up enough to matter, we add a scheduled function later. Conscious choice.
- Email magic-link auth for cross-browser session continuity. Anonymous auth + localStorage gives same-browser persistence; cross-browser starts a new sandbox. Documented limitation.
- Multi-visitor collaboration inside one sandbox.
- Tenant scoping of production data. Production stays one-Firebase-per-client.
- A purpose-built sales CRM view. For v1, leads are read via Firebase console; a minimal admin UI can come later.
- Production-side login screen changes. Only the sandbox host gets the modified screen.

---

## Decisions pinned

| Question | Decision | Implication |
| --- | --- | --- |
| Where does sandbox live? | New dedicated Firebase project, same React codebase, env-switched at build time | Production Firebases untouched. One sandbox Firebase serves every visitor. |
| Visitor isolation | Path-based: `/sandbox/{visitorUid}/...` | Security rules enforce isolation in one rule. Fail-closed. |
| Build flag | `VITE_IS_SANDBOX=true` for the sandbox build | One codebase, two environments. Helpers branch on the flag. |
| Subdomain | `try.yourdomain.com` (or similar) | Separate analytics, easier to share, no SEO conflict with production. |
| Auth at entry | Modified login: "Continue with Google" + "Continue with email" (no password) | Email captured at the first commit point. Anonymous auth for the email path. |
| Cross-browser persistence | Out — visitor gets a new sandbox per browser, lead record persists with same email | Acceptable for v1. Magic-link auth is the future fix. |
| Tenant lifetime | Indefinite (no cleanup function in this phase) | Storage grows linearly with visitors. Acceptable until proven otherwise. |
| Pre-seeded content | Tenant arrives populated: 5 teams, 9 personas, 5 sample projects, 3 workflows, completed setup | Visitor sees the platform in motion immediately. No empty-state walls. |
| Entry mode choice | Menu after sign-in: tour vs. roam | Both modes share the same pre-seeded tenant. Difference is only the UI overlay. |
| Persona switching | Floating "Acting as" pill, sandbox-only, overrides permission-resolver identity | Same code paths as production permissions. `actAsUid` lives in `AuthContext`. |
| Contact capture stages | Five: entry, first-action, engagement, deep-intent, exit-intent | Email guaranteed; each subsequent stage requires more demonstrated investment. |
| Lead storage | `/leads/{leadId}` top-level in the sandbox Firebase. Lead ID = visitor's auth uid. | Client-side write, security rules lock each visitor to their own doc. Dedup happens at the sales layer. |
| Cloud Functions | Zero in this phase | Everything client-side. Cleanup, lead-mirror, seed all deferred to later if needed. |
| Sandbox neutering | Email sends, file uploads, invite-teammate, exports all wrapped to no-op or simulate | Production code paths unchanged. Wrapper checks `import.meta.env.VITE_IS_SANDBOX`. |

---

## Architecture

### The single mental model

Two builds of the same codebase, two Firebase projects. Production behaves as it does today. Sandbox runs against a Firebase where every read and write is path-prefixed with `sandbox/{visitor's auth uid}`. Same React app, same components, same permission logic, same workflow engine.

```
Production build (VITE_IS_SANDBOX=false)
  Firebase: client-A-prod
  Paths:    /projects, /workflows, /config/orgStructure, ...

Sandbox build (VITE_IS_SANDBOX=true)
  Firebase: yourdomain-sandbox
  Paths:    /sandbox/{uid}/projects, /sandbox/{uid}/workflows,
            /sandbox/{uid}/config/orgStructure, /sandbox/{uid}/_meta, ...
  Plus:     /leads/{leadId}  (top-level, sandbox-only, lead-id = visitor uid)
```

### Path-routing helper

Every Firestore reference funnels through `lib/firestore.ts`. Two new helpers:

```ts
// src/lib/firestore.ts

const IS_SANDBOX = import.meta.env.VITE_IS_SANDBOX === 'true';

function getSandboxRoot(): string[] | null {
  if (!IS_SANDBOX) return null;
  const uid = getAuthSnapshot()?.uid;
  if (!uid) throw new Error('Sandbox path resolution before auth ready');
  return ['sandbox', uid];
}

export function tenantCol(name: string): CollectionReference {
  const root = getSandboxRoot();
  return root
    ? collection(db, ...root, name)
    : collection(db, name);
}

export function tenantDoc(name: string, id: string): DocumentReference {
  const root = getSandboxRoot();
  return root
    ? doc(db, ...root, name, id)
    : doc(db, name, id);
}

// Subcollections (e.g. tasks/{id}/comments) use a third helper:
export function tenantSubCol(parent: string, parentId: string, child: string): CollectionReference {
  const root = getSandboxRoot();
  return root
    ? collection(db, ...root, parent, parentId, child)
    : collection(db, parent, parentId, child);
}
```

`getAuthSnapshot()` returns the current Firebase auth user as a synchronous read — backed by the same `AuthContext` value but accessible to non-React code. (`AuthContext` already exposes this for the existing audit-trail writes.)

### What gets refactored

Every direct `collection(db, ...)` and `doc(db, ...)` call in the codebase gets routed through `tenantCol` / `tenantDoc`. This is the bulk of the S0 work. The places that need attention:

- `src/lib/firestore.ts` — the mutation surface. Most refs here are already abstracted; just swap them.
- `src/pages/Projects.tsx`, `src/pages/AdminMembers.tsx` — build queries inline via `buildQuery(cursor)` closures. Each `collection(db, 'projects')` becomes `tenantCol('projects')`.
- `src/contexts/AppConfigContext.tsx` — reads `/config/orgStructure`. Becomes `tenantDoc('config', 'orgStructure')`.
- All `src/hooks/use*Tasks*.ts` and similar — snapshot listeners. Same swap.
- `src/lib/createMember.ts` — writes to `/users/{uid}`. In sandbox: `tenantDoc('users', uid)` (lives under the visitor's subtree).
- `src/pages/ProjectDetail.tsx`, `src/pages/TaskDetail.tsx` — real-time listeners. Same swap.

Roughly 30-40 file touches, mostly mechanical. An ESLint rule (custom) blocks future direct `collection(db, ...)` or `doc(db, ...)` calls outside `lib/firestore.ts`:

```js
// .eslintrc — custom rule
"no-restricted-syntax": [
  "error",
  {
    "selector": "CallExpression[callee.name=/^(collection|doc)$/][arguments.0.name='db']",
    "message": "Use tenantCol() or tenantDoc() from lib/firestore.ts instead of direct Firestore refs."
  }
]
```

Exemption: `lib/firestore.ts` itself.

### Security rules — fail loud

Default-deny everywhere. Three explicit allow blocks:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Visitor's own sandbox subtree
    match /sandbox/{visitorUid}/{document=**} {
      allow read, write: if request.auth != null
                          && request.auth.uid == visitorUid;
    }

    // Lead doc — one per visitor, keyed by uid
    match /leads/{leadId} {
      allow create, update: if request.auth != null
                             && leadId == request.auth.uid
                             && validLeadShape(request.resource.data);
      allow read: if false;   // Sales reads via console or admin SDK
      allow delete: if false;
    }

    // Sandbox meta indicator (public read-only, useful for the app to confirm host)
    match /sandboxConfig/main {
      allow read: if true;
      allow write: if false;
    }

    // Default deny
    match /{path=**} { allow read, write: if false; }

    function validLeadShape(d) {
      return d.email is string && d.email.size() > 3 && d.email.size() < 254
          && d.source == 'sandbox'
          && d.visitorUid == request.auth.uid;
    }
  }
}
```

The default-deny clause means: if a developer ships a feature that accidentally writes to a top-level path in sandbox mode, the write fails loudly in dev. Better than silent fail-open.

### Build & deploy

- `.env.sandbox` — new env file with `VITE_IS_SANDBOX=true` and `VITE_FIREBASE_*` pointing at the sandbox Firebase project.
- New CI target: `build:sandbox` runs `vite build --mode sandbox`.
- Sandbox deploys to `try.yourdomain.com` (Firebase Hosting on the sandbox project).
- Production deploys are untouched.

---

## Schema

### `/sandbox/{visitorUid}/_meta` (new, one doc per visitor)

The visitor's session-level state. Everything else under their subtree mirrors production schema exactly.

```ts
// src/types/sandbox.ts

export interface SandboxMeta {
  visitorUid: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  sessionsCount: number;
  setupSeeded: boolean;             // false until first-entry seed completes

  visitor: {
    email: string;                  // captured at entry
    name?: string;                  // captured at first-action milestone
    company?: string;               // captured at first-action milestone
    role?: string;                  // captured at engagement milestone
    intent?: string;                // captured at deep-intent
    wantsCallback?: boolean;        // captured at deep-intent
    wantsRecap?: boolean;           // captured at exit-intent
  };

  contactCapture: {
    entry: boolean;
    firstAction: boolean;
    engagement: boolean;
    deepIntent: boolean;
    exitIntent: boolean;
    dismissals: {                   // tracks soft-dismissals for cooldown logic
      firstAction?: Timestamp;
      engagement?: Timestamp;
      deepIntent?: Timestamp;
      exitIntent?: Timestamp;
    };
  };

  entryMode: 'tour' | 'roam' | null;

  tourProgress?: {
    workflowId: string;             // 'collab-default'
    currentStepId: string;
    completedStepIds: string[];
    completedAt?: Timestamp;
    abandonedAt?: Timestamp;
  };

  engagement: {
    totalActiveSeconds: number;     // accumulated heartbeat tracking
    lastActiveAt: Timestamp;
    actionsCompleted: string[];     // ['created_project', 'completed_stage_1', 'switched_persona', ...]
  };
}
```

### `/sandbox/{visitorUid}/<everything else>`

Identical schema to production:

- `users/{uid}` — visitor's own profile + seeded persona profiles
- `config/orgStructure` — singleton
- `config/appConfig` — singleton
- `workflows/{workflowId}` — collection
- `workflows/_registry` — singleton
- `teams/{teamId}` — collection
- `projects/{projectId}` — collection (the existing `accessKeys`, `titleLower`, `pinnedWorkflow`, etc.)
- `tasks/{taskId}` — collection, with `comments/` subcollection
- `audit/{eventId}` — collection

Every visitor's subtree is a complete miniature production database. No new fields on production schemas. The only reason new fields exist on `_meta` is that it's sandbox-only state.

### `/leads/{leadId}` (new, top-level in sandbox Firebase)

```ts
// src/types/lead.ts

export interface Lead {
  id: string;                       // == visitor's auth uid
  email: string;
  visitorUid: string;
  source: 'sandbox';

  // Profile fields, progressively populated
  name?: string;
  company?: string;
  role?: string;
  intent?: string;
  wantsCallback?: boolean;
  wantsRecap?: boolean;

  // Lifecycle
  capturedAt: Timestamp;            // entry
  lastUpdatedAt: Timestamp;
  capturedStages: ('entry' | 'firstAction' | 'engagement' | 'deepIntent' | 'exitIntent')[];

  // Engagement signals
  engagementMinutes: number;
  actionsCompleted: string[];
  tourCompleted: boolean;
  sessionsCount: number;
  lastActiveAt: Timestamp;

  // Sales-team annotations (not written by the app)
  contacted: boolean;
  contactedAt?: Timestamp;
  contactedBy?: string;
  notes?: string;
}
```

`lead.id === visitorUid` is the dedup guarantee within a uid. Cross-browser same-email visits create separate lead docs with the same email — the sales tooling dedupes by email.

### `/sandboxConfig/main` (new, singleton, public read)

A tiny doc that the app can read at boot to confirm it's connected to the sandbox Firebase. Mostly belt-and-suspenders against env misconfiguration ("did I just deploy sandbox build to the prod Firebase?").

```ts
{
  isSandbox: true;
  banner: string;                   // "You're in sandbox mode" message
  contactEmail: string;             // for the "Talk to us" CTA
  calendlyUrl?: string;             // optional meeting booking link
}
```

---

## Visitor lifecycle

### First entry

1. Visitor opens `try.yourdomain.com`.
2. Sees the sandbox login screen.
3. **Google path**: Firebase Google sign-in completes. `auth.currentUser.uid` is set; `email` comes from the OAuth profile.
4. **Email path**: visitor types email, clicks Continue. `signInAnonymously()` fires; the email is held in a `pendingEmail` localStorage entry.
5. Post-auth: app checks `tenantDoc('_meta', 'main')` exists.
   - Doesn't exist → first entry. Writes `_meta` (`createdAt`, `visitor.email`, `contactCapture.entry: true`, `sessionsCount: 1`). Writes `/leads/{uid}` with the email + `capturedStages: ['entry']`. Runs the seed (next section). Routes to the menu.
   - Exists → returning. Bumps `lastSeenAt`, `sessionsCount`. If `entryMode` was set, restores to wherever they left off. If `tourProgress.currentStepId` is set and not completed, offers resume.

### Within a session

- A heartbeat increments `engagement.totalActiveSeconds` every 10 seconds while the tab is visible (cumulative cap of 5 hours per session to avoid runaway counters).
- Every significant action (`createProject`, `transitionStage`, `switchPersona`, `editWorkflow`, etc.) appends to `engagement.actionsCompleted`.
- Both fields are mirrored to `/leads/{uid}` so the lead record stays current. Mirror is debounced to once per minute.

### Across sessions, same browser

- Anonymous auth uid persists in IndexedDB; returning visitor has the same uid; their subtree is intact.
- Google sign-in uid is stable by definition.

### Across browsers / cleared storage

- New uid, new subtree, new sandbox. Pre-seed runs again.
- If the user entered the same email, a check in the post-auth flow looks up `/leads/` by email (admin-side ops or via a lightweight Cloud Function read endpoint — deferred). For v1: no recognition, just a fresh start. The lead record from the old session still exists by email; sales sees both.

### No expiry

`_meta` and the subtree live forever (or until manually purged). The user explicitly chose this; revisit if Firestore storage costs become noticeable. A manual "delete sandbox" admin tool can be built later.

---

## Entry: the sign-in screen

A new component, `src/pages/SandboxLogin.tsx`. Replaces `Login.tsx` only when `IS_SANDBOX` is true. Production login is untouched.

```
+---------------------------------------+
|                                       |
|        [Brand mark]                   |
|                                       |
|        Try the platform               |
|        No signup. No commitment.      |
|        Your sandbox is yours alone.   |
|                                       |
|   ┌───────────────────────────────┐   |
|   │   Continue with Google        │   |
|   └───────────────────────────────┘   |
|                                       |
|              ─── or ───               |
|                                       |
|   Email                               |
|   ┌───────────────────────────────┐   |
|   │ you@company.com               │   |
|   └───────────────────────────────┘   |
|   ┌───────────────────────────────┐   |
|   │       Continue →              │   |
|   └───────────────────────────────┘   |
|                                       |
|   By continuing, you agree to our     |
|   terms. We'll only use your email    |
|   to follow up if you'd like.         |
|                                       |
+---------------------------------------+
```

Validation is permissive: client-side regex only. Disposable email domains are allowed (sales filters their end). The privacy line is deliberate — sets the expectation that we *will* email them, but only if they want.

---

## The menu

`src/pages/SandboxMenu.tsx`. Reached only on first entry (after which `entryMode` is set on `_meta`). After that, the choice between tour and roam becomes a header toggle, not a wall.

```
+---------------------------------------+
|                                       |
|   Welcome, [name-or-email-prefix]     |
|                                       |
|   How would you like to start?        |
|                                       |
|   ┌─────────────────────────────┐     |
|   │ 🎬  Take a guided tour       │     |
|   │ ~7 minutes                   │     |
|   │ Walk through a full tender   │     |
|   │ from intake to delivery.     │     |
|   │                              │     |
|   │  [ Start tour → ]            │     |
|   └─────────────────────────────┘     |
|                                       |
|   ┌─────────────────────────────┐     |
|   │ 🛝  Free-roam                │     |
|   │ Drop into a sandbox already  │     |
|   │ populated with sample work.  │     |
|   │ Click anything. Build your   │     |
|   │ own workflow.                │     |
|   │                              │     |
|   │  [ Enter sandbox → ]         │     |
|   └─────────────────────────────┘     |
|                                       |
+---------------------------------------+
```

Picking either sets `_meta.entryMode` and routes them in. The header from then on shows a Mode pill: "Mode: Roam ⌄" (drop-down to switch / restart tour).

---

## Per-visitor seeding

On first entry, immediately after `_meta` is created, `src/lib/sandboxSeed.ts` runs client-side. It batches every doc into a single `writeBatch()` so the tenant comes online atomically.

### Org structure

```ts
{
  version: 1,
  leadRoleName: 'Vertical Head',
  teamRoles: { hasCoordinator: true, hasValidator: true, hasSpecialist: true },
  workTypes: ['2D Design', '3D Design', 'Video Editing'],
  allotment: { mode: 'manual' },
  setupCompleted: true,
}
```

`setupCompleted: true` keeps the setup wizard from auto-launching. In roam, the visitor can re-run setup from the header if curious.

### Workflows

All three system workflows installed (basic, collab-default, sales-default). `_registry`: `activeWorkflowIds: ['collab-default', 'basic', 'sales-default']`, `defaultWorkflowId: 'collab-default'`.

### Teams

Five teams via the `seedTeamsGeneric.ts` helper from the phase 1 addendum:

| Team | Role | Work types |
| --- | --- | --- |
| Client Servicing | coordinator | — |
| Copy & Strategy | validator | — |
| Graphic Design | specialist | 2D Design |
| Events Design | specialist | 3D Design |
| Video Editing | specialist | Video Editing |

### Personas (seeded user docs, not real auth accounts)

Created as `/sandbox/{visitorUid}/users/{personaUid}` docs with deterministic uids:

| Persona | uid pattern | Role | Team |
| --- | --- | --- | --- |
| Visitor (themselves) | the actual auth uid | super_admin | — |
| Aarti Sharma | `persona:vh-primary` | admin | — |
| Karan Mehta | `persona:vh-secondary` | admin | — |
| Priya Iyer | `persona:cs-lead` | user (team lead) | Client Servicing |
| Rohan Das | `persona:ct-lead` | user (team lead) | Copy & Strategy |
| Devika Rao | `persona:hl-2d` | horizontal_lead | Graphic Design |
| Sneha Patel | `persona:designer-2d` | user | Graphic Design |
| Vikram Singh | `persona:designer-3d` | user | Events Design |
| Maya Krishnan | `persona:video-editor` | user | Video Editing |

These aren't real Firebase Auth accounts. They're profile docs the visitor's auth uid can read/write (the security rule allows the visitor to write anything under their own subtree).

### Sample projects

Five projects with varied stages and workflows:

| Project title | Workflow | Stage | Notes |
| --- | --- | --- | --- |
| Diageo Q4 Activation Pitch | collab-default | 7 — specialist work + CT validation | Aarti is VH. Three subtasks: one CT-approved, one in_review, one in_progress. |
| Adidas Launch Event RFP | collab-default | 4 — VH accepted, awaiting RFP attachment | Aarti is VH. Ready to fan out. |
| Unilever Refresh (delivered) | collab-default | 10 — awarded | Full stage history populated for "look back" exploration. |
| Internal team offsite plan | basic | active | Visitor owns. Tasks assigned to personas. |
| Tech Mahindra Q3 lead | sales-default | 3 — proposal sent | Visitor owns. Demonstrates the second workflow. |

Sample data is a deterministic generator in `src/lib/sandboxSeed.ts`. Tour and roam visitors land in the same seeded world.

### Reset

A "Reset sandbox" button in the header (sandbox-only). Confirm modal. On confirm: deletes everything under `/sandbox/{uid}/...` and re-runs the seed. `_meta` is preserved on the visitor record but counters reset. Lead record at `/leads/{uid}` is untouched.

Because we have no recursive-delete from the client, the reset uses a known list of collections + a paged delete loop. Bounded — the seed produces ~50 docs.

---

## Persona switching

### Affordance

A floating pill in the bottom-right corner, sandbox-only:

```
+----------------------------+
|  👤 Acting as: Aarti (VH) ▾|
+----------------------------+
```

Click opens a popover with personas grouped by role. Selecting one sets `actAsUid` and shows a brief toast: "Now acting as Aarti Sharma (Vertical Head)."

### Implementation

`AuthContext` gains:

```ts
interface AuthContextValue {
  authUser: User;                     // the real Firebase auth user (visitor)
  effectiveUid: string;               // == actAsUid ?? authUser.uid
  actAsUid: string | null;            // sandbox-only, null in production
  setActAs: (uid: string | null) => void;
}
```

`setActAs` is gated:

```ts
const setActAs = (uid: string | null) => {
  if (!IS_SANDBOX) {
    console.warn('setActAs called outside sandbox; ignored');
    return;
  }
  setActAsState(uid);
};
```

Every consumer that currently reads `authUser.uid` for permission resolution switches to `effectiveUid`. Targets:

- `src/hooks/usePermissions.ts` — VH check, owner check, team member check, all derived from `effectiveUid`.
- `src/lib/firestore.ts` audit writes — stamp `createdBy: effectiveUid` (so when Aarti acts, the audit says Aarti). The real `auth.uid` is still what the security rules see; that's the visitor's.
- Anywhere "you are the assignee" / "you are the owner" UI is rendered.

The Firestore write itself happens under the visitor's real auth uid — security rules require `request.auth.uid == visitorUid` in the path. That's always satisfied. The audit's `createdBy` is the storytelling layer; it diverges in sandbox.

### Production safety

In production, `IS_SANDBOX` is false; `setActAs` is a no-op; `actAsUid` is always null; `effectiveUid` always equals `authUser.uid`. Belt-and-suspenders: a build-time check could entirely strip the `actAsUid` code from production bundles, but the runtime gate is sufficient.

### Why this works

Persona switching is purely a UI-layer override. The permission resolver doesn't know the difference between "logged in as Aarti" and "acting as Aarti." The data layer doesn't care — every doc Aarti "creates" gets her uid in `createdBy`. The visitor experiences the workflow from every chair without ever signing out.

---

## Tour mode

### The tour script — collab-default

A 16-step walkthrough. Each step is a `TourStep`:

```ts
// src/types/sandbox.ts

export interface TourStep {
  id: string;
  targetSelector?: string;          // CSS selector (uses data-tour-id attrs)
  targetRoute?: string;             // route to navigate to before showing
  actAs?: string;                   // persona uid to switch into
  title: string;
  body: string;
  primaryCta: { label: string; action: 'next' | 'await_in_app' };
  skipCta?: { label: string };
  completionEvent?: string;         // app event that auto-advances
  precondition?: () => boolean;
}
```

Steps for `collabDefaultTour`:

1. **"You're the super admin."** Highlight the "+ New project" button. *await click → opens the new-project modal*.
2. **"Pick a workflow."** Coach on the workflow picker in the modal. Tour pre-fills a name ("Acme Q4 Pitch"). *await submit*.
3. **"Allocate it to a Vertical Head."** Highlight the allocate action. *await click → opens allocate modal*. Suggest Aarti.
4. **"Aarti's been allocated. Let's see this from her side."** Auto-switches persona to Aarti.
5. **"As Aarti, accept the project."** Highlight accept button. *await click*.
6. **"Now fan the work out to your specialist teams."** Open fan-out modal. Suggest three subtasks across 2D, 3D, Video.
7. **"Specialist work begins. Let's drop into Sneha's chair."** Persona switch → Sneha. Navigate to her task.
8. **"Pick it up and start working."** Highlight the "Take" / "Start" action.
9. **"Submit for CT review when done."** Show the in_review transition.
10. **"Switch to Rohan, your CT Lead, who validates the work."** Persona switch → Rohan.
11. **"Approve Sneha's submission."** Highlight approve.
12. **(Fast-forward block)**: "We've already pre-approved the other two for you. Skip to the next stage?" → confirms → advances all subtasks to approved.
13. **"Back to Aarti. All specialist work is CT-validated. Submit for VH review."** Persona switch → Aarti. Stage 7 → 8.
14. **"Approve and mark ready for client."** Stage 8 → 9.
15. **"Priya from Client Servicing delivers."** Persona switch → Priya. Stage 9 → 10. Choose outcome.
16. **Wrap-up screen.** "You just ran a full tender end-to-end." Shows the project's stage history. Three CTAs: "Try building your own workflow" (links to `/admin/workflows/new`), "Free-roam now" (exits tour), "Book a walkthrough" (triggers deep-intent capture).

### Tour overlay

`src/components/sandbox/TourOverlay.tsx`. Portal-rendered. Dimmed full-screen layer with a cutout around the target. The coach mark popover anchors to the target with offset calculation.

Targets use `data-tour-id` attributes, not arbitrary selectors:

```tsx
<button data-tour-id="new-project-button">+ New project</button>
```

A CI check loads each tour step's target in a smoke test and fails if missing.

### Resumability

`_meta.tourProgress.currentStepId` is written on every step transition. On return, the menu shows "Resume tour at step 4" as the top CTA. Exit-tour mid-flow doesn't lose data — the visitor's project is real and persists.

### Skipping

Every step has a "Skip this step" link. "Exit tour" button in the overlay drops to roam mode. The "Restart tour" option in the header re-opens it from step 1.

---

## Roam mode

Same pre-seeded tenant. No overlay, no scripted advancement, no constraints. The header offers:

- **Mode pill** — "Mode: Roam ⌄". Drop-down: "Start tour" / "Restart sandbox" / "Talk to us".
- **Persona switcher** — always-visible floating pill (same as tour mode).
- **Reset sandbox** — under the Mode menu, with confirm.
- **Talk to us** — triggers the deep-intent capture modal.

In roam, the visitor can do everything a production super_admin can do in their tenant:

- Open any pre-seeded project, advance stages, see audit history.
- Create new projects in any of the three workflows.
- Open `/admin/workflows/new` and build a workflow from scratch — full authoring wizard from phase 2c, real workflow, persists.
- Edit existing workflows via the standalone editor.
- Add or remove team members.
- Re-run `/admin/setup` to walk through the org wizard.
- Edit org structure.

The pre-seeded content is the reference; the visitor's own creations are layered on top. This is where the platform's depth actually sells itself.

---

## Contact capture progression

Five stages. Each tied to a moment where the ask is justified by what the visitor's just done. Soft asks are dismissible with a cooldown; hard asks are explicit visitor-initiated actions.

### Stage 1 — Entry (mandatory, email)

**Trigger**: the sign-in flow. Email comes from either Google profile or the email input.

**Behavior**: no separate dialog — it *is* the sign-in. 100% capture rate.

**Writes**:
- `_meta.visitor.email`, `_meta.contactCapture.entry = true`.
- `/leads/{uid}` created with `email`, `source: 'sandbox'`, `capturedStages: ['entry']`, `capturedAt`, `visitorUid`.

### Stage 2 — First-action milestone (soft, name + company)

**Trigger**: the visitor's first state-changing action. Whichever fires first among:
- Completing a stage transition (tour or roam).
- Creating their own new project.
- 90 seconds of cumulative active time.

**UX**: a slide-in card from the bottom-right corner. Doesn't block the screen. Auto-dismisses to a minimized pill if ignored for 30 seconds, can be re-opened by clicking the pill.

```
+-------------------------------------+
| 👋 Quick one                        |
|                                     |
| You're getting the hang of this.    |
| Mind sharing who you are?           |
|                                     |
| Name     [_________________]        |
| Company  [_________________]        |
|                                     |
| [ Continue ]   [ Skip for now ]     |
+-------------------------------------+
```

**Cooldown**: dismissing sets `_meta.contactCapture.dismissals.firstAction = now`. Modal re-fires after 5 minutes of activity. Hard ceiling: no more than 3 re-shows per session.

**Writes**: `_meta.visitor.name`, `_meta.visitor.company`, `_meta.contactCapture.firstAction = true`. Mirrored to `/leads/{uid}`.

### Stage 3 — Engagement milestone (soft, role)

**Trigger**: ~5 minutes of cumulative active time, OR completion of the tour, OR creation of the visitor's first authored workflow. Whichever fires first.

**Precondition**: stage 2 already captured (otherwise this fires alongside stage 2 → confusing). If stage 2 was dismissed multiple times, this stage skips to stage 4 trigger.

**UX**: same slide-in card pattern as stage 2.

```
+-------------------------------------+
| You've been exploring for a bit.    |
| What's your role at [company]?      |
|                                     |
| ◯ Founder / CEO                     |
| ◯ Operations / Project Mgmt         |
| ◯ Sales / Client Servicing          |
| ◯ Designer / Creative               |
| ◯ Engineering / Product             |
| ◯ Other                             |
|                                     |
| [ Continue ]   [ Skip ]             |
+-------------------------------------+
```

**Cooldown**: 5 minutes between re-shows. Max 2 re-shows.

**Writes**: `_meta.visitor.role`, `_meta.contactCapture.engagement = true`. Mirrored to `/leads/{uid}`.

### Stage 4 — Deep intent (explicit, problem + meeting)

**Trigger**: any of:
- Visitor clicks "Talk to us" in the header (explicit and visitor-initiated).
- Visitor attempts "Invite teammate" (sandbox-neutered, but the *attempt* is a strong signal — they're imagining a real team here).
- Tour wrap-up screen "Book a walkthrough" CTA.
- Visitor opens the workflow authoring wizard for the second time (they're considering serious use).
- 15 minutes of cumulative active time.

**UX**: half-page modal. More deliberate, not dismissible without an explicit "Just keep me posted."

```
+--------------------------------------+
| Let's set up a real walkthrough      |
|                                      |
| You've seen the surface — we'd love  |
| to tailor a demo to what you're      |
| actually trying to build.            |
|                                      |
| What problem are you solving?        |
| [                                 ]  |
| [                                 ]  |
|                                      |
| [ ] Want a callback in the next 48h? |
|                                      |
| [ Book a meeting now ]               |
| [ Just keep me posted ]              |
+--------------------------------------+
```

"Book a meeting" links to a Calendly URL from `/sandboxConfig/main.calendlyUrl`. "Just keep me posted" writes the data and closes.

**Writes**: `_meta.visitor.intent`, `_meta.visitor.wantsCallback`, `_meta.contactCapture.deepIntent = true`. Mirrored to `/leads/{uid}`.

### Stage 5 — Exit intent (passive, last chance)

**Trigger**: visitor is leaving. Detected by:
- Desktop: `mouseleave` on `document` where `clientY <= 0` (moving toward browser chrome) — once per session.
- Mobile: `visibilitychange` to hidden after 3+ minutes of session activity — once per session.

**UX**: small toast/sheet at the top.

```
+----------------------------------------+
| Heading out? Want a recap email?       |
|                                        |
| We'll send you a summary of what       |
| you built + a few resources.           |
|                                        |
| [ Send me the recap ]  [ No thanks ]   |
+----------------------------------------+
```

Only ever shown once per session. If visitor returns and triggers exit-intent again next session, it can re-fire (but checks if stage 5 already captured — skips if so).

**Writes**: `_meta.visitor.wantsRecap`, `_meta.contactCapture.exitIntent = true`. Mirrored to `/leads/{uid}`.

### Where lead data flows

Every write to `_meta.visitor` or `_meta.contactCapture` is mirrored to `/leads/{uid}` in the same client-side transaction. `lead.lastUpdatedAt = now`. The mirror writes the *current* full state of capture fields, not deltas. This way `/leads/` is always a self-contained sales record.

Engagement signals (`engagementMinutes`, `actionsCompleted`, `sessionsCount`, `lastActiveAt`, `tourCompleted`) are also mirrored on a debounced 60-second cadence so sales sees activity in near-real-time.

### Reading leads

For v1: sales reads `/leads/` via the Firebase console. Sortable, filterable, exportable to CSV via the console UI. Not glamorous but works.

Future enhancement (Phase S6 or beyond): a small admin web app deployed at `admin.yourdomain.com` with allowlisted Google sign-in, showing the leads feed, marking contacted, etc. Not in this phase.

---

## Sandbox neutering

Production code paths are untouched. A small set of services check `IS_SANDBOX` and switch behavior.

| Surface | Production | Sandbox |
| --- | --- | --- |
| Email send (notifications) | Real send via your email service | No-op. Toast: "Email would have been sent to X" |
| File upload | Upload to external asset service | Stores as `blob:` URL on the page; the doc gets a `sandbox:placeholder` token instead of a real asset id |
| Invite teammate | Creates auth account, emails credentials | Simulated success toast. Logs to `actionsCompleted: 'attempted_invite'` — this is a stage 4 trigger. |
| Export (CSV / PDF) | Real artifact | Same artifact + watermark text "Sandbox export — not for production use" |
| Webhook fires (if any) | Real fetch | No-op + console.log |

Each wrapper lives in `src/lib/sandboxNeutering.ts`. New external-effect features go through one of these wrappers — that's the only sandbox-aware code a future feature author has to think about.

---

## Code-sharing strategy and the audit

The "new feature auto-works in sandbox" property is real, but it depends on one discipline: **every Firestore reference must go through `tenantCol` / `tenantDoc`.**

The S0 refactor is the one-time payment. After that:

- New page that lists projects? Uses `tenantCol('projects')` like the existing pages — works in both.
- New collection added? Add the path to the helper usage — works in both.
- New permission rule? Goes through `usePermissions` → respects persona switching for free.
- New workflow effect? Workflow engine handles it; sandbox runs the same engine.
- New external integration (email, Slack, webhook)? Add a wrapper in `sandboxNeutering.ts`. *This is the only sandbox-aware step a developer takes.*

### The grep audit

Before merging S0, a developer-side script:

```bash
# Find all direct Firestore refs outside the helper file
grep -rn "collection(db," src/ --include='*.ts' --include='*.tsx' \
  | grep -v "src/lib/firestore.ts"

grep -rn "doc(db," src/ --include='*.ts' --include='*.tsx' \
  | grep -v "src/lib/firestore.ts"
```

Each hit becomes a `tenantCol` / `tenantDoc` swap. The ESLint rule then prevents regression.

### One-page dev-note

`docs/SANDBOX_DEV_NOTES.md` — short, hand-to-anyone-new doc that covers:
- The `IS_SANDBOX` flag and where it lives.
- The `tenantCol` / `tenantDoc` discipline.
- The `sandboxNeutering` wrappers and when to add a new one.
- The `data-tour-id` convention.
- How to test sandbox builds locally.

---

## Touchpoints

### Files added

| File | Purpose |
| --- | --- |
| `src/types/sandbox.ts` | `SandboxMeta`, `TourStep`, `PersonaArchetype`, `SandboxConfig`. |
| `src/types/lead.ts` | `Lead`. |
| `src/lib/sandboxSeed.ts` | Deterministic per-visitor seed. |
| `src/lib/sandboxNeutering.ts` | Wrappers for email, upload, invite, export. |
| `src/lib/leadCapture.ts` | Writes lead docs, manages capture stages + cooldowns. |
| `src/lib/engagement.ts` | Heartbeat tracker, action logger, lead mirroring. |
| `src/lib/sandboxConfig.ts` | Reads `/sandboxConfig/main` at boot. |
| `src/contexts/PersonaContext.tsx` | (Optional — could live in AuthContext) Manages `actAsUid`. |
| `src/pages/SandboxLogin.tsx` | Modified sign-in screen. |
| `src/pages/SandboxMenu.tsx` | Tour vs. roam choice. |
| `src/components/sandbox/SandboxHeader.tsx` | Mode pill, reset, talk-to-us. |
| `src/components/sandbox/SandboxBanner.tsx` | Persistent "You're in sandbox" strip. |
| `src/components/sandbox/PersonaSwitcher.tsx` | Floating pill + popover. |
| `src/components/sandbox/TourOverlay.tsx` | Coach-mark portal. |
| `src/components/sandbox/capture/CaptureSlideIn.tsx` | Reusable slide-in card. |
| `src/components/sandbox/capture/FirstActionCapture.tsx` | Stage 2 modal. |
| `src/components/sandbox/capture/EngagementCapture.tsx` | Stage 3 modal. |
| `src/components/sandbox/capture/DeepIntentCapture.tsx` | Stage 4 modal. |
| `src/components/sandbox/capture/ExitIntentCapture.tsx` | Stage 5 toast. |
| `src/components/sandbox/capture/CaptureCoordinator.tsx` | The single component that subscribes to action events and decides which stage to fire. |
| `src/lib/tours/collabDefaultTour.ts` | Tour step definitions. |
| `.env.sandbox` | Sandbox build env. |
| `docs/SANDBOX_DEV_NOTES.md` | Dev discipline notes. |
| `eslint-rules/no-direct-firestore-refs.js` | Custom ESLint rule. |

### Files modified

| File | Change |
| --- | --- |
| `src/lib/firestore.ts` | Adds `tenantCol`, `tenantDoc`, `tenantSubCol`. Existing helpers route through them. |
| `src/App.tsx` | Host detection: chooses `SandboxLogin` vs. `Login`. Mounts sandbox-only providers. |
| `src/contexts/AuthContext.tsx` | Exposes `effectiveUid`, `actAsUid`, `setActAs` (gated). |
| `src/hooks/usePermissions.ts` | Reads `effectiveUid` instead of `authUser.uid`. |
| `src/pages/Projects.tsx`, `src/pages/AdminMembers.tsx` | Inline queries go through `tenantCol`. |
| `src/contexts/AppConfigContext.tsx` | Reads via `tenantDoc('config', 'orgStructure')`. Cache key includes IS_SANDBOX + uid. |
| `src/lib/createMember.ts` | Writes through `tenantDoc`. |
| All `src/hooks/use*Tasks*.ts` | Snapshot listeners through helper. |
| `src/pages/ProjectDetail.tsx`, `src/pages/TaskDetail.tsx` | Snapshot listeners through helper. |
| External-effect call sites (email send, file upload, invite, export) | Wrapped via `sandboxNeutering`. |
| `firestore.rules` | New sandbox rules. (Production rules in a separate file deployed to production Firebases — unchanged.) |
| `firestore.indexes.json` (sandbox) | Subset of production indexes, prefixed with `sandbox/{uid}` collection paths (Firestore handles single-collection indexes by path; composite indexes need the prefixed equivalent declared). |
| `vite.config.ts` | Adds the `sandbox` mode + env file resolution. |
| `package.json` | Adds `build:sandbox` and `deploy:sandbox` scripts. |
| `.eslintrc` | Enables the no-direct-firestore-refs rule. |

---

## Verification

1. **Helper-routing refactor.** After S0 lands:
   - `grep -rn "collection(db," src/ --include='*.ts' --include='*.tsx' | grep -v "src/lib/firestore.ts"` returns nothing.
   - Same for `doc(db,`.
   - Production build deploys, all existing client work behaves identically. No regressions.

2. **Build flag works.** Locally:
   - `npm run dev` (production mode) connects to dev/staging Firebase, paths are top-level.
   - `npm run dev:sandbox` connects to sandbox Firebase, paths are `/sandbox/{uid}/...`.
   - Verify with the Firestore network tab.

3. **Security rules.** In the Firebase rules emulator:
   - Visitor A can read/write `/sandbox/A/projects/X`.
   - Visitor A *cannot* read/write `/sandbox/B/projects/X`.
   - Anonymous user (no auth) cannot read/write anything.
   - Visitor A can write `/leads/A` but not `/leads/B`.
   - Direct top-level write (e.g. `/projects/X`) is rejected.

4. **First-entry seed.**
   - Open `try.yourdomain.com` in an incognito window.
   - Continue with email `test1@example.com`.
   - Verify `/sandbox/{newUid}/_meta` exists with email captured.
   - Verify `/leads/{newUid}` exists with email captured.
   - Verify all five teams, nine personas, five projects, three workflows present.
   - Verify menu screen renders.

5. **Persona switching.**
   - Pick roam mode.
   - Open "Diageo Q4 Activation Pitch" (stage 7).
   - As the visitor, verify VH-specific stage actions are *not* available (visitor isn't the VH on this project — Aarti is).
   - Open persona switcher, switch to Aarti.
   - Verify VH actions now appear.
   - Take an action: verify the audit entry's `createdBy` is Aarti's persona uid, not the visitor's auth uid.

6. **Tour mode end-to-end.**
   - From menu, start tour.
   - Walk all 16 steps. Verify each persona switch happens automatically.
   - Verify each `data-tour-id` target is found and highlighted.
   - At step 8, click "Exit tour." Verify the tour can be resumed from the header at step 8.
   - Restart tour: verify it starts from step 1 again.

7. **Roam mode full power.**
   - From menu, enter roam.
   - Open `/admin/workflows/new`. Build a workflow. Verify it persists in the visitor's sandbox.
   - Open `/admin/setup`. Walk through the org wizard. Verify changes persist.
   - Create a new project using the visitor's authored workflow. Verify it works.
   - Reset sandbox. Verify the workflow + project are gone; pre-seed is back.

8. **Capture stage 1 (entry).**
   - On first entry, verify `/leads/{uid}.email` is set.
   - Verify `_meta.contactCapture.entry === true`.

9. **Capture stage 2 (first-action).**
   - In roam, complete a stage transition.
   - Verify the slide-in card appears.
   - Fill name + company, submit.
   - Verify `/leads/{uid}` has name + company; `_meta.contactCapture.firstAction === true`.
   - Reset sandbox: capture state should *not* reset (we want sales to retain it).

10. **Capture cooldown.**
    - In a fresh sandbox, dismiss the stage 2 card.
    - Take another action immediately. Card should *not* re-fire.
    - Wait 5+ minutes (or mock-advance the clock). Take an action. Card should re-fire.

11. **Capture stage 3 (engagement).**
    - Trigger via completing the tour.
    - Verify role-selection card appears.
    - Submit. Verify `/leads/{uid}.role` set.

12. **Capture stage 4 (deep intent).**
    - Click "Talk to us" in the header.
    - Verify the half-page modal.
    - Fill problem + check callback. Submit.
    - Verify `/leads/{uid}.intent` and `wantsCallback` set.
    - Alternatively: attempt "Invite teammate" → verify the same modal fires.

13. **Capture stage 5 (exit intent).**
    - Move mouse out of the viewport upward (or use DevTools `visibilitychange`).
    - Verify the toast appears once.
    - Move mouse out again: should NOT re-fire same session.

14. **Sandbox neutering.**
    - Trigger a flow that would email in production. Verify no email; toast appears.
    - Upload a file. Verify no external asset service call; blob URL used; doc shows placeholder.
    - Click invite teammate. Verify simulated success; `actionsCompleted` includes `attempted_invite`.

15. **Engagement tracking.**
    - Stay on the page for 3 minutes. Verify `_meta.engagement.totalActiveSeconds ≈ 180` and `/leads/{uid}.engagementMinutes ≈ 3`.
    - Take an action. Verify `actionsCompleted` includes it within 60 seconds (debounce).

16. **Same-browser return.**
    - Close and reopen the browser (without clearing storage).
    - Verify the visitor lands back in their sandbox without going through the menu again.
    - Verify their pre-seeded + authored data is intact.

17. **Cross-browser return.**
    - Open in a different browser, sign in with the same email.
    - Verify a new sandbox is created (limitation; documented).
    - Verify a new `/leads/` doc exists with same email but different uid.

18. **Production isolation paranoia check.**
    - In a production deploy, verify `IS_SANDBOX === false`.
    - Verify `setActAs` is a no-op.
    - Verify `tenantCol` returns top-level paths.

---

## Build order

### Phase S0 — Helper-routing refactor (~1 week)

The only refactor against existing code. Mechanical but touches many files.

- Add `tenantCol`, `tenantDoc`, `tenantSubCol` to `lib/firestore.ts`.
- Run the grep audit. Swap every direct ref.
- Enable the ESLint rule.
- Add `IS_SANDBOX` flag plumbing.
- Verify production behavior unchanged (run the full app, smoke-test every page).

**Ship checkpoint**: production still works identically. Sandbox flag exists but isn't pointed anywhere yet.

### Phase S1 — Sandbox infrastructure (~1 week)

- Provision the sandbox Firebase project.
- Set up env files, build script, deploy target.
- Write sandbox security rules. Test in emulator.
- Implement `sandboxConfig` doc + reader.
- Implement `sandboxSeed.ts` (deterministic generator).
- Implement `sandboxNeutering.ts` wrappers.
- Wire wrappers into the existing call sites.

**Ship checkpoint**: a developer can manually create a sandbox tenant from the browser console (sign in anonymously, run `sandboxSeed.run(uid)`). The seeded tenant is fully functional. No public surface yet.

### Phase S2 — Entry experience (~1.5 weeks)

- Host detection in `App.tsx`.
- `SandboxLogin.tsx` (Google + email entry, modified branding/copy).
- Anonymous auth wiring for the email path.
- `_meta` doc creation on first entry.
- `/leads/{uid}` stage-1 write.
- `SandboxMenu.tsx` (tour vs. roam).
- `SandboxHeader.tsx`, `SandboxBanner.tsx`.
- Reset-sandbox flow.

**Ship checkpoint**: visitors can sign in at `try.yourdomain.com`, get a seeded sandbox, and roam. Lead stage 1 captured. No tour overlay yet, no capture stages 2-5.

### Phase S3 — Persona switching + tour mode (~2 weeks)

- `AuthContext` `actAsUid` plumbing.
- `usePermissions` refactor to `effectiveUid`.
- Audit writes stamp `effectiveUid`.
- `PersonaSwitcher.tsx`.
- `TourOverlay.tsx` (portal, coach marks, target highlighting).
- `collabDefaultTour.ts` (the 16 steps).
- Tour resumability + skip / exit / restart.
- `data-tour-id` attribute addition to target elements.
- CI smoke test for tour targets.

**Ship checkpoint**: visitor can complete the full tour end-to-end. Persona switcher works in both tour and roam.

### Phase S4 — Contact capture progression (~1.5 weeks)

- `CaptureCoordinator.tsx` — central state machine for capture triggers, cooldowns, dismissals.
- Five capture components (stages 2-5; stage 1 already in S2).
- Trigger logic: heartbeat, action events, exit detection.
- Engagement mirroring (debounced 60s lead mirror).
- "Talk to us" header CTA.
- Tour wrap-up CTA → stage 4 modal.

**Ship checkpoint**: full capture progression working. Lead records populate progressively. Engagement signals tracked.

### Phase S5 — Polish (~1 week)

- Mobile responsiveness audit (sandbox is publicly shared — mobile traffic will be real).
- Empty-state polish where roam mode shows nothing.
- Performance pass — bundle size, first paint, the slide-in cards.
- Copy and visual review.
- Privacy/terms page.
- Analytics — fire a few events to your analytics provider (sandbox_started, tour_completed, capture_stage_N) so you can observe funnel behavior.

**Ship checkpoint**: public launch.

**Total: ~6 weeks of focused work.**

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A missed direct Firestore ref ships in sandbox build → default-deny rule blocks write → silent feature break | Medium during S0, low after | Grep audit + ESLint rule + verification pass #1. Default-deny means it fails *loud* (visible error toast) rather than silent. |
| Sandbox Firebase storage grows unboundedly | Low short-term, medium long-term | Acceptable for v1. Monitor; add a cleanup function when warranted. Sandbox per visitor is ~50 docs, so even 100k visitors = 5M docs = ~$5/mo Firestore at rest. Bounded. |
| Persona switching leaks into production code | Low | `setActAs` is hard-gated on `IS_SANDBOX`. Production renders `effectiveUid === authUser.uid` always. |
| Tour breaks when underlying UI changes | High over time | `data-tour-id` attributes + CI smoke test that loads each step's target. Tour maintenance is a checklist item for UI changes that touch tour-relevant surfaces. |
| Capture modals annoy visitors → bounce | Medium | Cooldowns + max-show counts + slide-in (not blocking) for soft stages. Stage 4 is visitor-initiated; stage 5 is exit-only. Worst case: visitor leaves, lead has stage 1 only. |
| Visitor types fake email, never engages | High (always happens) | Acceptable. Sales can filter by engagement metrics (`tourCompleted`, `engagementMinutes > 3`, etc.). The point is to maximize quality leads, not to maximize raw count. |
| Visitor on phone clears Safari storage → loses sandbox | Inevitable | Documented. Same email → new sandbox + new lead doc. Sales dedupes by email. Magic-link auth is the future fix. |
| Build flag misconfiguration deploys sandbox build to production Firebase | Low if CI is set up correctly, catastrophic if it happens | `/sandboxConfig/main` doc only exists in sandbox Firebase. App reads at boot; if it expects sandbox but doesn't find the doc, throws a startup error and refuses to render. |
| Email-only entry abused for spam tenant creation | Low-medium | Cloudflare or CDN-level rate limiting on the sandbox subdomain. Cap tenants per IP per day. Probably not needed at launch; add if seen. |
| `sandbox/` collection group becomes unwieldy in console | Medium aesthetic | Use Firebase Studio / Firestore data filter UI to scope to one visitor's subtree at a time. Worst case: a tiny admin viewer is a Phase S6 task. |

---

## What ships after this

- Anyone with a URL can experience the platform end-to-end. They sign in, land in a populated world, walk through a tender, build their own workflow, and leave a rich lead record with engagement signals.
- Sales has `/leads/` as a queryable pipeline: who signed up, who completed the tour, who tried to invite a teammate, who asked for a callback, what problem they're trying to solve. Sortable, filterable.
- Production deployments are untouched. One client per Firebase remains the production model. New features built in this codebase ship to both surfaces without sandbox-specific code, except for the small set of external-effect wrappers.
- The "single Firebase serves many sandboxes" pattern proves out on visitor-scale traffic before any decision is made to consolidate production Firebases.
- A future TTL cleanup function is a one-day add when the storage curve says it's time.
- A magic-link auth path for cross-browser persistence is a half-week add when sales says repeat-visitor identification is hurting conversions.
- A dedicated leads admin UI is a one-week add when the Firebase console stops scaling for sales operations.

The shape of phase 3 (intelligence layer — pool allotment, telemetry-driven recommendations, etc.) doesn't change because of this work. The sandbox does, however, become a low-risk testbed for phase 3 features: turn it on for sandbox tenants first, observe behavior, then roll to production tenants.
