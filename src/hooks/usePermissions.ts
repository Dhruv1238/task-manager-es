import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { usePipelineEnabled, useOrgStructure } from '../contexts/AppConfigContext'
import { isProjectClosed } from '../lib/projectStatus'
import { resolveCoordinatorTeam, resolveValidatorTeam } from '../lib/orgResolver'
import type { Project, Team } from '../types/models'

export interface Permissions {
  // Global role flags
  isSuperAdmin: boolean
  isAdmin: boolean // admin OR super_admin (back-compat: gates v1 admin surfaces)
  isAdminOnly: boolean // strictly admin (the lead-role pool)
  isHorizontalLead: boolean

  // Project contextual flags
  isProjectOwner: boolean
  isVerticalHead: boolean
  isTeamLead: boolean
  isTeamMember: boolean

  // Team-of-record on the project, resolved via the tenant's org structure.
  // Phase 1: replaces the old name-regex CT/CS lookups. Returns false when
  // the tenant hasn't configured the relevant role.
  isValidatorLead: boolean
  isCoordinatorLead: boolean
  isValidatorMember: boolean

  // Stage-aware action flags (project banner buttons render off these)
  canAllocateVh: boolean // super admin, stage 1
  canAcceptOrEscalate: boolean // VH, stage 2
  canAddFanoutTask: boolean // VH, stage 6 — kept name for back-compat callers
  canReviewEligibility: boolean // super admin, stage 5, project not closed
  canUpdateStatus: boolean // VH or coordinator lead, anytime, on a non-closed project
  canSignOffValidation: boolean // validator lead, stage 7
  canApproveOrReject: boolean // VH, stage 8
  canMarkDelivered: boolean // coordinator lead, stage 10
  canEditProject: boolean // owner / super admin, OR not yet completed

  // Chat
  canViewProjectChat: boolean // super admin, project owner, or member of any team on the project

  // Raw refs for callers that need the underlying docs
  project: Project | null
  team: Team | null
  loading: boolean
}

export function usePermissions(projectId?: string, teamId?: string): Permissions {
  const { profile } = useAuth()
  const pipelineEnabled = usePipelineEnabled()
  const org = useOrgStructure()
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

    // Identify the validator and coordinator teams on this project via the
    // tenant's org structure. The resolver returns null when the tenant hasn't
    // configured the relevant role — every flag below is null-safe.
    const validatorTeam = resolveValidatorTeam(projectTeams, org)
    const coordinatorTeam = resolveCoordinatorTeam(projectTeams, org)
    const isValidatorLead = Boolean(uid && validatorTeam && validatorTeam.leadId === uid)
    const isCoordinatorLead = Boolean(uid && coordinatorTeam && coordinatorTeam.leadId === uid)
    const isValidatorMember = Boolean(
      uid && validatorTeam && validatorTeam.memberIds.includes(uid),
    )

    const stage = project?.stage
    // When the tender pipeline is disabled, every stage-aware action collapses
    // to false — there is no pipeline to advance through. Status update and
    // edit-project remain active so simple-mode users can still mark projects
    // completed / on hold and edit project fields.
    const canAllocateVh = Boolean(pipelineEnabled && isSuperAdmin && project && stage === 1)
    const canAcceptOrEscalate = Boolean(pipelineEnabled && isVerticalHead && stage === 2)
    const canAddFanoutTask = Boolean(pipelineEnabled && isVerticalHead && stage === 6)
    // Validator team's lead signs off at stage 7. Returns false if the tenant
    // hasn't configured a validator role.
    const canSignOffValidation = Boolean(pipelineEnabled && isValidatorLead && stage === 7)
    const canApproveOrReject = Boolean(pipelineEnabled && isVerticalHead && stage === 8)
    const closed = isProjectClosed(project?.status)
    const canMarkDelivered = Boolean(
      pipelineEnabled && isCoordinatorLead && stage === 10 && !closed,
    )
    const canReviewEligibility = Boolean(pipelineEnabled && isSuperAdmin && stage === 5 && !closed)
    // In simple mode, the project owner (alongside admins/super_admins) can
    // update status — there is no VH/coordinator to delegate to.
    const canUpdateStatus = Boolean(
      project &&
        !closed &&
        (pipelineEnabled
          ? isVerticalHead || isCoordinatorLead || isSuperAdmin
          : isProjectOwner || isAdmin),
    )
    const canEditProject = Boolean(
      project && (isSuperAdmin || isProjectOwner) && !closed,
    )

    const userTeamIds = profile?.teamIds ?? []
    const isProjectTeamMember = Boolean(
      uid && project && project.teamIds.some((tid) => userTeamIds.includes(tid)),
    )
    const canViewProjectChat = Boolean(
      project && (isSuperAdmin || isProjectOwner || isProjectTeamMember),
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
      isValidatorLead,
      isCoordinatorLead,
      isValidatorMember,
      canAllocateVh,
      canAcceptOrEscalate,
      canAddFanoutTask,
      canReviewEligibility,
      canUpdateStatus,
      canSignOffValidation,
      canApproveOrReject,
      canMarkDelivered,
      canEditProject,
      canViewProjectChat,
      project,
      team,
      loading: projectLoading || teamLoading || projectTeamsLoading,
    }
  }, [profile, pipelineEnabled, org, project, team, projectTeams, projectLoading, teamLoading, projectTeamsLoading])
}
