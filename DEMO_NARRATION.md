# Show Runner — Product Demo Video Script

*Total runtime: ~8 minutes. Voiceover is the spoken track; On screen is the literal capture direction.*

---

## ⚙️ Director's notes — read first (reality-check vs the live clm-phase-2 data)

The script below is the spoken/visual flow. These notes reconcile it with what's actually on screen so nothing surprises you. Pair this with **`DEMO_STAGE_MOVES.md`** (the exact buttons/inputs/who for every transition).

1. **Drive everything as `rachet.juneja1@eventstrat.ai` (Super Admin, password `ShowRunner@2026`).** This is the shareable email+password account created for recording (the Dhruv account is Google-only). No account switching needed for the happy path.
2. **Roles (Scenes 1–2):** the script's "Super Admin → Vertical Head → Admin Head/Functional Head → Team Lead → Member" is the *conceptual* story. The actual roles in `/admin/roles` are: **L1** Super Admin · **L2** Tender Team, Sales Manager · **L3** Vertical Head, Account Manager, Finance, Operations · **L4** Admin Head, Functional Head · **L5** Coordinator, Validator, Specialist. Narrate around what's on screen — the point (configurable N-level hierarchy + module grid) holds perfectly. Show the **module access grid** toggles live; that's the money shot.
3. **Custom fields (Scenes 3 & 6):** the live **Tender** workflow's custom fields are *deprecated*, so they **won't appear on the create form**. Two clean options: **(a)** during authoring (Scene 3) actually **add a new field like "Booth area (sqm)" and Publish** — it then shows up when you create IITF in Scene 6 (great "no-code, instant" proof); **or (b)** narrate custom fields purely as an authoring capability and, in Scene 6, fill the real fields the form *does* show: title, description, **Submission/Presentation/Deadline dates, project roles (Admin Head/Functional Head), attachments**.
4. **Scene 6 create — do the unlock:** when creating IITF, set **Admin Head = yourself (Rachet)** in the project-roles picker. That lets you perform the `allocated`-stage actions and `Confirm setup` solo (see cheat sheet §1).
5. **Exact seeded project names** to reference on camera:
   - History + rework loop → **Bharat Mandapam — G20 Legacy Exhibition, New Delhi**
   - Teams-on-project + Kanban → **Gulfood 2026 — India Pavilion Design & Build, Dubai**
   - Add-task-auto-advance → **Smart City Mission — 8-City Citizen Engagement Roadshow**
   - A clean "Awarded" win → **Auto Expo 2026 — OEM Pavilion Fabrication**
6. **The IITF live tender** ("IITF 2026 — State Pavilion Design & Build, Pragati Maidan") is *not* pre-seeded — you create it on camera in Scene 6. Title/description/tasks are ready to paste in the cheat sheet.
7. **Optional:** ask me for the cleanup script to hide the leftover test projects (`WFI`, `WFI27`, `Bharat Tex`, `IISF`, `Second Tender`) before recording.

---

## Scene 0 — Cold open (0:00–0:20)

**Voiceover:**
"This is Show Runner — the platform our experiential-events team runs every tender on, from a Gulfood pavilion in Dubai to a Republic Day tableau. What makes it different is that the entire workflow — the roles, the stages, the actions, the fields — is configured, not coded. Let me show you, end to end, starting with who can do what."

**On screen:**
- Open on the authenticated app, landing on `/admin` (AdminDashboard.tsx). Brief hover over the per-workflow pipeline funnel and the at-risk projects widget, then move the cursor to the left nav.

---

## (A) Roles & Access

## Scene 1 — The role hierarchy (0:20–1:05)

**Voiceover:**
"First, Roles and Access. Show Runner doesn't lock you into fixed roles — you build your own hierarchy, as many levels deep as you need. Ours runs Super Admin, then Vertical Head — that's the project lead — then Admin Head and Functional Head side by side, then Team Lead, and finally Member."

**On screen:**
- Navigate to `/admin/roles` (RolesHierarchy.tsx).
- Pan down the N-level hierarchy tree: **Super Admin → Vertical Head → (Admin Head, Functional Head) → Team Lead → Member**.
- Click the "Add child role" affordance on Team Lead to show a new level can be inserted, then cancel — making the point that depth is arbitrary.

