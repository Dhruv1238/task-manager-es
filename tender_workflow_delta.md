# Tender Workflow — Delta Spec on Top of Task Management MVP

> **Branch context**: this doc layers on top of the v1 `TASK_MANAGEMENT_MVP.md`. It's the spec for the **tender-workflow fork** — new branch, new Firebase project, new hosted URL. The regular task-tracker product continues to exist on the original branch, untouched.
>
> **Naming**: the workflow is called "tender" in the team's vocabulary and on the UI. In the data model we keep the existing `projects` collection as-is — there's no `kind` flag because this fork only does tender projects. If we ever merge the products, we'll add the flag then.
>
> **What carries over**: every existing model, flow, and screen from v1 remains. Auth, member provisioning, teams, projects, tasks, subtasks, comments, attachments, board view, dashboards — all unchanged. This doc only adds.

---

## 1. What's Genuinely New

The fork adds three things on top of v1:

1. **Two new global roles** (`super_admin`, `horizontal_lead`) and one project-scoped role (Vertical Head, derived not stored).
2. **A 10-stage project workflow** with structured transitions, escalation, and rework loops.
3. **Two small additions to the task model**: `workType` (the template category) and `reviewerId` (the named reviewer when a task is in `in_review`).

Everything else is reuse. Stage 7's specialist work and CT validation use the standard task lifecycle plus `reviewerId`. Stage 6 fan-out is the standard task creation modal with a new template dropdown. There is no dedicated fan-out screen, no separate CT validation UI, no special review workflow on tender projects beyond what's available app-wide. Attachments (including the RFP doc) use the existing upload flow.

---

## 2. Updated Role Model

### 2.1 Global roles (extended)

The `users.globalRole` enum gains two values:

| Role | Notes |
|---|---|
| `super_admin` | Tender team — creates tender projects, allocates them to VHs. Replaces what we previously called `admin` for tender purposes. |
| `admin` | (Unchanged from v1.) Now specifically used for vertical heads — Admins are the pool from which a project's VH is picked. |
| `horizontal_lead` | New. Leads a horizontal team (2D, 3D, Video Editing). Receives stage-6 allocations and delegates to specialists. |
| `user` | Default. Team members, specialists, individual contributors. |

> **Migration note** for existing users in the new Firebase: bootstrap your `taskmanager@ai.com` account as `super_admin` instead of `admin` going forward (§13.1 in v1, with the role string updated).

### 2.2 Contextual roles (extended)

| Role | Derivation | New in this fork? |
|---|---|---|
| Project Owner | `project.ownerId === uid` | Same as v1. The tender team member who created the project. |
| **Vertical Head (VH)** | `project.vhId === uid` | **New.** Set at stage 2 by the super admin. The Admin who runs the project workflow. |
| Team Lead | `team.leadId === uid` | Same as v1. Includes horizontal leads now. |
| Team Member | `uid ∈ team.memberIds` | Same as v1. |

Compute these in the existing `usePermissions` hook by reading the project doc's `vhId` field alongside the existing `ownerId`.

### 2.3 Permissions matrix — new rows

| Action | Super Admin | Admin (potential VH) | VH (this project) | Horizontal Lead | CT Lead | CT Member | Other |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Create tender project | ✅ | ❌ | n/a | ❌ | ❌ | ❌ | ❌ |
| Allocate project to VH | ✅ | ❌ | n/a | ❌ | ❌ | ❌ | ❌ |
| Escalate project back (stage 3) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Accept project (stage 4) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add fan-out task (stage 6) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Confirm fan-out complete (6 → 7) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Move task to `in_review` (pick reviewer) | n/a | n/a | ✅ | ✅ | ✅ | ✅ | ✅ (any project member) |
| Approve / reject from `in_review` | n/a | n/a | ✅ | ✅ | ✅ | ✅ | ✅ (the named reviewer, or team lead override) |
| Validation sign-off (7 → 8) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve at review (8 → 10) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Reject at review (8 → 9) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mark delivered (stage 10) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | CS Lead ✅ |

All other permissions inherit from v1.

> **The trust-based middle.** Task-level review (`in_review` ↔ `in_progress` ↔ `done`) is open to any project member by design. Anyone can submit to review, anyone can be picked as a reviewer, the named reviewer or their team lead can decide. Project-level transitions (sign-off, approve/reject, mark delivered) are tightly gated to specific roles because they're public statements about the workflow.

---

## 3. Data Model Changes

### 3.1 `users/{uid}` — one field added

```ts
interface User {
  // ... all v1 fields unchanged
  globalRole: 'super_admin' | 'admin' | 'horizontal_lead' | 'user';   // expanded enum
}
```

