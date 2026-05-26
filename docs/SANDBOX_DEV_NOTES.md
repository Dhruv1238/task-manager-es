# Sandbox — Developer Notes

The "try the platform" experience runs on the same codebase as production, with a build-time flag (`VITE_IS_SANDBOX=true`) that switches Firestore paths, mounts sandbox-only surfaces, and neuters external effects.

If you're new to this codebase, read [SANDBOX_PLAN.md](../SANDBOX_PLAN.md) and the planning doc at `~/.claude/plans/this-is-a-plan-linear-cocoa.md` first. This file is the developer cheat-sheet.

## The build flag

- **`VITE_IS_SANDBOX`** — set in `.env.sandbox`. `true` enables sandbox mode.
- **`__IS_SANDBOX__`** — a Vite `define`-injected literal. Use this in code-paths you want **stripped entirely from production bundles** (dead-code-eliminated).
- **`IS_SANDBOX`** — runtime const exported from [src/lib/firestore.ts](../src/lib/firestore.ts), value comes from `import.meta.env`. Use this for runtime branches that don't need to be stripped.

Rule of thumb: use `__IS_SANDBOX__` for module-level guards that gate imports of sandbox-only code; use `IS_SANDBOX` for runtime branches inside shared functions.

## Two builds, two Firebases

There's one set of commands. The build target is controlled entirely by `.env`. Swap the file (or its values) to whichever target you want before building.

| Target | What `.env` must contain | Firebase | Paths |
|---|---|---|---|
| Production | `VITE_IS_SANDBOX=false` + production Firebase creds | client-prod | `/projects`, `/workflows`, `/config/orgStructure`, … |
| Sandbox | `VITE_IS_SANDBOX=true` + sandbox Firebase creds | sandbox project | `/sandbox/{visitorUid}/projects`, … + `/leads/{leadId}` + `/sandboxConfig/main` |

Then in both cases:
- `npm run dev` — dev server
- `npm run build` — production build

`vite.config.ts` reads `VITE_IS_SANDBOX` via `loadEnv` and bakes it into the bundle as the build-time literal `__IS_SANDBOX__`, which is what drives tree-shaking of sandbox-only code in production builds.

## tenantCol / tenantDoc — the discipline

**Every Firestore reference must go through `tenantCol` / `tenantDoc`** (from `src/lib/firestore.ts`). ESLint enforces this — `no-restricted-syntax` blocks direct `collection(db, ...)` / `doc(db, ...)`.

```ts
import { tenantCol, tenantDoc } from '../lib/firestore'

// Good
const projectsRef = tenantCol('projects')
const userRef = tenantDoc('users', uid)

// Bad — lint error
const projectsRef = collection(db, 'projects')
```

**Two paths are intentionally NOT tenant-prefixed in sandbox mode:**
1. `/leads/{leadId}` — top-level lead doc. Written via [`leadCapture.ts`](../src/lib/leadCapture.ts) with a per-line `// eslint-disable-next-line` for the direct ref.
2. `/sandboxConfig/main` — public beacon doc. Read via [`sandboxConfig.ts`](../src/lib/sandboxConfig.ts).

## The two-phase seed

[`sandboxSeed.ts`](../src/lib/sandboxSeed.ts) owns both phases. The orchestrator is [`sandboxBoot.ts`](../src/lib/sandboxBoot.ts).

- **Phase A** — runs immediately after first-entry auth resolves. Writes `_meta`, lead doc, placeholder `config/orgStructure` (with `setupCompleted: false`), and empty `workflows/_registry`. The wizards then fire on the dashboard mount.
- **Phase B** — runs once both wizards complete (`setupCompleted: true && activeWorkflowIds.length > 0`). Adds the rich content: personas, sample projects, sample tasks. Sets `_meta.richSeedCompleted: true`.

Phase B's `watchForPhaseB()` polls every 1.5s after auth resolves. When it fires, the 60-second tour auto-mounts (`TourOverlay` detects `richSeedCompleted && !tourProgress.completedAt`).

## sandboxNeutering — the wrapper surface

[`sandboxNeutering.ts`](../src/lib/sandboxNeutering.ts) wraps external-effect calls (email sends, invites, webhooks). Any new external integration should go through one of these:

