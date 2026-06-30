import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {  onSnapshot } from 'firebase/firestore'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAllProjects } from '../hooks/useAllProjects'
import { useTeamTasks } from '../hooks/useTeamTasks'
import { usePermissions } from '../hooks/usePermissions'
import AddTeamMemberModal from '../components/admin/AddTeamMemberModal'
import RemoveMemberConfirmModal from '../components/admin/RemoveMemberConfirmModal'
import { useAuth } from '../contexts/AuthContext'
import { setTeamLead, tenantDoc } from '../lib/firestore'
import { isProjectLive } from '../lib/projectStatus'
import MemberWorkload from '../components/charts/MemberWorkload'
import WeeklyCompletionLine from '../components/charts/WeeklyCompletionLine'
import StatusDonut from '../components/charts/StatusDonut'
import type { ProjectStatus, Team, User } from '../types/models'

type TeamTab = 'overview' | 'analytics'

function initialsFor(u: User): string {
  const src = u.displayName || u.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

function StatusDot({ status }: { status: ProjectStatus | string }) {
  const cls: Record<string, string> = {
    in_progress: 'bg-neutral-dot',
    submitted: 'bg-info-dot',
    not_submitted: 'bg-neutral-dot',
    awarded: 'bg-success-dot',
    completed: 'bg-mint-dot',
    lost: 'bg-danger-dot',
    on_hold: 'bg-warn-dot',
    archived: 'bg-neutral-dot',
  }
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cls[status] ?? 'bg-neutral-dot'}`}
      aria-hidden
    />
  )
}

function formatDate(ts?: { toDate(): Date }): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>()
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState<User | null>(null)
  const [promotingLeadUid, setPromotingLeadUid] = useState<string | null>(null)
  const [tab, setTab] = useState<TeamTab>('overview')
  const { users } = useAllUsers()
  const { projects } = useAllProjects()
  const { tasks: teamTasks } = useTeamTasks(teamId)
  const { isAdmin, isTeamLead, can } = usePermissions(undefined, teamId)
  const { user: authUser, profile } = useAuth()
  // Admins, the team lead, or anyone the Role-Hierarchy grants Teams → Update.
  const canManageRoster = isAdmin || isTeamLead || can('teams', 'update')

  useEffect(() => {
    if (!teamId) return
    return onSnapshot(
      tenantDoc('teams', teamId),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true)
          setTeam(null)
        } else {
          setTeam({ ...(snap.data() as Team), id: snap.id })
          setNotFound(false)
        }
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [teamId])

  const userById = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.uid, u)
    return m
  }, [users])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-fg-subtle sm:px-6 lg:px-8">
        Loading team…
      </div>
    )
  }

  if (notFound || !team) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-fg">Team not found</h1>
        <p className="mt-2 text-fg-subtle">It may have been deleted or the link is invalid.</p>
        <Link
          to="/teams"
          className="mt-6 inline-block rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-4"
        >
          Back to teams
        </Link>
      </div>
    )
  }

  const lead = userById.get(team.leadId)
  const members = team.memberIds
    .map((uid) => userById.get(uid))
    .filter(Boolean) as User[]
  // Only roster managers (admins, the team lead, teams-update holders) see this
  // team's attached projects here. Everyone else uses the access-scoped Projects
  // list — surfacing every attached project on this open team route would leak
  // project titles/links to users without access to them.
  const assignedProjects = canManageRoster
    ? projects.filter((p) => (p.teamIds ?? []).includes(team.id))
    : []

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/teams"
        className="inline-flex items-center gap-1 text-sm text-fg-subtle transition hover:text-fg-muted"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All teams
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-fg">{team.name}</h1>
        {team.description && (
          <p className="mt-2 max-w-2xl text-fg-muted">{team.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-fg-subtle">
          <span>
            {team.memberIds.length} member{team.memberIds.length === 1 ? '' : 's'}
          </span>
          <span>
            {team.projectIds?.length ?? 0} project
            {(team.projectIds?.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {!team.leadId && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-tone-warn-bd bg-tone-warn-bg p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tone-warn-bd/40 text-tone-warn-fg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-medium text-tone-warn-fg">No team lead assigned</div>
              <div className="mt-0.5 text-xs text-tone-warn-fg/80">
                {canManageRoster
                  ? team.memberIds.length === 0
                    ? 'Add at least one member, then promote them to team lead.'
                    : 'Promote a member to team lead from the list below.'
                  : 'An admin needs to assign someone before this team can own work.'}
              </div>
            </div>
          </div>
          {canManageRoster && team.memberIds.length === 0 && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-tone-warn-bd bg-canvas px-3 py-1.5 text-xs font-medium text-tone-warn-fg transition hover:bg-fill-2"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add member
            </button>
          )}
        </div>
      )}

      <div className="mb-6 inline-flex items-center gap-1 rounded-lg border border-line bg-card p-0.5">
        {(['overview', 'analytics'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === t
                ? 'bg-fill-4 text-fg'
                : 'text-fg-muted hover:bg-fill-2 hover:text-fg-strong'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'analytics' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <MemberWorkload
              tasks={teamTasks}
              users={userById}
              teams={new Map([[team.id, team]])}
              memberUids={team.memberIds}
            />
          </div>
          <StatusDonut
            tasks={teamTasks}
            title="Status distribution"
            subtitle="All open team tasks"
            excludeDone
          />
          <WeeklyCompletionLine
            tasks={teamTasks}
            title="Velocity"
            subtitle="Completed per week (last 8)"
          />
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
              Members
            </h2>
            {canManageRoster && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add member
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            {members.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-fg-subtle">
                No members hydrated yet.
              </div>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {members.map((m) => {
                  const isLead = m.uid === team.leadId
                  const showRemove = canManageRoster && !isLead
                  const showMakeLead = canManageRoster && !isLead
                  const promoting = promotingLeadUid === m.uid
                  return (
                    <li key={m.uid} className="group flex items-center gap-3 px-5 py-3">
                      <Avatar user={m} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg">
                          {m.displayName}
                        </div>
                        <div className="truncate text-xs text-fg-subtle">{m.email}</div>
                      </div>
                      {isLead && (
                        <span className="inline-flex items-center rounded-full border border-brand-edge bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                          Lead
                        </span>
                      )}
                      {showMakeLead && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (promotingLeadUid) return
                            if (!authUser) return
                            setPromotingLeadUid(m.uid)
                            try {
                              await setTeamLead({
                                teamId: team.id,
                                newLeadUid: m.uid,
                                actorId: authUser.uid,
                                actorName: profile?.displayName ?? authUser.email ?? 'Admin',
                                teamName: team.name,
                                fromLeadId: team.leadId,
                              })
                            } finally {
                              setPromotingLeadUid(null)
                            }
                          }}
                          disabled={promoting}
                          title={`Promote ${m.displayName} to team lead`}
                          className="rounded-md border border-line bg-fill-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          {promoting ? 'Promoting…' : 'Make lead'}
                        </button>
                      )}
                      {showRemove && (
                        <button
                          type="button"
                          onClick={() => setRemoving(m)}
                          aria-label={`Remove ${m.displayName}`}
                          title="Remove from team"
                          className="rounded-md p-1.5 text-fg-faint transition hover:bg-fill-2 hover:text-tone-danger-fg sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
            Projects
          </h2>
          {!canManageRoster ? (
            <div className="rounded-2xl border border-dashed border-line bg-card p-6 text-sm text-fg-subtle">
              Only team leads and admins can view this team's projects.
            </div>
          ) : assignedProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-card p-6 text-sm text-fg-subtle">
              Not assigned to any projects yet.
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-line bg-card">
              {assignedProjects.map((p) => {
                const overdue =
                  p.deadline &&
                  isProjectLive(p.status) &&
                  p.deadline.toDate().getTime() < Date.now()
                return (
                  <li key={p.id} className="border-b border-line-subtle last:border-b-0">
                    <Link
                      to={`/projects/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-fill-2"
                    >
                      <StatusDot status={p.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg">
                          {p.title}
                        </div>
                        <div className={`text-xs ${overdue ? 'text-tone-danger-fg' : 'text-fg-subtle'}`}>
                          {overdue ? 'Overdue · ' : ''}
                          {p.deadline ? `Due ${formatDate(p.deadline)}` : 'No deadline'}
                        </div>
                      </div>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-fg-faint"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <h2 className="mt-6 mb-3 text-sm font-medium uppercase tracking-wider text-fg-subtle">
            Details
          </h2>
          <div className="rounded-2xl border border-line bg-card p-5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-fg-subtle">Lead</span>
              <span className="text-fg-strong">{lead?.displayName ?? '—'}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-fg-subtle">Created</span>
              <span className="text-fg-strong">
                {team.createdAt?.toDate().toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                }) ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
      )}

      <AddTeamMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teamId={team.id}
        teamName={team.name}
        currentMemberIds={team.memberIds}
      />

      {removing && (
        <RemoveMemberConfirmModal
          open
          onClose={() => setRemoving(null)}
          teamId={team.id}
          teamName={team.name}
          member={removing}
        />
      )}
    </div>
  )
}