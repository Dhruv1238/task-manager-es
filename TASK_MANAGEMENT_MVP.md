# Task Management MVP — Technical Design Document

> **Purpose**: A Jira-like task management tool for running multiple projects, each staffed by one or more teams, where team-level tasks are delegated to individual members. Hackathon-grade MVP.

> **Already in place**: Vite + React + TypeScript, Tailwind, React Router, Firebase Auth context, signup/login wall.

---

## 1. Terminology

| Term | Meaning |
|---|---|
| **Project** | Top-level container of work. Has an owner, deadline, assigned teams, and tasks. |
| **Team** | A **globally defined** group of people (e.g., "Design Team", "Backend Team"). Has a lead and members. Can be assigned to many projects. |
| **Team-level task** | A task owned by a team as a whole on a specific project. Usually broken into subtasks. |
| **Subtask** (individual task) | Assigned to one user (e.g., A1, A2). Parent = team-level task. |
| **Comment** | Text + optional attachment on a task, visible to everyone with access to the task. |

---

## 2. Role Model

Two layers: **global** (app-wide) and **contextual** (derived per project / team).

### 2.1 Global roles (stored on `users` doc)

- `admin` — Creates projects and teams, manages users, sees everything. A small bootstrapped set.
- `user` — Default. Only sees projects/teams they belong to.

### 2.2 Contextual roles (computed, not stored separately)

| Role | Derivation | Powers |
|---|---|---|
| **Project Owner** | `project.ownerId === uid` | Full control of the project: assign/remove teams, create team-level tasks, reassign, delete tasks, edit project meta. |
| **Team Lead** | `team.leadId === uid` | Manage team roster, create/assign subtasks inside the team, edit any task in the team (on any project the team is assigned to). |
| **Team Member** | `uid ∈ team.memberIds` | View all tasks owned by that team on projects it's assigned to. Edit tasks assigned to them. Comment on any task in the team. |
| **Outsider** | None of the above | No access. |

Compute these in a `usePermissions(projectId?, teamId?)` hook by reading the project/team docs. Don't denormalize contextual roles.

---

## 3. Data Models (Firestore)

All timestamps use `serverTimestamp()`. Doc IDs are Firestore auto-IDs unless noted.

### 3.1 `users/{uid}`

Doc ID **is** the Firebase Auth UID. Upsert on first login (in your existing auth context).

```ts
interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  globalRole: 'admin' | 'user';
  teamIds: string[];           // denormalized — teams this user is in. Updated on team roster changes.
  tempPassword?: string;       // auto-generated at provisioning time; visible to admins so they can share with the user. See §13.
  createdBy?: string;          // uid of the admin who provisioned this user
  createdAt: Timestamp;
}
```

> `teamIds` on the user doc is the fast path for "show me my teams" and "find my projects" queries.
> `tempPassword` is stored in plaintext **on purpose for this MVP** so admins can look it up anytime. Not production-safe. See §13.

### 3.2 `teams/{teamId}` (top-level, global)

```ts
interface Team {
  id: string;
  name: string;                // "Design Team", "Backend Team"…
  description?: string;
  leadId: string;              // users/{uid}
  memberIds: string[];         // includes leadId
  projectIds: string[];        // denormalized — which projects this team is on
  createdAt: Timestamp;
  createdBy: string;
}
```

### 3.3 `projects/{projectId}`

```ts
interface Project {
  id: string;
  title: string;
  description: string;
  ownerId: string;             // users/{uid}
  status: 'active' | 'completed' | 'archived';
  deadline?: Timestamp;
  teamIds: string[];           // global teams assigned to this project
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 3.4 `tasks/{taskId}` (flat, top-level)

Flat collection — do **not** nest under project/team. We need to query across them ("all tasks assigned to me", "overdue tasks across projects").

```ts
interface Task {
  id: string;
  projectId: string;
  teamId: string;                // every task belongs to exactly one team on one project
  parentTaskId: string | null;   // null = team-level task; set = subtask

  title: string;
  description: string;

  assigneeId: string | null;     // null = unassigned (typical for team-level tasks)
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high';
  dueDate?: Timestamp;

  // Denormalized for list UIs and charts — keep updated on writes:
  assigneeName?: string;
  teamName?: string;
  projectTitle?: string;

  // Rollup counters for parent tasks (updated in same batch as subtask writes):
  subtaskCount?: number;
  subtaskDoneCount?: number;

  attachments: Attachment[];

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;       // set when status → 'done'. Powers burndown & velocity charts.
}