No other user fields change. Functional roles like "Designer" or "Copy-Strategy" are *not* stored on the user — they're encoded by which team the user is on.

### 3.2 `teams/{teamId}` — two fields added

```ts
interface Team {
  // ... all v1 fields unchanged
  kind: 'department' | 'horizontal';        // new
  workType?: WorkType;                       // new — only set on horizontal teams
}

type WorkType = 'CS' | 'CT' | '2D' | '3D' | 'VE';
```

The five teams that will exist in this fork:

| Team name | `kind` | `workType` |
|---|---|---|
| Client Servicing — Marcom | `department` | (unset, but conceptually CS) |
| Copy & Strategy | `department` | (unset, but conceptually CT) |
| 2D Graphic Design | `horizontal` | `'2D'` |
| 2D & 3D Events | `horizontal` | `'3D'` |
| Video Editing | `horizontal` | `'VE'` |

> CS and CT live as department teams under Marcom (and Events has its own CS team). Their `workType` is implied by their function but not stored as the canonical team-of-record for that work type. The 2D/3D/VE horizontal teams are the canonical owners — picking work type "2D" in the fan-out modal pre-selects the 2D Graphic Design team.

### 3.3 `projects/{projectId}` — five fields added

```ts
interface Project {
  // ... all v1 fields unchanged

  // New tender workflow fields:
  vhId: string | null;                              // set at stage 2
  stage: 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9 | 10;        // current stage (5 is reserved as a loop target, never stored)
  stageHistory: StageEvent[];                       // append-only audit trail
  escalationCount: number;                          // increments at each stage 3 entry
  vhIterationCount: number;                         // increments at each stage 9 entry

  // New tender-specific business fields:
  submissionDate?: Timestamp;                       // tender deadline to client
  presentationDate?: Timestamp;                     // when we present to client
}

interface StageEvent {
  stage: 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9 | 10;
  enteredAt: Timestamp;
  enteredBy: string;                                // uid of whoever triggered the transition
  payload?: EscalationPayload | IterationPayload | DeliveryPayload | null;
}

interface EscalationPayload {
  reason: string;
  eta?: Timestamp;
  priority: 'low' | 'medium' | 'high';
}

interface IterationPayload {
  iteration: number;                                // matches vhIterationCount at the time
  feedback: string;
  eta?: Timestamp;
  priority: 'low' | 'medium' | 'high';
}

interface DeliveryPayload {
  status: 'won' | 'lost' | 'pending';
  reason?: string;
  nextSteps?: string;
}
```

> **Why `stageHistory` as an array on the project doc** rather than a separate `stageEvents` subcollection: the array is bounded — a project goes through ~10-20 transitions in its lifetime even with rework loops. Cheap to read alongside the project doc. If volume ever becomes an issue, splitting it out is a 30-minute refactor.

### 3.4 `tasks/{taskId}` — two optional fields added

```ts
interface Task {
  // ... all v1 fields unchanged
  workType?: WorkType;          // new — set on fan-out tasks via the template picker, optional/null on freeform tasks
  reviewerId: string | null;    // new — set when status moves to 'in_review', cleared on approve/reject
}
```

That's it. No other task fields change. Subtasks, comments, attachments, status, priority, due dates — all unchanged.

**The `in_review` convention** (no schema change, just a convention to follow): in this fork, `in_review` means "this work is ready for someone to validate." When a task is moved to `in_review`, a reviewer must be picked (`reviewerId` set). When a reviewer rejects (status moves back to `in_progress`), feedback is mandatory and `reviewerId` is cleared. When a reviewer approves (status moves to `done`), `reviewerId` is also cleared. The reviewer is a transient assignment, not a property of the task — it lives on the doc only while review is active.

CT validation uses this same mechanic: specialists submit their work to `in_review` with the CT lead (or any CT member) picked as reviewer. CT validates by approving (→ `done`) or rejecting (→ `in_progress` with feedback). No tender-specific UI on the task itself — the reviewer field is universal.

### 3.5 No new top-level collections

We don't need `tenderEvents`, `validationLogs`, `escalations`, or anything similar. Everything fits in the existing collections plus `stageHistory` on projects.

---

## 4. Stage Reference Card

| # | Name | Actor | Out-transitions |
|---|---|---|---|
| 1 | Project creation | Super Admin | → 2 |
| 2 | Allocate to VH | Super Admin | → 3 (escalate) or → 4 (accept) — VH chooses |
| 3 | Escalation | VH | → 1 (loops back) |
| 4 | Accepted | VH | → 6 (auto, on accept click) |
| 6 | Fan-out | VH | → 7 (when VH confirms fan-out complete) |
| 7 | Specialist work + CT validation (composite) | Horizontal leads + specialists + CT team | → 8 (CT lead signs off) |
| 8 | VH review with CS | VH | → 9 (reject) or → 10 (approve) |
| 9 | Rework | (auto) | → 7 (immediately, with iteration counter ++) |
| 10 | Delivered to client | CS Lead | terminal — `project.status` becomes `completed` |

