import { lazy, Suspense, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  useBootLoaded,
  useOrgStructure,
  useSetupCompleted,
  useWorkflowRegistry,
} from '../contexts/AppConfigContext'
import AdminActionBar from '../components/admin/AdminActionBar'
import ProjectPicker from '../components/ui/ProjectPicker'

// Sandbox-only roam-mode strip. Lazy-loaded; tree-shaken out of production
// bundles via the __IS_SANDBOX__ guard at the call site.
const SandboxTryThisLazy = __IS_SANDBOX__
  ? lazy(() => import('../components/sandbox/TryThisStrip'))
  : null
function SandboxTryThis() {
  if (!SandboxTryThisLazy) return null
  return (
    <Suspense fallback={null}>
      <SandboxTryThisLazy />
    </Suspense>
  )
}

interface CardProps {
  to: string
  eyebrow: string
  title: string
  body: string
  cta: string
}

function HomeCard({ to, eyebrow, title, body, cta }: CardProps) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-line bg-card p-6 transition hover:border-line-strong hover:bg-fill-2"
    >
      <div className="text-xs uppercase tracking-wider text-fg-subtle">{eyebrow}</div>
      <div className="mt-2 text-lg font-medium text-fg">{title}</div>
      <p className="mt-1 text-sm text-fg-subtle">{body}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-sm text-brand group-hover:text-brand">
        {cta}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>
    </Link>
  )
}

function BoardViewCard() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)

  const open = () => {
    if (selected) navigate(`/projects/${selected}/boards`)
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-line bg-card p-6 transition hover:border-line-strong hover:bg-fill-2">
      <div>
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-fg-subtle">Visualize</div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fg-subtle"
          >
            <rect x="3" y="4" width="6" height="16" rx="1" />
            <rect x="10" y="4" width="6" height="10" rx="1" />
            <rect x="17" y="4" width="4" height="7" rx="1" />
          </svg>
        </div>
        <div className="mt-2 text-lg font-medium text-fg">Board View</div>
        <p className="mt-1 text-sm text-fg-subtle">
          Kanban across every team on a project. Pick a project and jump straight in.
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <ProjectPicker
          value={selected}
          onChange={setSelected}
          placeholder="Pick a project"
          autoSelectFirst
        />
        <button
          type="button"
          onClick={open}
          disabled={!selected}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:bg-none disabled:bg-fill-4 disabled:text-fg-faint disabled:shadow-none"
        >
          Open board
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function Home() {
  const { profile, effectiveProfile } = useAuth()
  // In sandbox builds, `effectiveProfile` reflects the persona the visitor is
  // acting as (or themselves when no persona is active). Welcome copy + the
  // header context should mirror that so persona switching is visible across
  // the UI, not just in the permissions resolver.
  const display = __IS_SANDBOX__ ? (effectiveProfile ?? profile) : profile
  const bootLoaded = useBootLoaded()
  const setupCompleted = useSetupCompleted()
  const workflowRegistry = useWorkflowRegistry()
  const orgStructure = useOrgStructure()
  // Phase 2c: broadened auto-launch. Any super_admin in a fresh tenant gets
  // routed to the unified onboarding flow (org wizard → workflow wizard).
  // The dev-config allowlist no longer gates the redirect — only super_admins
  // are routed because they're the only role that can complete the wizard.
  const isSuperAdmin = profile?.globalRole === 'super_admin'
  const noActiveWorkflows = (workflowRegistry?.activeWorkflowIds ?? []).length === 0

  // Wait for the first Firestore fetch round to settle before deciding to
  // redirect. Without this, a fresh device (no localStorage cache) renders
  // against DEFAULT state — setupCompleted=false, no workflows — and the
  // user gets bounced to the wizard even when Firestore has the real values.
  if (!bootLoaded) {
    return (
      <div
        role="status"
        aria-label="Loading workspace"
        className="flex min-h-[60vh] items-center justify-center text-fg-subtle"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
      </div>
    )
  }

  if (isSuperAdmin && !setupCompleted) {
    return <Navigate to="/admin/setup" replace />
  }
  // Phase 3: first-run also routes through Roles & Hierarchy — but ONLY in the
  // onboarding window (org set up, no flow built yet, no hierarchy defined yet).
  // Existing tenants (who already have active workflows) are never pulled here.
  const hasHierarchy = (orgStructure.roleHierarchy ?? []).length > 0
  if (isSuperAdmin && noActiveWorkflows && !hasHierarchy) {
    return <Navigate to="/admin/roles?onboarding=1" replace />
  }
  if (isSuperAdmin && noActiveWorkflows) {
    return <Navigate to="/admin/workflows/new?onboarding=1" replace />
  }
  const isAdmin = display?.globalRole === 'admin' || display?.globalRole === 'super_admin'
  const firstName = display?.displayName?.split(/\s+/)[0] ?? ''

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-8" data-tour-id="home-dashboard">
      {__IS_SANDBOX__ ? <SandboxTryThis /> : null}
      <div className="mb-10">
        <p className="text-sm text-fg-subtle">
          {isAdmin ? 'Admin workspace' : 'Workspace'}
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          Welcome back{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="mt-3 max-w-2xl text-fg-muted">
          {isAdmin
            ? 'Provision new members, spin up teams, and kick off projects from anywhere.'
            : 'Jump into your tasks or see what your teams are shipping.'}
        </p>
      </div>

      {/* AdminActionBar self-gates on per-module create permissions (admins +
          hierarchy roles granted create), so it's rendered unconditionally. */}
      <div className="mb-12">
        <AdminActionBar />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <HomeCard
          to="/me"
          eyebrow="You"
          title="My Tasks"
          body="Everything assigned to you, grouped by project and team. Update status, add attachments, comment inline."
          cta="Open My Tasks"
        />
        <HomeCard
          to="/projects"
          eyebrow="Work"
          title="Projects"
          body={
            isAdmin
              ? 'Set up a new project, pick an owner, and assign teams in the next step.'
              : 'Browse the projects your teams are shipping and jump into their boards.'
          }
          cta="Open Projects"
        />
        <HomeCard
          to="/teams"
          eyebrow="Organization"
          title="Teams"
          body={
            isAdmin
              ? 'Global teams you assign to projects. Create a team and pick its lead and members.'
              : 'See the teams you belong to, your teammates, and the projects each team owns.'
          }
          cta="Open Teams"
        />
        <BoardViewCard />
        {isAdmin && (
          <HomeCard
            to="/admin/members"
            eyebrow="Admin"
            title="Members"
            body="Provision accounts, look up temporary passwords, and manage roles."
            cta="Open Members"
          />
        )}
      </div>
    </main>
  )
}