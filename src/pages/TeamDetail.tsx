import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAllUsers } from '../hooks/useAllUsers'
import { useAllProjects } from '../hooks/useAllProjects'
import { useTeamTasks } from '../hooks/useTeamTasks'
import { usePermissions } from '../hooks/usePermissions'
import AddTeamMemberModal from '../components/admin/AddTeamMemberModal'
import RemoveMemberConfirmModal from '../components/admin/RemoveMemberConfirmModal'
import { useAuth } from '../contexts/AuthContext'
import { setTeamLead } from '../lib/firestore'
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
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-500 to-fuchsia-500 font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initialsFor(user)}
    </div>
  )
}

function StatusDot({ status }: { status: ProjectStatus }) {
  const cls: Record<ProjectStatus, string> = {
    in_progress: 'bg-white/40',
    submitted: 'bg-blue-400',
    not_submitted: 'bg-white/30',
    awarded: 'bg-emerald-400',
    lost: 'bg-red-400',
    on_hold: 'bg-amber-400',
  }
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cls[status]}`}
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
  const { isAdmin, isTeamLead } = usePermissions(undefined, teamId)
  const { user: authUser, profile } = useAuth()
  const canManageRoster = isAdmin || isTeamLead

  useEffect(() => {
    if (!teamId) return
    return onSnapshot(
      doc(db, 'teams', teamId),
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
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-white/40 sm:px-6 lg:px-8">
        Loading team…
      </div>
    )
  }

  if (notFound || !team) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-white">Team not found</h1>
        <p className="mt-2 text-white/50">It may have been deleted or the link is invalid.</p>
        <Link
          to="/teams"
          className="mt-6 inline-block rounded-lg border border-white/10 bg-white/4 px-4 py-2 text-sm text-white/80 transition hover:bg-white/8"
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
  const assignedProjects = projects.filter((p) =>
    (p.teamIds ?? []).includes(team.id),
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/teams"
        className="inline-flex items-center gap-1 text-sm text-white/50 transition hover:text-white/80"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All teams
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-white">{team.name}</h1>
        {team.description && (
          <p className="mt-2 max-w-2xl text-white/60">{team.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50">
          <span>
            {team.memberIds.length} member{team.memberIds.length === 1 ? '' : 's'}
          </span>
          <span>
            {team.projectIds?.length ?? 0} project
            {(team.projectIds?.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="mb-6 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/2 p-0.5">
        {(['overview', 'analytics'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === t
                ? 'bg-white/8 text-white'
                : 'text-white/60 hover:bg-white/4 hover:text-white/90'
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
            <h2 className="text-sm font-medium uppercase tracking-wider text-white/40">
              Members
            </h2>
            {canManageRoster && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-3 py-1.5 text-xs font-medium text-white/85 transition hover:bg-white/8 hover:text-white"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add member
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/2">
            {members.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-white/40">
                No members hydrated yet.
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {members.map((m) => {
                  const isLead = m.uid === team.leadId
                  const showRemove = canManageRoster && !isLead
                  const showMakeLead = canManageRoster && !isLead
                  const promoting = promotingLeadUid === m.uid
                  return (
                    <li key={m.uid} className="group flex items-center gap-3 px-5 py-3">
                      <Avatar user={m} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {m.displayName}
                        </div>
                        <div className="truncate text-xs text-white/50">{m.email}</div>
                      </div>
                      {isLead && (
                        <span className="inline-flex items-center rounded-full border border-purple-400/40 bg-purple-500/15 px-2.5 py-0.5 text-xs font-medium text-purple-200">
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
                          className="rounded-md border border-white/10 bg-white/4 px-2.5 py-1 text-[11px] font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
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
                          className="rounded-md p-1.5 text-white/30 transition hover:bg-white/5 hover:text-red-300 sm:opacity-0 sm:group-hover:opacity-100"
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
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/40">
            Projects
          </h2>
          {assignedProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/1 p-6 text-sm text-white/40">
              Not assigned to any projects yet.
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-white/10 bg-white/2">
              {assignedProjects.map((p) => {
                const overdue =
                  p.deadline &&
                  isProjectLive(p.status) &&
                  p.deadline.toDate().getTime() < Date.now()
                return (
                  <li key={p.id} className="border-b border-white/5 last:border-b-0">
                    <Link
                      to={`/projects/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/4"
                    >
                      <StatusDot status={p.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {p.title}
                        </div>
                        <div className={`text-xs ${overdue ? 'text-red-300' : 'text-white/40'}`}>
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
                        className="shrink-0 text-white/30"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <h2 className="mt-6 mb-3 text-sm font-medium uppercase tracking-wider text-white/40">
            Details
          </h2>
          <div className="rounded-2xl border border-white/10 bg-white/2 p-5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-white/50">Lead</span>
              <span className="text-white/85">{lead?.displayName ?? '—'}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-white/50">Created</span>
              <span className="text-white/85">
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