Stage 5 is reserved as the escalation loop's destination ("back to 1") and never appears as an actual project state.

---

## 5. New Flows

These extend v1's flow numbering. v1 had Flows 0-12 (provisioning, project setup, board, etc.). The tender flows pick up from there.

> **Global note**: every transition writes to `stageHistory` in the same `writeBatch` as the stage change. Don't update `stage` without also appending the event — they're a unit. Centralize this in `lib/firestore.ts` as `transitionStage(projectId, toStage, payload)` so every flow uses the same write shape.

### Flow 13 — Super Admin creates a tender project (stage 1)

**Entry**: `/projects` → "+ New Project" (visible only to super admins).

1. Click → modal with: title, description, owner (defaults to self, picker for any super admin), submission date, presentation date.
2. Click **Create**.
3. Firestore: `addDoc(projects, { title, description, ownerId, vhId: null, status: 'active', stage: 1, stageHistory: [{stage: 1, enteredAt, enteredBy: uid, payload: null}], escalationCount: 0, vhIterationCount: 0, submissionDate, presentationDate, teamIds: [], createdAt, updatedAt })`.
4. Redirect to project page. Page shows banner: **"Stage 1 — awaiting allocation to a Vertical Head"** with an **[Allocate to VH]** button.
5. **Attach the RFP**: the project page has the existing attachments component. Owner uploads the RFP doc using the v1 attachment flow. No special "RFP" field — it's just the first attachment, optionally tagged with a label like "RFP" in the filename or a comment.

### Flow 14 — Super Admin allocates project to VH (stage 1 → 2)

**Entry**: project page in stage 1 → **[Allocate to VH]** button.

1. Click → modal with a single dropdown: "Vertical Head" — populated with all users where `globalRole === 'admin'`.
2. Click **Allocate**.
3. Firestore (single batch via `transitionStage`):
   - `updateDoc(project, { vhId, stage: 2, stageHistory: arrayUnion({stage: 2, enteredAt, enteredBy, payload: null}), updatedAt })`.
4. Project page now shows: **"Stage 2 — assigned to {VH name}, awaiting their decision"**. The **[Allocate to VH]** button is replaced with a passive label.
5. The VH gets the project showing up in their `/me` page (filtered: "Projects assigned to me as VH") — see §7.1.

### Flow 15 — VH escalates back (stage 2/3 → 1)

**Entry**: project page → VH sees **[Accept]** and **[Escalate Back]** buttons in the stage banner.

1. Click **[Escalate Back]** → modal with: reason (textarea, required), ETA (date, optional), priority (low/medium/high, default medium).
2. Click **Submit Escalation**.
3. Firestore (batch):
   - `updateDoc(project, { stage: 1, vhId: null, escalationCount: increment(1), stageHistory: arrayUnion({stage: 3, enteredAt, enteredBy: vhUid, payload: {reason, eta, priority}}), updatedAt })`.
   - Note: we record entry to stage 3 in history, but the project's *current* stage moves directly back to 1 (since 3's only transition is the loop). The history shows the escalation event; the live state is "back at 1, awaiting re-allocation."
4. Project page now shows the stage 1 banner again, plus a notice: **"Escalated by {VH} — see history."** Super admin re-allocates (Flow 14) or revises and re-submits.
5. The escalation count is shown as a small badge near the project title (e.g., "Escalated 2x").

### Flow 16 — VH accepts and starts fan-out (stage 2 → 4 → 6)

**Entry**: project page → VH clicks **[Accept]**.

1. Click → confirmation modal: "Accept this project and proceed to fan-out?"
2. Click **Accept**.
3. Firestore (batch):
   - `updateDoc(project, { stage: 6, stageHistory: arrayUnion({stage: 4, enteredAt, enteredBy: vhUid, payload: null}, {stage: 6, enteredAt, enteredBy: vhUid, payload: null}), updatedAt })`.
   - Stages 4 and 6 are appended back-to-back since stage 4 is transient (acceptance) and immediately resolves to 6 (fan-out begins).
4. Page transitions to the project's stage 6 view: a regular project page with a stage 6 banner that says **"Stage 6 — Add fan-out tasks, then confirm"** and shows a **[Confirm fan-out complete →]** button (disabled until at least one task has been added).