interface Attachment {
  id: string;                    // client-generated uuid for the attachment entry
  name: string;                  // from API response `data.fileName`
  url: string;                   // S3 URL from API response `data.url`
  key: string;                   // S3 key from API response `data.key` — keep it in case you later need to delete/reference
  mimeType: string;              // from API response `data.contentType`
  sizeBytes: number;             // from API response `data.sizeBytes`
  uploadedBy: string;            // uid of uploader
  uploadedAt: Timestamp;
}
```

**Indexes you'll need** (Firestore will prompt):
- `tasks` where `projectId ==` + orderBy `createdAt desc`
- `tasks` where `teamId ==` + orderBy `createdAt desc`
- `tasks` where `assigneeId ==` + orderBy `updatedAt desc`
- `tasks` where `parentTaskId ==`
- `tasks` where `assigneeId ==` + where `status !=` `'done'` (for bandwidth queries)

### 3.5 `tasks/{taskId}/comments/{commentId}`

```ts
interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;            // denormalized
  content: string;               // plain text or markdown
  attachments: Attachment[];
  createdAt: Timestamp;
  editedAt?: Timestamp;
}
```

---

## 4. Firestore Tree

```
/users/{uid}
/teams/{teamId}
/projects/{projectId}
/tasks/{taskId}
    /comments/{commentId}