```ts
import { sendEmail } from '../lib/sandboxNeutering'

await sendEmail(recipient, subject, async () => {
  // production-only send
  await myEmailProvider.send(...)
})
```

In sandbox, the wrapper short-circuits and surfaces a toast via the sink registered by `SandboxShell`.

## data-tour-id — the tour anchor convention

The 60-second tour ([`sixtySecondTour.ts`](../src/lib/tours/sixtySecondTour.ts)) finds its targets via `data-tour-id="<key>"` attributes. Current anchors:

- `home-dashboard` — main page wrapper on Home.tsx
- `project-stage-banner` — stage banner on ProjectDetail.tsx
- `my-tasks` — main wrapper on Me.tsx
- `review-queue` — "Projects awaiting my action" section on Me.tsx
- `project-history` — *missing, tour falls back gracefully*
- `sandbox-menu`, `sandbox-banner`, `persona-switcher`, `sandbox-email` — sandbox UI anchors

When you ship UI changes that touch tour targets, search for `data-tour-id` and verify the attribute still exists. The overlay has a runtime fallback (auto-skip after 1.5s if target missing), but maintenance is on you.

## Persona switching

`AuthContext` exposes `actAsUid` + `effectiveUid` + `setActAs`. In production these are no-ops:
- `setActAs` is gated on `__IS_SANDBOX__` — calls are ignored.
- `effectiveUid` always equals the real auth uid.

`usePermissions` reads `effectiveUid` when `__IS_SANDBOX__` is true. The persona's *role* is still derived from the visitor's profile for now — full per-persona role resolution is a deeper refactor (a TODO if persona switching needs richer permission semantics).

## Lead export (sales lifeline)

[`scripts/exportSandboxLeads.ts`](../scripts/exportSandboxLeads.ts) — Node CLI that reads `/leads/` via the Admin SDK and dumps a CSV. Requires `scripts/sandbox-sa.json` (download from the Firebase console; gitignored). Run:

```bash
npx tsx scripts/exportSandboxLeads.ts --engagementMin=3 --out=leads.csv
```

## Cross-env paranoia

[`CrossEnvGuard.tsx`](../src/components/sandbox/CrossEnvGuard.tsx) checks `/sandboxConfig/main` at mount. If the doc is missing or `isSandbox !== true`, refuses to render the rest of the app — prevents a sandbox build accidentally connecting to a production Firebase.

You must manually create `/sandboxConfig/main` in the sandbox Firebase with `{ isSandbox: true, banner: "...", contactEmail: "...", calendlyUrl: "..." }` before the app will run.

## Security rules

[`firestore.sandbox.rules`](../firestore.sandbox.rules) is the sandbox-only ruleset. Deploy with:

```bash
firebase deploy --only firestore:rules --project sandbox
```

Production keeps using `firestore.rules` unchanged.

## Files added by the sandbox effort

- Types: `src/types/sandbox.ts`, `src/types/lead.ts`
- Libs: `sandboxSeed.ts`, `sandboxBoot.ts`, `sandboxConfig.ts`, `sandboxAvatar.ts`, `sandboxNeutering.ts`, `leadCapture.ts`, `engagement.ts`
- Tour: `src/lib/tours/types.ts`, `tourOrchestrator.ts`, `sixtySecondTour.ts`
- Pages: `src/pages/SandboxLogin.tsx`
- Components: `src/components/sandbox/*` (SandboxShell, SandboxBanner, SandboxMenu, SandboxErrorBoundary, SandboxLoader, CrossEnvGuard, PersonaSwitcher, TourOverlay, HintBubble, TryThisStrip, capture/*)
- Scripts: `scripts/exportSandboxLeads.ts`
- Rules: `firestore.sandbox.rules`
- Env: `VITE_IS_SANDBOX` flag in `.env`

## When you add a new feature

1. **Firestore refs** — use `tenantCol` / `tenantDoc`. ESLint will yell if you don't.
2. **External effects** — wrap with `sandboxNeutering`.
3. **Tour-relevant UI** — add a `data-tour-id` if the surface is on the tour path.
4. **No new top-level paths** — sandbox security rules default-deny anything outside `/sandbox/{uid}/...`, `/leads/{uid}`, `/sandboxConfig/main`.