> **Why no separate fan-out screen?** Earlier drafts of this doc had a dedicated `/fanout` route. We dropped it. Stage 6 is just "the VH is creating tasks" — exactly what the existing project page already supports. The template picker (Flow 17) plus a single confirm button (Flow 17.5) is enough.

### Flow 17 — Task creation with templates (used at stage 6 and beyond)

This flow **extends** v1's task creation modal. It's not stage-specific — templates are available any time anyone creates a task on a tender project. The VH uses them heavily during stage 6, but a horizontal lead might use the "2D" template later if extra design work surfaces.

**Entry**: anywhere a user can create a task ("+ New Task" button on the project page, the team page, or the board).

1. Click **+ New Task** → existing v1 task creation modal opens.
2. **New addition at the top of the modal**: a **Template** dropdown with options:
   - **2D — Graphic Design**
   - **3D — Events 2D & 3D**
   - **VE — Video Editing**
   - **CS — Client Servicing**
   - **CT — Copy & Strategy**
   - **Custom task** (default; no pre-fill — same as v1 behavior)
3. **Picking a predefined template** auto-fills the form:
   - `team` → the canonical team for that work type (e.g., "2D Graphic Design")
   - `assignee` → that team's lead (e.g., Rajendra Deolikar for 2D)
   - `title` → suggested default (e.g., "2D deliverables") — fully editable
   - `workType` → set to the picked code (e.g., `'2D'`)
   - All fields remain editable. The user can override the team/assignee if they really want; the template is a convenience, not a constraint.
4. **Picking Custom** leaves all fields blank (existing v1 behavior).
5. Other fields (description, priority, due date) are filled in normally.
6. Click **Create**.
7. Firestore: standard task creation from v1 Flow 4, with `workType` set to the picked value (or omitted for custom).
8. Modal closes, task appears wherever tasks are listed.

**Template config**: store the template definitions in a Firestore config doc at `/config/taskTemplates`, not hardcoded in the client. Shape:

```ts
interface TaskTemplateConfig {
  templates: {
    code: WorkType;
    label: string;        // "2D — Graphic Design"
    teamId: string;       // canonical team for this work type
    defaultTitle: string; // "2D deliverables"
  }[];
}
```

The seed script (§8) writes this doc once. Reading it from Firestore (instead of hardcoding) means swapping the template's canonical team is a one-doc edit, not a code change. Also makes dev/staging/prod environments cleanly separable since each can have its own seeded teams.

### Flow 17.5 — VH confirms fan-out complete (stage 6 → 7)

**Entry**: project page in stage 6 → **[Confirm fan-out complete →]** button in the stage banner. Visible only to the VH. Enabled once at least one team-level task exists on the project.

1. Click → confirmation modal: "Move to stage 7? Leads will start working on their allocations." Shows a summary of the tasks added so far (count by work type).
2. Click **Confirm**.
3. Firestore (batch via `transitionStage`):
   - `updateDoc(project, { stage: 7, stageHistory: arrayUnion({stage: 7, enteredAt, enteredBy: vhUid, payload: null}), updatedAt })`.
4. Banner changes to the stage 7 message; the confirm button disappears.

> **VH can return to stage 6 to add more tasks?** No. Once stage 7 is confirmed, the fan-out is locked. If the VH needs to add more workflow tasks, they create them as regular team-level tasks via v1's Flow 4 — they just don't count as part of the original fan-out record.

### Flow 18 — Stage 7: specialist work + CT validation via `in_review`

**Entry**: project enters stage 7 after Flow 17.5 (or returns to it after a stage 9 rework loop).

This stage uses **only existing v1 mechanics plus the new reviewer field**. There is no tender-specific UI for validation — it's built entirely on top of the standard task lifecycle.

**The task lifecycle inside stage 7**:

1. Horizontal leads (2D, 3D, VE) receive their team-level fan-out tasks. They use v1's Flow 5 to create subtasks and assign specialists.
2. Specialists work on their subtasks. When ready, they move the subtask to `in_review` and pick a reviewer (Flow 18a below).
3. The reviewer validates and either approves (→ `done`) or rejects with feedback (Flow 18b/c below).
4. Rejected work goes back to `in_progress`; the assignee (or a new assignee picked by the reviewer) reworks it; cycles back to `in_review` until approved.
5. When CT is satisfied with everything, the CT lead clicks the project-level sign-off button to advance the project from stage 7 to stage 8.

**Flow 18a — Submit task to review** (used by anyone, anytime — not just on tender projects)

**Entry**: task detail view → status dropdown → pick `In Review`.