```

Clean and flat. Teams are global; projects reference teams by ID; tasks reference both.

---

## 5. File Uploads — External Asset Service

All file uploads (task attachments, comment attachments) go through an external asset service. **Firebase Storage is not used.** Firestore only stores the returned metadata (URL, key, filename, size) as part of the `Attachment` object on the task or comment doc.

### 5.1 Endpoint

```
POST https://event-experience-svc-stg.eventstrat.ai/api/v1/assets/upload
Headers:
  accept: */*
  x_tenant_code: <TENANT_CODE>
  (Content-Type is set automatically by the browser when using FormData — do NOT set it manually)
Body: multipart/form-data with a single field `file`
```

### 5.2 Tenant code

Use a **single constant for the entire app**: `taskflow`.

Configure via Vite env var so it's changeable in one place:

```
# .env
VITE_TENANT_CODE=taskflow
VITE_ASSET_UPLOAD_URL=https://event-experience-svc-stg.eventstrat.ai/api/v1/assets/upload
```

### 5.3 Response shape

```json
{
  "st": true,
  "msg": "Asset uploaded successfully",
  "data": {
    "url": "https://eventstrat-global.s3.ap-south-1.amazonaws.com/assets/taskflow/2026/04/<uuid>-<filename>",
    "key": "assets/taskflow/2026/04/<uuid>-<filename>",
    "contentType": "application/pdf",
    "sizeBytes": 95250,
    "fileName": "task_management_data_document.pdf",
    "tenantCode": "taskflow"
  }
}
```

- Success: `st === true`. Use `data.url`, `data.key`, `data.contentType`, `data.sizeBytes`, `data.fileName` to build the `Attachment` object (§3.4).
- Failure: `st === false` or HTTP non-2xx. Show `msg` to the user.

> Helper function implementation is in §13.4.
> CORS caveat: the service must allow requests from your dev origin (`http://localhost:5173`) and your deployed origin. If you see CORS errors, that's a service-side config, not a client bug.

---

## 6. Permissions Matrix

| Action | Admin | Project Owner | Team Lead | Team Member |
|---|:-:|:-:|:-:|:-:|
| Create project | ✅ | ❌ | ❌ | ❌ |
| Edit/delete project | ✅ | ✅ | ❌ | ❌ |
| Change project status (active / completed / archived) | ✅ | ✅ | ❌ | ❌ |
| Create team (global) | ✅ | ❌ | ❌ | ❌ |
| Edit team roster | ✅ | ❌ | ✅ (own team) | ❌ |
| Assign team to project | ✅ | ✅ | ❌ | ❌ |
| Remove team from project | ✅ | ✅ | ❌ | ❌ |
| Create team-level task | ✅ | ✅ | ✅ (on projects the team is on) | ❌ |
| Create subtask | ✅ | ✅ | ✅ | 🟡 (under tasks assigned to them) |
| Assign subtask | ✅ | ✅ | ✅ | ❌ |
| Edit task title/desc | ✅ | ✅ | ✅ | 🟡 (own tasks only) |
| Change task status | ✅ | ✅ | ✅ | 🟡 (own tasks only) |
| Upload attachment | ✅ | ✅ | ✅ | 🟡 (own tasks only) |
| Comment on task | ✅ | ✅ | ✅ | ✅ (tasks in their team on that project) |
| Delete task | ✅ | ✅ | ✅ | ❌ |
| View `/projects` and `/teams` lists | ✅ (all) | ✅ (own + team-assigned) | ✅ (own teams) | ✅ (own teams) |
| View project board (`/projects/:id/boards`) | ✅ | ✅ | ✅ (if their team is on the project) | ✅ (if their team is on the project) |

---

## 7. Task Lifecycle

```
    todo ──► in_progress ──► in_review ──► done
      ▲           │              │
      │           ▼              │
      └──────── blocked ◄────────┘
```

Rules:
- Anyone with edit rights on a task can move it to any status. No server-side state machine in MVP.
- When `status` transitions to `'done'`, set `completedAt: serverTimestamp()` in the same write.
- When `status` transitions away from `'done'`, clear `completedAt`.
- Marking a team-level task `done` does NOT cascade to subtasks, and completing all subtasks does NOT auto-close the parent. Team lead decides.

---

## 8. Progress Tracking

All client-side. No Cloud Functions needed for MVP.

### Per-task
- `done` → 100%, else 0% for leaf tasks.
- For a team-level task with subtasks: `subtaskDoneCount / subtaskCount`.

### Per-team (on a project)
Avg progress of team-level tasks where `projectId == X` and `teamId == Y` and `parentTaskId == null`.

### Per-project
Avg progress of all team-level tasks where `projectId == X` and `parentTaskId == null`. Show per-team breakdown.

### Per-user (bandwidth score) — *used for visualizations*
```
bandwidth(user) = count of tasks where assigneeId == user AND status != 'done'
```
Optional weighted version:
```
weighted(user) = Σ priority_weight(t) for each open task t
                 where priority_weight = { low: 1, medium: 2, high: 3 }
```
Thresholds (tune to taste): **0–2 available**, **3–5 healthy**, **6+ overloaded**.

### Denormalization rules (keep counters honest)
Run these in `writeBatch` together with the primary write — centralize in `lib/firestore.ts` so nobody forgets:

| Event | Writes |
|---|---|
| Create subtask | subtask doc + `parent.subtaskCount += 1` |
| Delete subtask | subtask doc delete + `parent.subtaskCount -= 1` (and `subtaskDoneCount -= 1` if it was done) |
| Subtask status → done | `subtask.status`, `subtask.completedAt`, `parent.subtaskDoneCount += 1` |
| Subtask status leaves done | `subtask.status`, `subtask.completedAt = null`, `parent.subtaskDoneCount -= 1` |
| Assign team to project | `project.teamIds += teamId`, `team.projectIds += projectId` |
| Remove team from project | inverse |
| Add member to team | `team.memberIds += uid`, `user.teamIds += teamId` |
| Remove member from team | inverse |

---

## 9. User Flows

Each flow is written as: **Entry → UI steps → Firestore ops → Outcome**. Follow these exactly when building.

> **Global admin action bar**: On every admin-facing page (`/projects`, `/teams`, `/admin/members`, `/admin`), render three primary action buttons together in the page header: **[+ New Project] [+ New Team] [+ New Member]**. Each opens its respective modal (Flow 2, Flow 1, Flow 0). They're always available — admin can provision a new user from any screen without navigating away.

### Flow 0 — Admin provisions a member

**Entry**: Anywhere admin sees a **[+ New Member]** button, OR inline via **[+ Create new member]** inside any user picker (team creation, add-to-team roster, project owner picker).

1. Click **+ New Member** → modal with fields: email, display name.
2. App auto-generates a strong temporary password client-side (e.g. `crypto.randomUUID().slice(0, 12)` or a readable word-based generator — pick one).
3. Admin clicks **Create**.
4. App calls `createMember(email, displayName, tempPassword)` (see §13 for the code) which:
   - Creates the Firebase Auth user via a **secondary Firebase app instance** (so the admin's own session isn't hijacked).
   - Creates `/users/{uid}` doc with `{ email, displayName, globalRole: 'user', teamIds: [], tempPassword, createdBy: adminUid, createdAt }`.
   - Signs out and tears down the secondary app.
5. Modal shows a success screen with the credentials and a **Copy** button (copies `email / password` to clipboard). Admin sends this to the user out-of-band (Slack, email, shouting across the hackathon table).
6. **If opened inline** (e.g., from inside team creation): the new user is automatically selected in the parent picker when the modal closes. No context lost.

> Admin can re-look-up any user's temp password at any time from the Members page (§9 Flow 11).

### Flow 1 — Admin creates a team (global)

**Entry**: `/teams` page, admin-only "New Team" button (also available from the global action bar).

1. Admin clicks **New Team** → modal opens with fields: name, description, lead (searchable dropdown of all users), members (multi-select of all users).
2. Inside the lead dropdown and the members multi-select, a **[+ Create new member]** button is rendered at the bottom of the list. Clicking it opens Flow 0 inline; on success the new user is auto-selected.
3. Lead is auto-added to members.
4. Admin clicks **Create**.
5. Firestore:
   - `addDoc(teams, { name, description, leadId, memberIds, projectIds: [], createdAt, createdBy: adminUid })`
   - For each `uid` in memberIds: `updateDoc(users/{uid}, { teamIds: arrayUnion(teamId) })` (batch these).
6. Redirect to `/teams/:teamId`.

### Flow 2 — Admin creates a project

**Entry**: `/projects` page, admin-only "New Project" button (also in the global action bar).

1. Click **New Project** → modal with: title, description, deadline (date picker), owner (user search — defaults to admin themselves).
2. Owner picker also has **[+ Create new member]** at the bottom (opens Flow 0 inline and auto-selects the new user as owner).
3. Click **Create**.
4. Firestore: `addDoc(projects, { title, description, ownerId, status: 'active', deadline, teamIds: [], createdAt, updatedAt })`.
5. Redirect to `/projects/:projectId`. Page shows empty state: "No teams assigned yet."

### Flow 3 — Project owner assigns teams to a project

**Entry**: project page → "Manage Teams" button.

1. Click **Manage Teams** → side panel lists all global teams with checkboxes (already-assigned ones checked).
2. Owner toggles teams on/off.
3. Click **Save**.
4. Compute added set `A` and removed set `R`.
5. Firestore `writeBatch`:
   - `updateDoc(projects/{id}, { teamIds: newTeamIds, updatedAt })`
   - For each `teamId` in `A`: `updateDoc(teams/{teamId}, { projectIds: arrayUnion(projectId) })`
   - For each `teamId` in `R`: `updateDoc(teams/{teamId}, { projectIds: arrayRemove(projectId) })`
6. Project page re-renders with team cards (one per assigned team).

> If the owner needs a team that doesn't exist: show a "Create new team" link in the panel that opens Flow 1 (admins only) or messages the admin.

### Flow 4 — Team lead creates a team-level task on a project

**Entry**: project page → click a team card → team-on-project view → "New Task" button.

1. Click **New Task** → modal: title, description, priority, due date. Assignee field hidden (team-level tasks are unassigned).
2. Click **Create**.
3. Firestore: `addDoc(tasks, { projectId, teamId, parentTaskId: null, title, description, assigneeId: null, status: 'todo', priority, dueDate, teamName, projectTitle, subtaskCount: 0, subtaskDoneCount: 0, attachments: [], createdBy, createdAt, updatedAt })`.
4. Task appears in the team's task list on that project.

### Flow 5 — Delegate: create subtasks under a team-level task

**Entry**: open a team-level task → "Subtasks" section → "Add Subtask" button.

1. Click **Add Subtask** → inline form: title, assignee (dropdown of `team.memberIds`), priority, due date, description (optional).
2. Click **Add**.
3. Firestore `writeBatch`:
   - `addDoc(tasks, { projectId, teamId, parentTaskId: <parent>, assigneeId, assigneeName, status: 'todo', …})`
   - `updateDoc(parent, { subtaskCount: increment(1), updatedAt })`
4. Subtask appears as a row under the parent with a status pill and assignee avatar.

### Flow 6 — Assignee works on their task

**Entry**: `/me` page.

1. Page queries `tasks where assigneeId == uid and status != 'done'`, grouped by project → team. Shows a "Completed" toggle to also show done tasks.
2. User clicks a task → opens task detail (modal or route).
3. Task detail shows: title, description, status dropdown, due date, attachments list, comments thread.
4. **Change status**: dropdown → select new status. Firestore `writeBatch`:
   - `updateDoc(task, { status, updatedAt, completedAt: (status === 'done' ? serverTimestamp() : null) })`
   - If this is a subtask and the status crossed the done boundary: also `updateDoc(parent, { subtaskDoneCount: increment(±1) })`.
5. **Attach file**:
   - User picks file. Client-side check: size < 10 MB (or whatever the service enforces).
   - Call `uploadAsset(file)` (§13.4) → returns `{ url, key, contentType, sizeBytes, fileName }`.
   - Build the `Attachment` object: `{ id: crypto.randomUUID(), name: fileName, url, key, mimeType: contentType, sizeBytes, uploadedBy: uid, uploadedAt: serverTimestamp() }`.
   - `updateDoc(task, { attachments: arrayUnion(<attachment>), updatedAt })`.
   - Show a toast on error; don't write to Firestore if upload fails.
6. **Add comment**:
   - User types content. If they attach a file, run the same `uploadAsset` flow first and build its `Attachment` object; skip if no file.
   - `addDoc(tasks/{taskId}/comments, { authorId, authorName, content, attachments: [<attachment>?], createdAt })`.
   - Comment thread updates live via `onSnapshot`.

### Flow 7 — Team lead reviews team workload on a project

**Entry**: project page → team card → "Team Workspace" tab.

1. Page loads: `tasks where projectId == X and teamId == Y`, ordered by `updatedAt desc`.
2. View toggle: **List / Board / Dashboard**.
   - **List**: flat list with filters (status, assignee, priority).
   - **Board**: Kanban columns by status (drag-and-drop optional; dropdown works for MVP).
   - **Dashboard**: the charts described in §10.
3. Lead can reassign, change priority, or edit any task here.

### Flow 8 — Project owner tracks overall project progress

**Entry**: `/projects/:projectId`.

Page shows:
- Header: title, owner, deadline, status badge, overall progress %.
- Team grid: one card per assigned team with per-team progress ring, open task count, member avatars, lead name.
- **Dashboard** tab with charts (§10.3).
- **Activity** tab (optional): recent task status changes across all teams.

### Flow 9 — Admin sees everything

**Entry**: `/admin` (only visible when `user.globalRole === 'admin'`).

Shows the global dashboard (§10.4): active projects, at-risk projects, team utilization across projects, user bandwidth heatmap.

### Flow 10 — Team lead manages team roster

**Entry**: `/teams/:teamId` → "Members" tab.

1. Lead sees member list with add/remove controls.
2. Add: search users, select, click **Add**. The search dropdown includes **[+ Create new member]** at the bottom (admins only) — opens Flow 0 inline; new user is auto-added on success.
   - `writeBatch`: `team.memberIds: arrayUnion(uid)`, `users/{uid}.teamIds: arrayUnion(teamId)`.
3. Remove: trash icon next to member.
   - `writeBatch`: `team.memberIds: arrayRemove(uid)`, `users/{uid}.teamIds: arrayRemove(teamId)`.
   - ⚠️ Don't auto-reassign that user's open tasks. Show a warning: "This user has N open tasks. They remain assigned until reassigned." Team lead reassigns manually.

### Flow 11 — Admin manages members (`/admin/members`)

**Entry**: admin clicks "Members" in the admin nav, or the **[+ New Member]** button anywhere.

1. Page shows a table of all users: avatar, display name, email, role, teams (count), **temp password** (hidden behind a 👁 reveal + copy button), created date.
2. Top-right: **[+ New Member]** button → Flow 0.
3. Per-row actions:
   - **Copy credentials** — copies `email / tempPassword` to clipboard.
   - **Promote to admin** / **Demote to user** — toggles `globalRole`. Guardrail: can't demote yourself.
   - **Delete** (optional, v1+) — tombstone / hard delete.
4. Search box filters by name/email.

### Flow 12 — Project board view (swimlane kanban)

**Entry**: project page → "Board View" button. Also reachable from a Home card with a project picker, and from any task detail's project pill.

1. Page loads at `/projects/:projectId/boards` and subscribes to **all** tasks on the project (parents + subtasks) via `useAllProjectTasks`.
2. Layout: columns by `status` (Todo, In Progress, In Review, Done, Blocked); swimlanes by team. Tasks for teams that were de-assigned from the project show in a final "Unassigned team" lane.
3. Project picker at the top switches between projects the user can access (admins see all; regular users see projects they own or where one of their teams is assigned).
4. Filters: Priority pills, Assignee dropdown, Team dropdown. (Status pills hidden — status is the column.)
5. **Create task from the board**: each swimlane header shows a `+ New task` button when the viewer can create on that team (admin OR project owner OR team lead of *that* team). Click → opens `NewTaskModal` with `projectId` and `teamId` pre-filled.
6. Cards link into the task detail (URL-overlay modal or full page). Subtask cards show a `↳ parent title` caption.

### Flow 13 — Change project status (manual transition)

**Entry**: project detail page header. Visible only to admin or project owner.

1. The project status pill in the header is rendered as a `ProjectStatusMenu` (dropdown) instead of a static badge for users with permission.
2. Pick `Active`, `Completed`, or `Archived`. Writes are atomic: `setProjectStatus(projectId, status)` updates `status` + `updatedAt`.
3. Live `onSnapshot` subscriptions propagate the change everywhere — list badge, dashboards (ProjectsByStatus, AtRiskProjects), and the `isOverdue` check (which only flags `active` projects).

### Access query cheat sheet

- **My projects**: `projects where ownerId == uid` **UNION** `projects where teamIds array-contains-any (user.teamIds)`. (Cap: 10 teams — fine for MVP.)
- **My teams**: `teams where memberIds array-contains uid` — or just read `user.teamIds` and hydrate.
- **My tasks**: `tasks where assigneeId == uid`.
- **Team on project**: `tasks where projectId == X and teamId == Y`.

---

## 10. Data Visualizations

**Library**: [Recharts](https://recharts.org/) — simple, React-first, supports everything we need. Already common in the React ecosystem.

For the heatmap (§10.3.3), either build a simple CSS grid yourself or use `nivo` as an optional dependency.

### 10.1 My Dashboard (`/me`)

Audience: every user. Goal: "what should I work on?"

| Chart | Type | Data source |
|---|---|---|
| **Status breakdown** | Donut | My open tasks grouped by `status`. |
| **Upcoming deadlines** | Vertical timeline / sorted list | My tasks with `dueDate` in next 14 days, ordered ascending. |
| **Weekly completion** | Line / sparkline | Count of my tasks with `completedAt` in each of the last 8 weeks. |
| **Priority mix** | Horizontal bar | Count of my open tasks by priority. |

### 10.2 Team Dashboard (`/teams/:teamId` → Dashboard tab)

Audience: team lead. Goal: "how's my team doing and who's overloaded?"

| Chart | Type | Data source |
|---|---|---|
| **Member workload (bandwidth)** | Stacked horizontal bar — one row per member, segments by status | Open tasks per member, broken down by status. Red border on overloaded members. |
| **Velocity** | Line chart | Count of tasks `completedAt` per week over last 8 weeks, across all projects the team is on. |
| **Status distribution** | Donut | All open team tasks by status. |
| **Task age** | Histogram (buckets: 0–3d, 4–7d, 8–14d, 15+d) | Open tasks bucketed by `now - createdAt`. Surfaces stale work. |

### 10.3 Project Dashboard (`/projects/:projectId` → Dashboard tab)

Audience: project owner. Goal: "is this project on track?"

| Chart | Type | Data source |
|---|---|---|
| **Overall progress ring** | Gauge / donut | Avg of team-level task progress. Large number in center. |
| **Per-team progress** | Grouped horizontal bars (done / in-progress / todo) | For each team on this project: counts of team-level tasks by status. |
| **Bandwidth heatmap** | Grid: rows = members (across all teams on project), cols = status | Count of open tasks. Color-scaled by count. Highlights overloaded people. |
| **Burndown** | Line chart: open task count over time | Total open tasks in project per day since project creation. Compute from `createdAt` / `completedAt` client-side on load. |
| **Overdue tasks** | Red-flag list | Tasks with `dueDate < now` and `status != 'done'`. |

### 10.4 Admin / Global Dashboard (`/admin`)

Audience: admin. Goal: org-wide health.

| Chart | Type | Data source |
|---|---|---|
| **Projects by status** | Donut | Count of projects by `status`. |
| **At-risk projects** | Table | Projects where `deadline - now < 7 days` AND `progress < 80%`. |
| **Team utilization** | Horizontal bar | Open task count per team across all projects. |
| **User bandwidth heatmap** | Grid: rows = users, cols = teams | Open task count per (user, team) pair. |
| **New vs. completed this week** | Twin bars | `createdAt` this week vs `completedAt` this week. |

### 10.5 Implementation notes

- **Compute on the client.** All charts above derive from lists of tasks you already load. Don't build aggregation pipelines for MVP.
- **Memoize derivations.** Wrap `tasks → chart data` transforms in `useMemo` keyed on the tasks snapshot.
- **Limit query scope.** For `/me` load only my tasks. For team/project dashboards, load just that team/project's tasks. Don't pull the whole `tasks` collection ever.
- **Snapshot, don't poll.** All task reads use `onSnapshot` so charts update live.
- **Bandwidth color thresholds**: 0 open = gray, 1–2 = green, 3–5 = yellow, 6+ = red. Tune after seeing real data.

---

## 11. MVP Build Order

Ship in this order; each step unlocks a demoable slice. (✅ = built, 🟡 = partial, ❌ = deferred.)

1. ✅ **Bootstrap the admin** — manually create the `/users/{uid}` doc for `taskmanager@ai.com` in the Firestore console with `globalRole: 'admin'`, `teamIds: []`. See §13.1.
2. ✅ **User doc upsert** on login — in the auth context, when a user signs in, check if `/users/{uid}` exists; if not, create with defaults `{ globalRole: 'user', teamIds: [] }`.
3. ✅ **Admin-only "Members" page** + **`createMember` helper** using secondary Firebase app (Flow 0, Flow 11). See §13.2.
4. ✅ **Global admin action bar** with [+ New Project] [+ New Team] [+ New Member] wired up.
5. ✅ **Admin creates team** (Flow 1) + team list page. Includes inline [+ Create new member] in the pickers.
6. ✅ **Admin creates project** (Flow 2) + project list page. Project creation also accepts attachment uploads via §13.4.
7. ✅ **Assign teams to project** (Flow 3) + team cards on project page.
8. ✅ **Create team-level task** (Flow 4) + team-on-project task list (List + Board views, themed filters).
9. ✅ **Create subtask + assign** (Flow 5) with parent counter rollup via `writeBatch`.
10. ✅ **Task detail view**: status change, edits, subtask rollup, attachments, comments. Renders both as a full page (`/tasks/:taskId`) and as a URL-overlay modal via `backgroundLocation`.
11. ✅ **My Tasks page** (Flow 6) — also surfaces team-level tasks on teams the user leads (via `useMyLedTeamTasks`).
12. ✅ **Comments** on tasks.
13. ✅ **File attachments** on tasks + comments via the external asset service (§13.4).
14. ✅ **Dashboards & charts** (§10.1 → §10.4) — see §10 for what shipped vs. what was dropped.
15. ✅ **Admin global dashboard** page (Flow 9).
16. 🟡 **Polish**: overdue highlighting ✅, empty states ✅, loading skeletons ❌, activity log ❌.

**Dropped from the original "drop if falling behind" list**: bandwidth heatmap (project + admin), burndown chart, task age histogram, priority-weighted bandwidth, comment attachments. `in_review` status was kept and shipped.

**Added beyond the original spec** — see §14.

---

## 12. Assumptions

Stated upfront so we don't argue mid-hack:

1. **Teams are global.** Same team can be on many projects. Roster is shared across projects — you can't have "Alice in Team A on Project X but not on Project Y" without forking a new team.
2. **A user can be in multiple teams.** Permissions derive from their current team memberships.
3. **A task belongs to exactly one (project, team).** No cross-team tasks.
4. **Task hierarchy is 2 levels max** (team-level → subtask). No deeper nesting.
5. **No public signup.** Admins provision every user via Flow 0. The existing signup route is either removed or hidden behind an admin-only gate. Login remains public.
6. **Temp passwords are stored in plaintext** on `users/{uid}.tempPassword` so admins can retrieve them any time. This is **not production-safe** — see §13.3. Acceptable for hackathon demo only.
7. **Only admins create teams, projects, and members.** Project owners can't spin up new teams or members (they ask an admin, or admins use the global action bar).
8. **A user is in at most 10 teams.** (Firestore `array-contains-any` limit for the "my projects" query.)
9. **No real-time co-editing** (no Google-Docs cursors). Submit on save.
10. **No email/push notifications** in MVP. Live updates via `onSnapshot` are enough.
11. **Hard delete only** — no soft deletes / trash.
12. **Admin bootstrap**: the existing `taskmanager@ai.com` user becomes the first admin via a one-time manual Firestore edit (§13.1). No in-app admin-promotion UI in v0, but admins can promote other users to admin from the Members page (Flow 11).
13. **File uploads use an external asset service** (§5), not Firebase Storage. Firestore only stores returned metadata (url, key, filename, size, contentType). Tenant code is a single constant (`taskflow`) for the entire app.

---

## 13. Member Provisioning — Implementation Notes

### 13.1 One-time admin bootstrap (do this now, in the Firebase console)

1. Firebase Console → **Authentication** → **Users** → find `taskmanager@ai.com` → copy the UID.
2. Firestore Console → create collection `users` (if it doesn't exist) → create a document with the UID you just copied as the **document ID** → add fields:

   | Field | Type | Value |
   |---|---|---|
   | `uid` | string | *(the UID)* |
   | `email` | string | `taskmanager@ai.com` |
   | `displayName` | string | `Admin` |
   | `globalRole` | string | `admin` |
   | `teamIds` | array | *(empty array)* |
   | `createdAt` | timestamp | *(click "current timestamp")* |

3. Done. Log in as this user — the app will see `globalRole: 'admin'` and unlock admin UI.

### 13.2 `createMember` helper (Flow 0)

Admin-side account creation has a gotcha: `createUserWithEmailAndPassword` on the default Firebase Auth instance **signs you in as the newly created user**, kicking the admin out of their own session. Fix: use a secondary Firebase app instance so the admin's session is untouched.

```ts
// src/lib/createMember.ts
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, firebaseConfig } from "./firebase";

export function generateTempPassword(): string {
  // simple and readable; swap for a word-based generator if you like
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function createMember(
  email: string,
  displayName: string,
  tempPassword: string,
  adminUid: string
): Promise<{ uid: string; email: string; tempPassword: string }> {
  const secondary = initializeApp(firebaseConfig, `Secondary-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email,
      displayName,
      globalRole: "user",
      teamIds: [],
      tempPassword,               // plaintext — see §13.3
      createdBy: adminUid,
      createdAt: serverTimestamp(),
    });

    await secondaryAuth.signOut();
    return { uid: cred.user.uid, email, tempPassword };
  } finally {
    await deleteApp(secondary);
  }
}
```

Usage inside the "+ New Member" modal:

```ts
const tempPassword = generateTempPassword();
const result = await createMember(email, displayName, tempPassword, currentUser.uid);
// Show result in the success screen with a copy-to-clipboard button:
await navigator.clipboard.writeText(`${result.email} / ${result.tempPassword}`);
```

### 13.3 Security caveat (read before shipping to production)

Storing plaintext passwords in Firestore is **fine for a hackathon demo** where you're running the only instance and all users consent. It is **not acceptable for production** because:
- Any admin who gains database access sees all passwords in clear text.
- Firebase itself never exposes passwords to anyone (they're hashed on Google's side); we're creating a second, worse copy.
- Even with strict Firestore rules, any compromise of an admin account compromises every user password.

**Before going to production**, replace `tempPassword` with either:
- (a) A "first login forces password reset" flow (set a random password, immediately call `sendPasswordResetEmail` — admin forwards the reset link to the user), or
- (b) A one-time-view token stored hashed, shown to the admin exactly once.

Until then, this field stays. Just don't demo it to a security auditor.

### 13.4 `uploadAsset` helper (external file service — §5)

```ts
// src/lib/uploadAsset.ts

const TENANT_CODE = import.meta.env.VITE_TENANT_CODE as string;
const UPLOAD_URL = import.meta.env.VITE_ASSET_UPLOAD_URL as string;

export interface AssetUploadResult {
  url: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  tenantCode: string;
}

interface ApiEnvelope<T> {
  st: boolean;
  msg: string | null;
  devErrorMessage?: string | null;
  validationError?: unknown;
  data: T | null;
}

export async function uploadAsset(file: File): Promise<AssetUploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      // Do NOT set Content-Type — the browser adds the multipart boundary automatically.
      accept: "*/*",
      x_tenant_code: TENANT_CODE,
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as ApiEnvelope<AssetUploadResult>;
  if (!json.st || !json.data) {
    throw new Error(json.msg || "Upload failed");
  }
  return json.data;
}
```

Usage inside the task-detail attach-file handler:

```ts
import { uploadAsset } from "@/lib/uploadAsset";
import { arrayUnion, doc, serverTimestamp, updateDoc } from "firebase/firestore";