## Scene 2 — Module access grid (1:05–1:45)

**Voiceover:**
"Permissions are a simple grid. For every role, you toggle view, create, update, and delete across each module — projects, tasks, teams, members, workflows, reports, and settings. Watch — I'll give the Functional Head the ability to create tasks. One click. No deploy, no ticket. It's live."

**On screen:**
- Select **Functional Head**; the module access grid renders.
- In the **tasks** row, toggle **create** on. Show the checkmark settling.
- Briefly scroll the grid across modules (projects, teams, members, workflows, reports, settings) so the granularity is visible.
- Click into the **member assignment** panel for **Vertical Head**, showing the assigned people chips.

---

## (B) Workflow management / creation

## Scene 3 — Start a workflow & configure roles + fields first (1:45–2:45)

**Voiceover:**
"Now the heart of it — workflows. A workflow is a reusable template; our 'Tender' workflow drives every project you've seen. Let's open the authoring view. Before stages, we set the workflow's own roles and fields. In Workflow Settings I name the flow type, set the lead role — Vertical Head — and define the project fields every tender will carry."

**On screen:**
- Go to `/admin/workflows/new`, pick the **Tender** template from the template chooser; land on `/admin/flow/:id` (FlowAuthoring.tsx) with the @xyflow/react canvas.
- Open the **Workflow Settings** drawer.
- Set **flow type**, set **lead role name → Vertical Head**.
- Under **project fields / custom fields**, show fields like *Submission date, Presentation date, Deadline, Client, Venue*; add one custom field live (e.g. "Booth area (sqm)").
- Show **project roles** (Coordinator, Validator, Specialist) and **status options** lists.

## Scene 4 — Stages on the canvas (2:45–3:35)

**Voiceover:**
"Then the stages. Each box is a stage in the tender's life — Intake, Allocation, Execution, Vertical Head Review, Delivered. I just drag a node onto the canvas to add a stage, and I draw an edge from one stage to the next to say where work flows. Reordering the pipeline is literally dragging boxes around."

**On screen:**
- On the canvas, drag a new **stage node** from the palette and drop it (e.g. an interim "Costing Review" stage).
- Drag existing nodes to show repositioning.
- Draw an **outcome edge** from "Allocation" to "Execution," then from "Execution" to "Vertical Head Review."
- Hover the canvas to surface the **live validation summary** (e.g. "all stages reachable / 1 stage missing an action").

## Scene 5 — Actions, outcomes, actors, inputs (3:35–4:45)

**Voiceover:**
"Now what can actually happen at a stage. I select Vertical Head Review and open the Node Inspector. I'll add an action — label it 'Approve,' effect advances the project, intent success so it's green. Next to it, 'Request changes' — intent danger, and its outcome loops back to Execution as a rework round. I set the actor — only the Vertical Head can perform these — and I can attach inputs: a decision note as text, a date, a select, even a user picker. Adding or rewiring an action is seconds of work — no code, no release."

**On screen:**
- Click the **Vertical Head Review** node; **Node Inspector** opens on the right.
- Add action **Approve** — set **effect = advance**, **intent = success (green)**, **outcome → Delivered**.
- Add action **Request changes** — **intent = danger (red)**, **outcome → Execution** (the rework loop).
- Set **actors = Vertical Head**.
- Add **inputs**: a **text** "Decision note," a **date**, a **select**, and a **user_picker**.
- Show the **intent** color preview updating (primary / success / danger) in the live action button preview.
- Click **Publish / activate**; validation summary turns all-green.

---

## (C) Create a project & navigate it

## Scene 6 — Create the IITF tender live (4:45–5:35)

**Voiceover:**
"With the workflow live, anyone can spin up a tender from it. Let's create one now — IITF 2026, State Pavilion Design and Build at Pragati Maidan. I pick the Tender workflow, give it a title and description, then fill the collaborative fields the workflow defined — submission date, presentation date, deadline — plus our custom Booth area field, the project roles, and any attachments."