1. A modal opens with two fields:
   - **Reviewer** (required): searchable dropdown of all project members. Default-suggested: the project's CT lead (computed from the CT team's `leadId`). User can pick anyone on the project.
   - **Notes for reviewer** (optional): textarea, appended as a comment on submit.
2. Click **Submit for Review**.
3. Firestore (batch via `transitionTaskToReview` helper):
   - `updateDoc(task, { status: 'in_review', reviewerId, updatedAt })`
   - If notes were provided: `addDoc(comments, { content: notes, authorId, ... })`.
4. Task now displays a **"🔍 In review by {Reviewer Name}"** banner. The task shows up in the reviewer's "Awaiting my review" inbox (§7.1).

**Flow 18b — Reviewer approves**

**Entry**: task detail view, viewed by the named reviewer.

1. Reviewer sees **[Approve →]** and **[Send Back ↺]** buttons in the task header (only visible when `currentUser.uid === task.reviewerId`).
2. Click **[Approve →]** → confirmation: "Mark this as done?" Optional: approval comment textarea.
3. Click **Confirm**.
4. Firestore (batch via `transitionTaskFromReview` helper):
   - `updateDoc(task, { status: 'done', reviewerId: null, completedAt: serverTimestamp(), updatedAt })`
   - If subtask: also `updateDoc(parent, { subtaskDoneCount: increment(1) })`.
   - If approval comment provided: `addDoc(comments, ...)`.

**Flow 18c — Reviewer rejects (sends back)**

**Entry**: task detail view, viewed by the named reviewer.

1. Click **[Send Back ↺]** → modal with:
   - **Feedback** (required, non-empty enforced by `transitionTaskFromReview` helper): textarea explaining what needs to change.
   - **Reassign to** (optional): dropdown of team members. Defaults to the original assignee.
2. Click **Send Back**.
3. Firestore (batch via `transitionTaskFromReview` helper):
   - `updateDoc(task, { status: 'in_progress', reviewerId: null, assigneeId: newAssigneeId || originalAssigneeId, updatedAt })`
   - `addDoc(comments, { content: feedback, authorId: reviewerUid, ... })`.
4. Task drops back to `in_progress`. The (possibly new) assignee sees it in their `/me` page and works on it. When ready, they re-submit to review (Flow 18a) — possibly with the same reviewer, possibly someone else.

> **Mandatory feedback enforcement**: lives in the `transitionTaskFromReview` helper in `lib/firestore.ts`. The helper rejects the call (throws) if `decision === 'reject'` and `feedback` is empty or whitespace. This is frontend-only enforcement; we trust the team not to bypass it via the Firestore console. If a stricter guarantee is ever needed, encode it as a Firestore security rule that requires a comment write on any `in_review → in_progress` transition.

> **Who can approve or reject?** The named `reviewerId` is the primary actor. As an override, any team lead on the project can also approve/reject — useful when the named reviewer is unavailable. Anyone else hitting the buttons gets nothing rendered.

**Project-level: CT lead signs off (stage 7 → 8)**

The only project-level transition during stage 7. CT lead-only.

1. CT lead's project page header shows a **[Validation complete — sign off]** button. Visible only when:
   - `project.stage === 7`, AND
   - `currentUser.uid === ctTeam.leadId`.
2. Click → confirmation modal listing the 5 fan-out tasks and their statuses, with a checkbox: "I confirm CT has validated all deliverables and the project is ready for VH review."
3. Click **Sign off**.
4. Firestore (batch via `transitionStage`):
   - `updateDoc(project, { stage: 8, stageHistory: arrayUnion({stage: 8, enteredAt, enteredBy: ctLeadUid, payload: null}), updatedAt })`.
5. Project page transitions to the stage 8 review view.

> **Validation soft-gate**: the sign-off button is *not* hard-gated on all tasks being marked `done`. CT can sign off whenever they decide they're satisfied — that's their judgment call. We surface task statuses visually but don't enforce. (One-line check at the top of the click handler if the team wants enforcement later.)

### Flow 19 — VH review at stage 8

**Entry**: VH sees the project, now in stage 8, with a review banner and **[Approve →]** / **[Reject — Send Back]** buttons.

The page shows: the 5 fan-out tasks with their final statuses, the CS team's deliverables (which CS will walk the VH through), and a comment thread on the project itself for review notes.

**Approve path**:

1. VH clicks **[Approve →]**.
2. Confirmation modal: "Approve and move to client delivery?"
3. Click **Confirm**.
4. Firestore (batch):
   - `updateDoc(project, { stage: 10, stageHistory: arrayUnion({stage: 10, enteredAt, enteredBy: vhUid, payload: null}), updatedAt })`.
