# Platform Overview

> A quick map of what's been built, how it fits together, and where to find things. The deep design specs live in [`TASK_MANAGEMENT_MVP.md`](TASK_MANAGEMENT_MVP.md) (v1 product) and [`tender_workflow_delta.md`](tender_workflow_delta.md) (tender fork). This doc is the scannable summary.

## What this is

A Firebase-backed task manager forked into a **tender pipeline** product. Super admins create tenders, allocate them to a Vertical Head (VH), who triages eligibility, then fans work out to horizontal teams (2D / 3D / Video Editing) for specialist execution and CT validation. A 10-stage workflow drives the lifecycle from intake to client delivery. Everything below the tender layer is the v1 task manager: global teams, project-scoped tasks, subtasks, comments, attachments, board view, role-derived permissions.

---

## Capability map

| Area | What's there | Where |
|---|---|---|
| Auth + member provisioning | Email/password sign-in, admin-provisioned accounts with temporary passwords surfaced to admins | `src/contexts/AuthContext.tsx`, `src/lib/createMember.ts`, `src/pages/AdminMembers.tsx` |
| Roles | Global: `super_admin` / `admin` (VH pool) / `horizontal_lead` / `user`. Contextual: project owner, team lead, team member, VH — derived, not stored | `src/hooks/usePermissions.ts` |
| Projects (tenders) | Create, list, status updates, team assignment, audit trail, stage tracker, escalations, iteration counters | `src/pages/Projects.tsx`, `src/pages/ProjectDetail.tsx`, `src/lib/firestore.ts` |
| Tender stage workflow | 10 stages with structured transitions, escalations, rework loops, eligibility-validation status, completion outcomes | `src/components/tender/*`, `src/lib/projectStatus.ts`, stage history on `projects.stageHistory[]` |
| Teams | Global teams, lead + members, project assignment | `src/pages/Teams.tsx`, `src/pages/TeamDetail.tsx`, `src/components/admin/ManageTeamsModal.tsx` |
| Tasks + subtasks | Team-level task → individual subtasks, workType templates, reviewer flow via `in_review`, comments, attachments | `src/pages/TaskDetail.tsx`, `src/components/admin/NewTaskModal.tsx`, `src/hooks/use*Tasks*.ts` |
| Boards | Project-level swimlane board across teams, task filters | `src/pages/ProjectBoard.tsx`, `src/components/tasks/*` |
| Admin surfaces | Members admin, role management, action bar with create flows | `src/pages/AdminMembers.tsx`, `src/components/admin/AdminActionBar.tsx` |
| File attachments | External asset service via Firebase config — see v1 design doc §5 | Existing upload flow, reused everywhere |
| Audit trail | `recordAuditEvent` writes to a top-level audit collection in the same batch as the mutation | `src/lib/firestore.ts` |

---

## Stack and runtime

- **Build**: Vite + React 19 + TypeScript, Tailwind v4
- **Router**: react-router-dom v7
- **Charting**: recharts
- **Data**: Firebase Firestore (web SDK v12), Firebase Auth
- **Strict mode**: enabled in dev (`src/main.tsx`) — effects double-invoke, code is written to be idempotent under it
- **Firestore persistent cache**: enabled with multi-tab support so cached reads survive reloads and tabs coordinate via leader election (`src/lib/firebase.ts`)
- **Lint / typecheck**: `npx tsc -b` and `npx eslint .`

---

## Data model — collections in play

```
users/{uid}              Auth profile + globalRole + teamIds + displayNameLower
teams/{teamId}           Global team; leadId + memberIds + projectIds
projects/{projectId}     Tender project; status, stage, stageHistory[], teamIds, accessKeys, titleLower
tasks/{taskId}           Flat collection, references projectId + (optional) teamId; subtasks reference parentTaskId
tasks/{taskId}/comments  Per-task comments
audit/{eventId}          Append-only audit events
```

For exact field shapes see the design docs. The fields that didn't exist before this round of work and that current features depend on:

