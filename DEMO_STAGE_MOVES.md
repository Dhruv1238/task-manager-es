# Show Runner — Demo Stage-Move Cheat Sheet (clm-phase-2)

Everything below is **copy-paste ready** for recording. It's built on the *live*
`tender` workflow and the verified permission rules, so the buttons and "who can
click" are exactly what you'll see on screen.

---

## 0. Before you hit record

- **Sign in as** `rachet.juneja1@eventstrat.ai` (Super Admin) — password `ShowRunner@2026`. Drive the whole demo from this one account. *(This is the shareable email+password super-admin created for recording; the old Dhruv account is Google-only and can't be shared.)*
- **Fresh demo personas** all share password **`ShowRunner@2026`** (see `scripts/demo-credentials.txt`) if you ever want to log in as one. You won't need to for the happy path below.
- **The one rule that matters:** a few `allocated`-stage actions and `Confirm setup` are gated to the **project lead / Admin Head / Functional Head — not Super Admin**. The fix is baked in:
  - On the **live IITF tender you create**, assign **yourself (Rachet) as Admin Head** in the create form. That single step unlocks every forward action for you.
  - The two seeded projects you may advance live (**Startup Mahakumbh**, **Smart City**) already have **Admin Head = Rachet**, so you can move them with no account switching.
- Everything else (`Sign off`, `Approve`, `Record outcome`) is open to Super Admin already.

> **Optional cleanup:** there are leftover test projects on the Tender workflow (`WFI`, `WFI27`, `Bharat Tex`, `IISF`, `Second Tender`) and unrelated ones (`Aahar 2027`, `Test 1`). Say the word and I'll give you a one-line script to delete just those so the projects list / kanban only shows the polished tenders.

---

## 1. THE LIVE TENDER — IITF 2026 (the spine of the demo)

Create this on camera and walk it the whole way. Title to paste:

```
IITF 2026 — State Pavilion Design & Build, Pragati Maidan
```
Description to paste:
```
India International Trade Fair 2026 at Pragati Maidan — design & build of a state pavilion: themed scenography, product & handicraft display zones, an AV experience wall, and a meeting lounge. Responding to the state government tender.
```

### Create it (NewProjectModal)
1. **New Project** → pick workflow **Tender**.
2. Paste **title** + **description**.
3. Fill collaborative fields: **Submission date** (~2 weeks out), **Presentation date**, **Deadline**.
4. **Project roles** → set **Admin Head = Rachet Juneja (you)**. *(Optional: Functional Head = Alex Morgan.)* ← this is the unlock step.
5. *(Optional)* drop any attachment (a dummy RFP PDF reads great on camera).
6. **Create.** → Lands at stage **Project Created**.

### Walk it through the stages
Each row = the banner button to click, what to type, and where it goes. You're **Rachet** throughout.

| # | At stage | Click button | Inputs to enter | → Goes to |
|---|----------|--------------|-----------------|-----------|
| 1 | **Project Created** | **Allocate Project Leader** | *Choose Vertical Head* → **Anirudha Sisodia** | Awaiting Lead Decision |
| 2 | **Awaiting Lead Decision** | **Tender Review** *(optional — shows the eligibility branch)* | *Eligibility assessment* → `Meets state empanelment & turnover criteria — proceeding to assessment.` | Eligibility Assessment |
| 3 | **Eligibility Assessment** | **Submit Assessment** | *Eligibility Assessment* → `Eligible: prior pavilion experience, GST & turnover thresholds all met. Recommend we bid.` | back to Awaiting Lead Decision |
| 4 | **Awaiting Lead Decision** | **Accept** | *Reason* → `Eligibility cleared — setting up delivery teams.` | Task Setup |
| 5 | **Task Setup** | *(add the first task — see §2 — which auto-advances)* **or** **Confirm setup → start execution** | none | In Execution |
| 6 | **In Execution** | **Validation complete — sign off** | none | VH Review |
| 7 | **VH Review** | **Approve** | none | Ready for Client (Delivered) |
| 8 | **Ready for Client** | **Record outcome** | *Status* → **Awarded**; *Note* → `State pavilion tender awarded — work order received.` | stays, status flips to **Awarded** |

**Shortcut version** (skip the eligibility branch): at step 1 click **Allocate Project Leader** → Anirudha, then at **Awaiting Lead Decision** click **Accept** (skip rows 2–3) → Task Setup, then continue from row 5.

> If you want to show the **rejection / rework** flows: `Escalate Back` (at Awaiting Lead Decision) and `Request changes` (In Execution) both work as Rachet. `Reject — send back` at VH Review is the *only* action reserved for the actual lead — skip it or log in as Anirudha.

---

## 2. TASKS to create live on IITF (copy-paste)

At **Task Setup** (or any time after), open each team and **New Task**. Assign to the named member. Creating the first task auto-moves the project to *In Execution*.

| Team | Title | Assign to | Priority |
|------|-------|-----------|----------|
| Events Design | `State pavilion 3D concept — hero render & GA drawings` | Karthik Menon | High |
| Graphic Design | `Pavilion graphic panels, state branding & wayfinding` | Rohan Verma | High |
| Video Editing | `LED facade content & 60s state showcase film` | Tara Singh | Medium |
| Copy & Strategy | `Technical bid narrative & eligibility compliance matrix` | Ananya Bose | High |
| Client Servicing | `Submission dossier — EMD, tender fee & compliance checklist` | Meera Iyer | High |

*(Descriptions optional — these titles alone fill the swimlane board nicely.)*

---

## 3. MOVING THE SEEDED PROJECTS LIVE (optional B-roll)

These already exist with full history + tasks. Each has one natural "next action" you can perform on camera as **Rachet**:

| Project | Currently at | Click | Inputs | → |
|---------|--------------|-------|--------|---|
| **Gulfood 2026 — India Pavilion** | In Execution | **Validation complete — sign off** | none | VH Review |
| **Bharat Mandapam — G20 Legacy** | VH Review | **Approve** | none | Delivered |
| ↳ then | Delivered | **Record outcome** | Status → **Awarded**, Note → `Exhibition handed over & awarded.` | status Awarded |
| **Startup Mahakumbh 2026** | Awaiting Lead Decision | **Accept** | Reason → `Allocated and accepted — moving to setup.` | Task Setup |
| **Smart City Mission** | Task Setup | add first task (auto) **or** **Confirm setup → start execution** | none | In Execution |

*(Gulfood & G20 you advance as Super Admin via `Sign off`/`Approve`. Mahakumbh & Smart City have Admin Head = Rachet, so `Accept`/`Confirm setup` work too.)*

---

## 4. WHICH PROJECT TO OPEN FOR EACH DEMO BEAT

| Demo beat | Open this | Why |
|-----------|-----------|-----|
| **History / timeline** | **Bharat Mandapam — G20** | richest timeline: shows the **rework loop** (Execution → Review → sent back → Execution → Review) and the **iteration badge** |
| **History incl. eligibility branch** | **Auto Expo 2026** | full journey: Created → Allocated → **Eligibility** → back → Setup → Execution → Review → Delivered → **Awarded** |
| **Teams on project + task progress** | **Gulfood 2026** | 5 teams attached, 10 tasks, progress bars across all of them |
| **Kanban swimlanes** | **Gulfood 2026** → `/projects/<id>/boards` | only board with **all five columns populated**: To do · In progress · In review · Done · Blocked |
| **Add task → auto-advance** | **Smart City Mission** | sits at Task Setup; adding the first task visibly bumps it to Execution |
| **Analytics** | `/admin` | funnel spans Allocated→Task Setup→Execution→Review→Delivered; status donut shows Awarded / Submitted / In progress |

---

## 5. WHAT'S ON THE GULFOOD BOARD (so you know the columns will look full)

10 tasks across 5 teams, deliberately spread so every kanban column has cards:

- **Done:** Pavilion master plan & GA drawings (Karthik) · Technical bid narrative & compliance matrix (Ananya) · Submission dossier — EMD & tender fee (Meera)
- **In progress:** Custom hero arch & lounge fabrication (Ishaan) · Signage, wayfinding & co-exhibitor fascia (Rohan) · Hero LED wall content & 90s brand film (Tara)
- **In review:** 3D pavilion walkthrough animation (Aditya) · Co-exhibitor profile content & lounge copy (Rhea)
- **To do:** On-site build master timeline & deliverable tracker (Arjun)
- **Blocked:** AV & lighting rig BOQ — awaiting Dubai vendor quote (Videsh)
