import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { isProjectClosed } from '../lib/projectStatus'
import type { Project, Team } from '../types/models'

export interface Permissions {
  // Global role flags
  isSuperAdmin: boolean
  isAdmin: boolean // admin OR super_admin (back-compat: gates v1 admin surfaces)
  isAdminOnly: boolean // strictly admin (the VH pool)
  isHorizontalLead: boolean

  // Project contextual flags
  isProjectOwner: boolean
  isVerticalHead: boolean
  isTeamLead: boolean
  isTeamMember: boolean

  // Team-of-record on the project (for sign-off / delivery permissions)
  isCtLead: boolean
  isCsLead: boolean
  isCtMember: boolean

  // Stage-aware action flags (project banner buttons render off these)
  canAllocateVh: boolean // super admin, stage 1
  canAcceptOrEscalate: boolean // VH, stage 2
  canAddFanoutTask: boolean // VH, stage 6 — kept name for back-compat callers
  canReviewEligibility: boolean // super admin, stage 5, project not closed
  canUpdateStatus: boolean // VH or CS lead, anytime, on a non-closed project
  canSignOffValidation: boolean // CT lead, stage 7
  canApproveOrReject: boolean // VH, stage 8
  canMarkDelivered: boolean // CS lead, stage 10
  canEditProject: boolean // owner / super admin, OR not yet completed

  // Raw refs for callers that need the underlying docs
  project: Project | null
  team: Team | null
  loading: boolean
}

export function usePermissions(projectId?: string, teamId?: string): Permissions {
  const { profile } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [projectLoading, setProjectLoading] = useState<boolean>(Boolean(projectId))
  const [teamLoading, setTeamLoading] = useState<boolean>(Boolean(teamId))
  const [projectTeams, setProjectTeams] = useState<Team[]>([])
  const [projectTeamsLoading, setProjectTeamsLoading] = useState<boolean>(Boolean(projectId))

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      setProjectLoading(false)
      return
    }
    setProjectLoading(true)
    return onSnapshot(doc(db, 'projects', projectId), (snap) => {
      setProject(snap.exists() ? ({ id: snap.id, ...snap.data() } as Project) : null)
      setProjectLoading(false)
    })
  }, [projectId])

  useEffect(() => {
    if (!teamId) {
      setTeam(null)
      setTeamLoading(false)
      return
    }
    setTeamLoading(true)
    return onSnapshot(doc(db, 'teams', teamId), (snap) => {
      setTeam(snap.exists() ? ({ id: snap.id, ...snap.data() } as Team) : null)
      setTeamLoading(false)
    })
  }, [teamId])

  // Pull all teams attached to this project so we can compute CT/CS lead flags.
  useEffect(() => {
    if (!projectId) {
      setProjectTeams([])
      setProjectTeamsLoading(false)
      return
    }
    setProjectTeamsLoading(true)
    const q = query(collection(db, 'teams'), where('projectIds', 'array-contains', projectId))
    return onSnapshot(q, (snap) => {
      setProjectTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Team))
      setProjectTeamsLoading(false)
    })
  }, [projectId])

  return useMemo<Permissions>(() => {
    const uid = profile?.uid ?? null
    const role = profile?.globalRole

    const isSuperAdmin = role === 'super_admin'
    const isAdminOnly = role === 'admin'
    const isAdmin = isSuperAdmin || isAdminOnly
    const isHorizontalLead = role === 'horizontal_lead'

    const isProjectOwner = Boolean(uid && project && project.ownerId === uid)
    const isVerticalHead = Boolean(uid && project && project.vhId === uid)
    const isTeamLead = Boolean(uid && team && team.leadId === uid)
    const isTeamMember = Boolean(uid && team && team.memberIds.includes(uid))

    // Identify CT / CS team-of-record on the project. CT/CS live as department teams;
    // we identify them by name match (Copy & Strategy / Client Servicing) since `kind === 'department'`
    // alone isn't unique. Falls back gracefully when teams aren't seeded yet.
    const ctTeam = projectTeams.find((t) => /copy|strategy|^ct\b/i.test(t.name))
    const csTeam = projectTeams.find((t) => /client servicing|^cs\b/i.test(t.name))
    const isCtLead = Boolean(uid && ctTeam && ctTeam.leadId === uid)
    const isCsLead = Boolean(uid && csTeam && csTeam.leadId === uid)
    const isCtMember = Boolean(uid && ctTeam && ctTeam.memberIds.includes(uid))

    const stage = project?.stage
    const canAllocateVh = Boolean(isSuperAdmin && project && stage === 1)
    const canAcceptOrEscalate = Boolean(isVerticalHead && stage === 2)
    const canAddFanoutTask = Boolean(isVerticalHead && stage === 6)
    // CS validates and signs off (was CT in v0 of the spec; product moved validation to CS).
    const canSignOffValidation = Boolean(isCsLead && stage === 7)
    const canApproveOrReject = Boolean(isVerticalHead && stage === 8)
    const closed = isProjectClosed(project?.status)
    const canMarkDelivered = Boolean(isCsLead && stage === 10 && !closed)
    const canReviewEligibility = Boolean(isSuperAdmin && stage === 5 && !closed)
    const canUpdateStatus = Boolean(
      project && !closed && (isVerticalHead || isCsLead || isSuperAdmin),
    )
    const canEditProject = Boolean(
      project && (isSuperAdmin || isProjectOwner) && !closed,
    )

    return {
      isSuperAdmin,
      isAdmin,
      isAdminOnly,
      isHorizontalLead,
      isProjectOwner,
      isVerticalHead,
      isTeamLead,
      isTeamMember,
      isCtLead,
      isCsLead,
      isCtMember,
      canAllocateVh,
      canAcceptOrEscalate,
      canAddFanoutTask,
      canReviewEligibility,
      canUpdateStatus,
      canSignOffValidation,
      canApproveOrReject,
      canMarkDelivered,
      canEditProject,
      project,
      team,
      loading: projectLoading || teamLoading || projectTeamsLoading,
    }
  }, [profile, project, team, projectTeams, projectLoading, teamLoading, projectTeamsLoading])
}
