# Scripts

Operator-facing utilities. Each entry below describes the script's purpose,
how to invoke it, and the expected output / post-run steps.

---

## Org-structure seed (phase 1)

**File**: `src/lib/seedOrgStructure.ts` — exports `seedClientAOrgStructure(adminUid)`.

This is the phase-1 migration runner for Client A. It is **strict**: it writes
`/config/orgStructure` and nothing else. Existing team docs are not touched —
the operator maps each team to a role via `/admin/config` after seeding.

### When to run

- **Once**, against the production Firebase project, before phase 1 ships to
  Client A. Without this run, the `setupCompleted` flag is missing and the
  Client A super_admin gets auto-redirected into the setup wizard.
- After running, the operator must walk through `/admin/config` →
  Organization structure → Team mapping and categorize the existing 5 teams:

  | Existing team             | teamRoleId   | workTypes  |
  | ------------------------- | ------------ | ---------- |
  | Client Servicing — Marcom | coordinator  | []         |
  | Copy & Strategy           | validator    | []         |
  | 2D Graphic Design         | specialist   | ['2D']     |
  | 2D & 3D Events            | specialist   | ['3D']     |
  | Video Editing             | specialist   | ['Video']  |

  Until this manual mapping is done, the stage-7 sign-off button stays
  hidden — the resolver finds no validator team.

### How to invoke

Wired into the admin UI as a button in Sprint 9. For now, run from the
DevTools console while signed in as a super_admin:

```js
const mod = await import('/src/lib/seedOrgStructure.ts')
const result = await mod.seedClientAOrgStructure('<adminUid>')
console.log(result)
// → { created: true, previousVersion: 0, newVersion: 1 }
```

### What the doc looks like after seeding

```json
{
  "version": 1,
  "updatedAt": "<server timestamp>",
  "updatedBy": "<adminUid>",
  "leadRoleName": "Vertical Head",
  "teamRoles": {
    "hasCoordinator": true,
    "hasValidator": true,
    "hasSpecialist": true
  },
  "workTypes": ["2D", "3D", "Video"],
  "allotment": { "mode": "manual" },
  "setupCompleted": true
}
```

### Re-running

Safe — `seedClientAOrgStructure` overwrites with the same defaults but bumps
`version` and `updatedAt`. It does **not** reset operator edits made through
`/admin/config`; if you've changed `leadRoleName` to "Account Manager" via
the admin screen, re-running this seeder reverts it back to "Vertical Head".
Use sparingly.

---

## Firestore rules deploy

Rules live in `firestore.rules` at repo root. After editing, deploy via:

```bash
firebase deploy --only firestore:rules
```

Phase 1 added a `/config/orgStructure` rule block: read for any signed-in
user; write restricted to super_admin.