async function handleFileAttach(file: File, taskId: string, uid: string) {
  const uploaded = await uploadAsset(file);

  const attachment = {
    id: crypto.randomUUID(),
    name: uploaded.fileName,
    url: uploaded.url,
    key: uploaded.key,
    mimeType: uploaded.contentType,
    sizeBytes: uploaded.sizeBytes,
    uploadedBy: uid,
    uploadedAt: serverTimestamp(),
  };

  await updateDoc(doc(db, "tasks", taskId), {
    attachments: arrayUnion(attachment),
    updatedAt: serverTimestamp(),
  });
}
```

Notes for anyone copy-pasting:

- **Do not set `Content-Type` manually.** The browser must set `multipart/form-data; boundary=…` for you. If you set it, the upload silently breaks with a 400.
- **Keep `key` on the attachment.** We don't use it yet, but it's free to store and lets you add a delete/move feature later without re-plumbing anything.
- **No auth on the endpoint in the shared curl.** If it later requires an auth header, add it here — one place to change.
- **Error handling:** wrap calls in `try/catch` at the UI layer, show a toast. Never write to Firestore if the upload throws.
- **Progress UI:** `fetch` doesn't expose upload progress natively. For MVP use an indeterminate spinner. If you need a real progress bar, swap to `XMLHttpRequest` — but that's a polish task, not day-1.

---

## 14. What shipped beyond the spec

Living section — captures additions, deltas, and structural decisions made during build that weren't in §1–§13.

### 14.1 Routes (current)

| Path | Component | Guard | Notes |
|---|---|---|---|
| `/login` | `Login` | public | Welcome panel + form. |
| `/` | `Home` | auth | Cards: My Tasks, Projects, Teams, Board View (with project picker), Members (admin only). |
| `/me` | `Me` | auth | Assigned + Led-by-me lists, dashboard collapsed at the bottom. |
| `/tasks/:taskId` | `TaskDetailPage` | auth | Renders as full page when navigated directly; renders as a `TaskDetailModal` when reached via `backgroundLocation` state. |
| `/projects` | `Projects` | auth | Admin sees all; non-admin sees projects they own OR where one of their teams is assigned. |
| `/projects/:projectId` | `ProjectDetail` | auth | Header has `ProjectStatusMenu` for admin/owner. Overview + Analytics tabs. |
| `/projects/:projectId/boards` | `ProjectBoard` | auth + access check | Swimlane kanban (Flow 12). |
| `/projects/:projectId/teams/:teamId` | `TeamOnProject` | auth | List/Board views with filters. |
| `/teams` | `Teams` | auth | Admin sees all; non-admin sees teams they're a member or lead of. |
| `/teams/:teamId` | `TeamDetail` | auth | Overview + Dashboard tabs. |
| `/admin` | `AdminDashboard` | admin | Org-wide charts (Flow 9). |
| `/admin/members` | `AdminMembers` | admin | Member roster + provisioning (Flow 11). |
| `*` | `NotFound` | auth | Themed 404 with CTAs back to Home / My Tasks. |

### 14.2 Notable additions

- **Project Board View** — `/projects/:id/boards`. New page, hook (`useAllProjectTasks`), and component (`ProjectSwimlaneBoard`). See Flow 12.
- **Project status menu** — `ProjectStatusMenu` + `setProjectStatus` helper. See Flow 13.
- **Project picker** (`ProjectPicker`) — portal-based dropdown with search, scroll cap, and viewport-aware flip-up positioning (mirrors `UserPicker`). Used on Home (`BoardViewCard`) and `ProjectBoard` for switching projects.
- **`useAccessibleProjects` hook** — single source of truth for the "projects this user can see" rule (admin: all; otherwise: owner OR team-assigned).
- **Effective assignee resolver** (`getEffectiveAssignee`) — team-level tasks resolve to the team lead for filtering, dashboard rollups, and "Led by me" surfaces.
- **Mobile navbar drawer** — hamburger + portal drawer with backdrop and body-scroll lock; auto-closes on navigation.
- **Modal scrolling** — `Modal` primitive caps height at `calc(100dvh - 3rem)`, sticky header, body becomes `flex-1 overflow-y-auto` with the themed scrollbar. Applies to every modal in the app.
- **`/me` dashboard** — moved below the task lists with an expand/collapse toggle, so tasks are the primary focus on arrival.
- **Projects + Teams visible to all signed-in users** (scoped to their access). Originally these routes were admin-only.
- **404 page** — `NotFound`, themed with the same gradient orbs and CTAs back to Home / My Tasks.
- **Themed scrollbar utility** — `.scrollbar-dark` in `index.css`; used on the kanban board, modal bodies, and dropdown lists.

### 14.3 Charts that shipped vs. dropped

| Surface | Shipped | Dropped |
|---|---|---|
| `/me` (§10.1) | StatusDonut, PriorityBar, UpcomingDeadlines, WeeklyCompletionLine | — |
| Team Dashboard (§10.2) | MemberWorkload, StatusDonut, WeeklyCompletionLine (as Velocity) | Task age histogram |
| Project Dashboard (§10.3) | ProgressRing, StatusDonut, PerTeamProgress, OverdueTasksList | Bandwidth heatmap, Burndown |
| Admin Dashboard (§10.4) | ProjectsByStatus, TeamUtilization, AtRiskProjects, NewVsCompleted | User bandwidth heatmap |

### 14.4 Production readiness gaps (not yet addressed)

These are deliberately out of MVP scope; flagged here so they aren't forgotten before any real-business onboarding:

- **Firestore security rules** — currently `if request.auth != null` (any signed-in user can read/write everything). Needs proper per-collection rules.
- **Plaintext temp passwords** in `users/{uid}.tempPassword` (§13.3). Replace with email reset link or hashed one-time token before production.
- **No notifications** (email or push). Users only see updates while the tab is open.
- **No activity log / audit trail.**
- **No delete/archive UI** for teams, members, or tasks (only project status archive is wired).
- **No tests, no error boundaries, no offline UX.**