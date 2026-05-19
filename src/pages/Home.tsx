import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSetupCompleted } from '../contexts/AppConfigContext'
import { isDevConfigUser } from '../components/DevConfigRoute'
import AdminActionBar from '../components/admin/AdminActionBar'
import ProjectPicker from '../components/ui/ProjectPicker'

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
  const { profile } = useAuth()
  const setupCompleted = useSetupCompleted()
  // First-time auto-launch: gated dev-config users land on the setup wizard
  // until /config/orgStructure has setupCompleted: true. Other users see the
  // app in default-minimal state regardless of setup state.
  if (!setupCompleted && isDevConfigUser(profile)) {
    return <Navigate to="/admin/setup" replace />
  }
  const isAdmin = profile?.globalRole === 'admin' || profile?.globalRole === 'super_admin'
  const firstName = profile?.displayName?.split(/\s+/)[0] ?? ''

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
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

      {isAdmin && (
        <div className="mb-12">
          <AdminActionBar />
        </div>
      )}

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