5. Project moves to stage 10 (Flow 20).

**Reject path**:

1. VH clicks **[Reject — Send Back]**.
2. Modal with: feedback (textarea, required), ETA (date, optional), priority (default medium). Iteration number is auto-displayed (`vhIterationCount + 1`).
3. Click **Send Back**.
4. Firestore (batch):
   - `updateDoc(project, { stage: 7, vhIterationCount: increment(1), stageHistory: arrayUnion({stage: 9, enteredAt, enteredBy: vhUid, payload: {iteration: vhIterationCount + 1, feedback, eta, priority}}, {stage: 7, enteredAt, enteredBy: vhUid, payload: null}), updatedAt })`.
   - Same pattern as escalation: stage 9 is recorded as an event, project's current stage immediately goes to 7.
5. Project drops back into stage 7. CT lead's sign-off button reappears. Iteration counter shown as "Iteration 2" badge.

### Flow 20 — CS delivers to client (stage 10)

**Entry**: project in stage 10 → CS lead sees **[Mark Delivered]** button on the project page.

1. Click → modal with: outcome (radio: won / lost / pending), reason (textarea, optional), next steps (textarea, optional).
2. Click **Submit**.
3. Firestore (batch):
   - `updateDoc(project, { status: 'completed', stageHistory: arrayUnion({stage: 10, enteredAt, enteredBy: csLeadUid, payload: {status, reason, nextSteps}}), updatedAt })`.
   - Note: stage 10 was entered when VH approved (Flow 19), but stage 10 has *two* events: entering it (no payload) and completing it (with delivery payload). The history will show both.
4. Project moves to status `completed`. Banner: "Delivered — {outcome}". Project becomes read-only except for super admins / the owner.

---

## 6. UI Updates

### 6.1 New screens

- **No new screens** for stages 1, 2, 6, 7. Each is just the existing project page with a stage-aware banner. Stage 6 specifically uses the existing project page + the **[Confirm fan-out complete →]** banner button (Flow 17.5); the VH adds tasks using the existing **+ New Task** button with the new template dropdown (Flow 17).
- **Stage review screen** (Flow 19) — could be a tab on the project page rather than a separate route. Visible when stage is 8 and user is the VH.

### 6.2 Stage banner (every project page)

A persistent banner at the top of every project page shows:
- Current stage number and name (e.g., "Stage 7 — Specialists working, CT validating").
- Stage-appropriate action buttons (Accept/Escalate at stage 2; Sign-off at stage 7 for CT lead; Approve/Reject at stage 8 for VH; Mark Delivered at stage 10 for CS).
- Counters: escalation count (if > 0), iteration count (if > 0).
- A **[Stage history]** link that opens a side panel showing the full `stageHistory` array as a timeline.

### 6.3 Project list / `/me` filters

