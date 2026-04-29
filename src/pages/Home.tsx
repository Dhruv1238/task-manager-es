import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAccessibleProjects } from '../hooks/useAccessibleProjects'
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
      className="group rounded-2xl border border-white/10 bg-white/2 p-6 transition hover:border-white/20 hover:bg-white/4"
    >
      <div className="text-xs uppercase tracking-wider text-white/40">{eyebrow}</div>
      <div className="mt-2 text-lg font-medium text-white">{title}</div>
      <p className="mt-1 text-sm text-white/50">{body}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-sm text-purple-300 group-hover:text-purple-200">
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
  const { projects, loading } = useAccessibleProjects()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)

  const effective = selected ?? projects[0]?.id ?? null

  const open = () => {
    if (effective) navigate(`/projects/${effective}/boards`)
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/2 p-6 transition hover:border-white/20 hover:bg-white/4">
      <div>
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-white/40">Visualize</div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white/40"
          >
            <rect x="3" y="4" width="6" height="16" rx="1" />
            <rect x="10" y="4" width="6" height="10" rx="1" />
            <rect x="17" y="4" width="4" height="7" rx="1" />
          </svg>
        </div>
        <div className="mt-2 text-lg font-medium text-white">Board View</div>
        <p className="mt-1 text-sm text-white/50">
          Kanban across every team on a project. Pick a project and jump straight in.
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <ProjectPicker
          value={effective}
          onChange={setSelected}
          projects={projects}
          placeholder={loading ? 'Loading projects…' : 'No projects available'}
          disabled={loading}
        />
        <button
          type="button"
          onClick={open}
          disabled={!effective}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover:from-purple-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 disabled:shadow-none"
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
  const isAdmin = profile?.globalRole === 'admin'
  const firstName = profile?.displayName?.split(/\s+/)[0] ?? ''

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10">
        <p className="text-sm text-white/40">
          {isAdmin ? 'Admin workspace' : 'Workspace'}
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Welcome back{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="mt-3 max-w-2xl text-white/60">
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