**On screen:**
- Click **New Project**; **NewProjectModal.tsx** opens.
- Select the active **Tender** workflow.
- Title: **"IITF 2026 - State Pavilion Design & Build, Pragati Maidan"**; add a one-line description.
- Fill **submission date, presentation date, deadline**; fill the **Booth area (sqm)** custom field.
- Assign **project roles**; drop one **attachment**.
- Click **Create** — it lands at the **first stage (Intake/Allocation)**; allocation assigns the **Vertical Head** as lead.

## Scene 7 — Project detail & taking an action (5:35–6:15)

**Voiceover:**
"Here's the project. The Stage Banner up top shows exactly where we are and the only actions allowed right now — the same buttons we just configured. As the Vertical Head I'll hit an action; it opens the action modal with the inputs I defined, I fill the decision note, confirm, and the project advances. Everything you see here was authored in that canvas — nothing hard-coded."

**On screen:**
- Land on `/projects/:projectId` (ProjectDetail.tsx) for the new IITF tender.
- Highlight the **StageBanner** with the current stage and **action buttons** (Approve / Request changes / Record outcome).
- Click an action → **ActionModal** opens with the configured **inputs**; fill the **decision note**; confirm. Stage advances.

---

## (D) History & teams tracked

## Scene 8 — History timeline (6:15–6:55)

**Voiceover:**
"Every move is on the record. Open the History panel and you get a full timeline — each stage transition, each role assignment, each field change, stamped with who did it and when. Look at Bharat Mandapam — you can see execution finish, the Vertical Head send it back for one rework round, then come back for review. Total auditability, automatically."

**On screen:**
- Open **ProjectHistorySidePanel** on the IITF project to show fresh entries (creation, allocation, the action just taken).
- Then navigate to **Bharat Mandapam - G20 Legacy Exhibition** project and open its history to show the real **rework loop**: Execution → Vertical Head Review → Request changes → back to Execution → Vertical Head Review, with the **iteration/escalation badges**.

## Scene 9 — Teams on the project (6:55–7:20)

**Voiceover:**
"Below, the teams working this tender. Each team card shows its task progress at a glance, and the Project Roles section shows who's filling Coordinator, Validator, and Specialist. One screen tells you the state of every team on the project."

**On screen:**
- On a richer project — **Gulfood 2026 - India Pavilion Design & Build** (IN EXECUTION) — scroll to the **Teams-on-project cards** with progress bars.
- Show the **Project roles** section (Coordinator / Validator / Specialist) and the **custom fields** block.

---

## (E) Tasks created & assigned

## Scene 10 — Create and assign a task (7:20–7:55)

**Voiceover:**
"Work gets done as tasks. I open a team on the project, hit New Task, and assign it to a member with a priority and a due date. Inside a task you've got subtasks, comments, and attachments — so the conversation and the files live with the work, not in someone's inbox."

**On screen:**
- From the Gulfood project, open a team (**TeamOnProject.tsx**).
- Click **New Task** (**NewTaskModal**): give it a title, **assign to a team member**, set **priority** and **due date**, save.
- Open the new **task detail** to show **subtasks, comments, attachments**.

---

## (F) Kanban view

## Scene 11 — Project swimlane board (7:55–8:30)

**Voiceover:**
"And to run the floor day to day, the project Kanban. Swimlanes are the teams, columns are the statuses — to do, in progress, in review, done, blocked. I drag a card across to update its status; the board, the team card, and the history all stay in sync. That's Smart City Mission once we add tasks, and Gulfood in full flight."

**On screen:**
- Go to `/projects/:projectId/boards` (ProjectSwimlaneBoard.tsx) for **Gulfood 2026**.
- Show **swimlanes = teams**, **columns = todo / in_progress / in_review / done / blocked**.
- **Drag a card** from *in_progress* to *in_review* and let the status update settle.

---

## Scene 12 — Wrap (8:30–8:55)

**Voiceover:**
"That's Show Runner. Roles, workflows, stages, actions, projects, tasks, and boards — all configurable in minutes, no engineering required. You design the way your tenders actually run, and the platform enforces it, tracks it, and keeps everyone in sync. Let's build your workflow next."

**On screen:**
- Cut back to `/admin` (AdminDashboard.tsx): pipeline funnel, projects-by-status donut, team utilization, at-risk projects.
- End card: **Show Runner** logo.