Add filter chips on `/me` and `/projects`:
- **By stage**: filter to projects in stages 1, 2, 7, 8, etc.
- **By role on project**: "Projects I'm VH on", "Projects awaiting my action" (computed: stage is one where I'm the actor).

The "Projects awaiting my action" filter is the most valuable — it's the per-user inbox of work the workflow is blocked on.

### 6.4 Stage history side panel

Reusable component that renders `stageHistory` as a vertical timeline:
- Each event shows: stage number, name, timestamp, actor name.
- Events with payloads (escalation, iteration, delivery) expand to show the structured fields.
- Differentiate visually: forward transitions vs loop-back transitions.

### 6.5 Dashboards — additions to v1's §10

The v1 dashboards (admin, project, team, `/me`) all still apply. Add **one new dashboard panel** specific to tender workflow, on the super admin dashboard (`/admin`):

- **Tender pipeline funnel**: count of projects in each stage. Visualizes where tenders are getting stuck. Stages 1, 2, 7, 8 will dominate; if 7 or 8 are persistently large, that's a bottleneck signal.
- **At-risk by submission date**: projects where `submissionDate - now < 7 days` AND `stage < 10`. Replaces v1's deadline-based at-risk panel for tender projects.
- **Average time-in-stage**: per stage, how long projects sit there. Computed from `stageHistory` adjacent timestamps. Helps the org see whether the bottleneck is stage 7 (specialist throughput) vs stage 8 (VH availability).
- **Escalation and iteration leaderboard** *(optional, possibly hide unless explicitly requested — can become political)*: which VHs escalate most, which projects iterate most. Useful as a metric, sensitive as a public stat.

### 6.6 Permission-gated buttons throughout

The action buttons in stage banners and task headers are gated tightly. Implement once in `usePermissions` and reuse:

```ts
const projectPerms = usePermissions(projectId);
// project-level flags:
// projectPerms.canAcceptOrEscalate    // VH at stage 2
// projectPerms.canAddFanoutTask       // VH at stage 6
// projectPerms.canConfirmFanout       // VH at stage 6 with at least 1 task
// projectPerms.canSignOffValidation   // CT lead at stage 7
// projectPerms.canApproveOrReject     // VH at stage 8
// projectPerms.canMarkDelivered       // CS lead at stage 10

const taskPerms = useTaskPermissions(task);
// task-level flags:
// taskPerms.canSubmitForReview        // assignee or team lead, on a non-done task
// taskPerms.canDecideReview           // I am task.reviewerId, OR a team lead override
```

Buttons render conditionally on these flags. A user without the right role/stage combination doesn't see the button at all — no greyed-out states, no "you don't have permission" toasts.

---

## 7. Filtering, Notifications, and Inbox

### 7.1 The "/me" page becomes the universal inbox

In v1, `/me` shows tasks assigned to me, grouped by Project → Team. In the tender fork, `/me` becomes the inbox for everything blocking on the user. Sections, top to bottom:

**Section 1 — "Awaiting my review"** (visible to all users)

Tasks where I'm the named reviewer:

- Query: `tasks where reviewerId == currentUser.uid AND status == 'in_review'`.
- Renders at the top because it's the most blocking — someone is waiting on me.
- Each row shows: task title, project name, original assignee (so I know whose work I'm reviewing), submitted-at timestamp, and **[Approve]** / **[Send Back]** quick-action buttons.
- Empty when nothing is awaiting my review (most users most of the time). Just collapse the section in that case.

**Section 2 — "Projects awaiting my action"** (visible to all users; non-empty mostly for VHs, CT lead, CS lead, super admins)

Projects where the workflow is blocked on me as VH / CT lead / CS lead:

- Query: client-side filter over projects I have access to. `(stage == 2 AND vhId == me) OR (stage == 7 AND I'm CT lead) OR (stage == 8 AND vhId == me) OR (stage == 10 AND I'm CS lead)`. Firestore can't OR across fields cleanly, so fetch projects I have access to (using v1's existing query) and filter client-side. Small data, fast.
- Each card shows: project title, current stage with name, the action I need to take, and a **CTA button** (Accept/Escalate; Sign-off; Approve/Reject; Mark Delivered).

**Section 3 — "Assigned to me"** (visible to all users — this is v1's existing layout)

The grouped Project → Team → Task list from v1 Flow 6, unchanged. Includes my open tasks across all teams I'm on. Status counts ("2 open, 2 done, 1 led, 2 overdue") render at the top of this section.

**Section 4 — "Led by me"** (visible to team leads — v1 behavior, unchanged)

Team-level tasks on teams I lead, even if not assigned to me personally.

**Section 5 — "In review on my CT projects"** *(visible only to users on the CT team)*

The supervisory view CT members get on top of the personal sections. For each project the user has access to as a CT team member, shows all tasks currently in `in_review` status — regardless of who the named reviewer is.

- Query: `tasks where projectId in (CT-accessible projects) AND status == 'in_review'`.
- Rendered grouped by Project → Team, like section 3, with each task showing the named reviewer's avatar plus the original assignee.
- Lets CT members see at a glance what's queued for validation across all their tenders, even items where they aren't personally the named reviewer. Useful for load balancing within CT (if Saket is buried, Garima can pick up Saket's queue).
- Renders below the personal sections so it doesn't dominate the layout — it's supervisory, not actionable-by-default.

> **Layout summary**: Awaiting my review → Projects awaiting my action → Assigned to me → Led by me → (CT only) In review on my CT projects → Completed work this week. Each section collapses cleanly when empty.

### 7.2 Notifications

**Out of scope for the fork's first cut.** The "/me" page acts as the inbox. If we add real notifications later (email, push), the trigger points are the stage transitions — easy to bolt on without restructuring.

---

## 8. Data Migration / Bootstrap

Since this is a fresh Firebase project on a new branch:

1. **Bootstrap super admin** as before (§13.1 of v1), but set `globalRole: 'super_admin'`.
2. **Create the 5 horizontal/department teams** with the right `kind` and `workType` values. Either by hand in the console for the first run, or via a one-time seed script in `scripts/seed-tender-teams.ts`.
3. **Provision real users** (Sandeep, Divya, Rachna, Alankrita as `admin`; horizontal leads as `horizontal_lead`; everyone else as `user`) using the existing Flow 0 from v1. Add them to the appropriate teams.
4. **Create the first test tender project** to walk through the workflow end-to-end before showing real users.

A seed script is worth the 30 minutes — onboarding ~15 users by hand through the modal flow is slow, and the script doubles as documentation of the org structure.

---

## 9. Build Order

Pick up after v1's build order ended (Flow 12 + dashboards). Tender flows go in this order:

1. **Schema migration** — extend the `User`, `Team`, `Project`, `Task` interfaces in `types.ts` (including new `reviewerId` and `workType` on tasks). Update `usePermissions` and add `useTaskPermissions` hook for review actions. Add `lib/firestore.ts` helpers `transitionStage()`, `transitionTaskToReview()`, `transitionTaskFromReview()`.
2. **Stage banner component** — generic, reads project stage and renders appropriate banner + buttons. Stub all buttons initially.
3. **Seed script** (§8) — write the 5 teams plus the `/config/taskTemplates` doc. Without this, the template picker has nothing to point at.
4. **Flow 13** — tender project creation. Test by creating a project that lands in stage 1.
5. **Flow 14** — VH allocation. Test by transitioning 1 → 2.
6. **Flow 15** — escalation. Test the loop back to 1.
7. **Flow 16** — VH accepts and lands at stage 6.
8. **Flow 17** — task creation modal with template picker. Test creating each predefined template plus a custom task.
9. **Flow 17.5** — Confirm fan-out button (6 → 7).
10. **Flow 18a/b/c** — submit-to-review modal, approve, reject-with-feedback. Test the full task review loop on a single subtask. *This is the heart of stage 7 and used by every flow downstream.*
11. **CT lead sign-off button** (project-level 7 → 8) — completes Flow 18.
12. **Flow 19** — VH review approve/reject at stage 8.
13. **Flow 20** — CS delivery at stage 10.
14. **Stage history side panel** — reads existing data, no new writes.
15. **`/me` rebuild** — sections in the order: awaiting my review, projects awaiting my action, assigned to me, led by me, CT supervisory view (conditional), completed this week.
16. **Tender dashboard panels** on `/admin`.
17. **Polish**: stage filter chips on project list, escalation/iteration counter badges, in-page hints about what each stage means, "in review by X" badges on task cards everywhere they appear (boards, lists, /me).

Each numbered step is independently demoable. Build them in order and don't skip ahead. Step 10 is the keystone — once review-with-reviewer is working on one task, every subsequent flow inherits the mechanic for free.

---

## 10. Assumptions Specific to This Fork

Adds to v1's §12.

1. **No `kind` flag on projects.** This fork only does tender projects. Every project follows the workflow.
2. **The 5 work types are fixed** (`CS, CT, 2D, 3D, VE`). Adding new types means a code change. If the org wants a 6th category, that's a new entry in `WorkType` plus a new template config entry.
3. **The fan-out is not auto-generated.** The VH manually adds tasks at stage 6 using the template picker on the standard task creation modal. A tender that legitimately has no 3D component just doesn't get a 3D task.
4. **Templates are stored in Firestore at `/config/taskTemplates`**, not hardcoded. Edit the doc to change which team is canonical for which work type.
5. **Task review uses `in_review` + `reviewerId`** — the same mechanic for all reviews, including CT validation. No CT-specific UI on tasks.
6. **Anyone can submit a task to review** and pick any project member as reviewer (default-suggested: CT lead). The named reviewer or a team lead override can decide. Trust-based, not gate-based.
7. **Mandatory feedback on rejection** is enforced in `lib/firestore.ts` only — frontend trust, not a Firestore rule. Sufficient for MVP.
8. **`reviewerId` is transient.** Set on `in_review` entry, cleared on approve/reject. Past reviewers live in the comment thread, not on the live record.
9. **CT validation is judgment-based, not gate-based.** The CT lead can sign off the project-level transition (7 → 8) whenever they consider validation complete; the system surfaces task statuses but doesn't enforce "all tasks done before sign-off."
10. **Only the CT lead** signs off on stage 7 → 8. CT team members can validate and approve individual tasks but the project transition is the lead's call.
11. **Only the CS lead** can mark delivered at stage 10. Same pattern.
12. **Stage 6 is locked once exited.** Adding more workflow tasks after CT sign-off means creating regular team-level tasks via v1's Flow 4, not modifying the original fan-out.
13. **`stageHistory` is append-only.** Never edited, never deleted. If a transition was wrong, fix it forward (transition again) rather than rewriting history.
14. **VH escalating zeroes out `vhId`.** When the project loops back to stage 1, the super admin reassigns from scratch (could be the same VH, could be different). This is intentional — escalation is a real "I can't take this" not "I want to take it later."
15. **Iteration and escalation counters never reset.** They accumulate over the project's life. A project that's been escalated twice and iterated three times shows that history visibly.