| Doc | Field | Purpose |
|---|---|---|
| `projects` | `titleLower: string` | Prefix-search index for project search |
| `projects` | `accessKeys: string[]` (= `[ownerId, ...teamIds]`) | Single-field server-side visibility filter for non-admins |
| `users` | `displayNameLower: string` | Prefix-search index for member search |

These are written on creation and re-synced wherever the underlying fields change (`addProject`, `setProjectTeams`, `createMember`). Pre-existing docs that never get re-touched won't appear in search results — acceptable in dev; production migration would need a one-shot backfill.

---

## Listing-page architecture (search, pagination, filters)

Used on `/projects` and `/admin/members`. Same pattern, same primitives.

- **Query construction lives in the page**. A `buildQuery(cursor)` closure picks the right combination of `where`/`orderBy` based on current state (search, status filter, sort direction, role).
- **Pagination** uses Firestore cursors (`startAfter(QueryDocumentSnapshot)`) + `limit(N)`. Page size: 24 (projects), 25 (members), 20 (picker). "Load more" button at the bottom; counter shows `Showing N+`.
- **Stale-while-revalidate**: when search/filter/sort changes, the previous results stay rendered while the new query runs; an inline spinner next to the counter signals refresh. Avoids the full-page flicker that would otherwise blank the grid on every keystroke debounce.
- **Search** is prefix-only (Firestore's range trick: `where(field, '>=', q)` + `where(field, '<=', q + '')` + `orderBy(field)`). Search input shows an `(i)` icon whose hover tooltip explains "starts with what you type". Debounce: 600ms.
- **Visibility filter for non-admins** uses `where('accessKeys', 'array-contains-any', [uid, ...userTeamIds])`. This is the only way to get `ownerId === me OR teamIds intersects mine` in a single Firestore query. Capped at 30 disjuncts — a user in 30+ teams hits the ceiling.
- **Status filter** is single-select. `where('status', '==', selected)`. Multi-status would require `in`, which can't coexist with `array-contains-any`, so it's deliberately not offered.
- **Sort** is `createdAt asc/desc` for the default ordering. Auto-disabled with a tooltip while a search query is active, because the inequality on `titleLower` forces alphabetical ordering.
- **ProjectPicker** reuses the same machinery: opens a popover, debounces a server-side prefix search, paginates results, fetches the trigger's selected-project title via a single `getDoc` if the caller didn't pass `selectedLabel`. Optional `autoSelectFirst` runs one `limit(1)` query and emits the first id on mount — used on the Home page's "Open board" flow.

### Reusable primitives

| File | What it does |
|---|---|
| `src/hooks/usePaginatedQuery.ts` | Generic cursor pagination over a caller-supplied `buildQuery`. Holds `buildQuery` / `mapDoc` in refs so dep-change refetches always see the latest closure (this was the bug behind "filters not working" — captured stale closure). |
| `src/components/ui/SearchInput.tsx` | Themed search field with `(i)` tooltip that explains prefix-match semantics. |
| `src/components/ui/Dropdown.tsx` | Controlled custom select; supports `leading` slot (used for status dot), `disabled` + `disabledTooltip`. |
| `src/components/ui/ProjectPicker.tsx` | Self-fetching paginated picker with internal search and optional `autoSelectFirst`. |
| `src/lib/projectStatus.ts` | `STATUS_DISPLAY`, `STATUS_OPTIONS`, `isProjectClosed` / `isProjectLive` helpers. |

---

## Firestore composite indexes required

Most will be auto-prompted by Firestore on first failing query. The full set the current code exercises:

| Collection | Fields | Use case |
|---|---|---|
| projects | `titleLower` asc | admin search |
| projects | `accessKeys` array-contains, `createdAt` desc | non-admin default list, newest first |
| projects | `accessKeys` array-contains, `createdAt` asc | non-admin default list, oldest first |
| projects | `accessKeys` array-contains, `titleLower` asc | non-admin search |
| projects | `status` asc, `createdAt` desc | admin + status filter, newest |
| projects | `status` asc, `createdAt` asc | admin + status filter, oldest |
| projects | `status` asc, `titleLower` asc | admin + status filter + search |
| projects | `accessKeys` array-contains, `status` asc, `createdAt` desc | non-admin + status filter, newest |
| projects | `accessKeys` array-contains, `status` asc, `createdAt` asc | non-admin + status filter, oldest |
| projects | `accessKeys` array-contains, `status` asc, `titleLower` asc | non-admin + status filter + search |
| users | `displayNameLower` asc | member search |

---

## Tender stage workflow (one-line each)

See `tender_workflow_delta.md` §4 for full detail. Stage history is appended to `projects.stageHistory[]` on every transition.

1. Created by Super Admin
2. Allocated to a VH (admin pool)
3. Eligibility under review
4. VH accepted (eligibility validated)
5. RFP attached
6. Fan-out to horizontal teams in progress
7. Specialist work + CT validation (via `in_review` reviewer flow)
8. VH review
9. Ready for client
10. Delivered (final status: `awarded` / `lost` / `not_submitted` / `completed`)

Side-loops: VH can escalate back (`stage_escalated_back` count tracked); rework iterations bump `vhIterationCount`. Closed statuses (`completed`, `lost`, `not_submitted`) lock the project from further edits.

---

## Known trade-offs and gotchas

- **No realtime updates on list pages anymore.** `Projects` and `AdminMembers` switched from `onSnapshot` to paginated `getDocs` for cursor pagination. Detail pages (`ProjectDetail`, `TaskDetail`) still use snapshots.
- **Pre-existing docs without `titleLower` / `accessKeys` / `displayNameLower` are invisible to search and to the non-admin Projects listing.** Dev OK; production would need a backfill script.
- **30-team ceiling** on the non-admin visibility query (`array-contains-any` limit).
- **Prefix-only search.** No fuzzy matching, no substring-in-middle. The `(i)` tooltip discloses this.
- **`useAllProjects` / `useAllUsers` still exist and still snapshot the full collection.** Used by AdminDashboard, TeamDetail, Boards, pickers (other than ProjectPicker which is now self-fetching). If/when those hit scale, the same `usePaginatedQuery` pattern can be applied.
- **`react-hooks/set-state-in-effect` lint rule fires on several legitimate effect-driven syncs** across the codebase. New code suppresses with targeted comments where appropriate; pre-existing violations are left as-is.

---

## Recent build history (what changed in the latest round)

- Firestore persistent cache turned on with multi-tab manager.
- Denormalized `titleLower` / `accessKeys` / `displayNameLower` written on relevant mutations.
- New `usePaginatedQuery` hook; ref-held `buildQuery` / `mapDoc` so dep-change refetches always see the latest closure.
- New `SearchInput` (with `(i)` tooltip) and `Dropdown` (with `leading` slot + disable-tooltip) UI primitives.
- Projects page: server-side prefix search, status filter, sort direction, "Load more" pagination, stale-while-revalidate refresh.
- AdminMembers page: same treatment minus filters/sort.
- ProjectPicker: refactored to self-fetch (drops `projects` prop), debounced server-side search, "Load more", optional `autoSelectFirst` for Home's BoardView card, `selectedLabel` prop for callers that already have the title.
- Project card chip layout fix so long titles don't squash the status pill.

---

## Where to start reading code

- New feature on the **Projects listing**: start at [`src/pages/Projects.tsx`](src/pages/Projects.tsx), then [`src/hooks/usePaginatedQuery.ts`](src/hooks/usePaginatedQuery.ts).
- New feature on a **project detail page**: [`src/pages/ProjectDetail.tsx`](src/pages/ProjectDetail.tsx) + the `src/components/tender/` family for stage UI.
- **Task / board logic**: [`src/pages/ProjectBoard.tsx`](src/pages/ProjectBoard.tsx), [`src/components/tasks/`](src/components/tasks/), `src/hooks/use*Tasks*.ts`.
- **Firestore mutations**: everything authoritative is in [`src/lib/firestore.ts`](src/lib/firestore.ts) (and `createMember.ts`). If you're changing how data is written, that's the file.
- **Permissions**: [`src/hooks/usePermissions.ts`](src/hooks/usePermissions.ts) — derives all contextual roles from project + team docs.
