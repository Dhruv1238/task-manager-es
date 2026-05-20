import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { useOrgStructure, useWorkflow } from '../contexts/AppConfigContext'
import { isProjectClosed } from '../lib/projectStatus'
import { resolveCoordinatorTeam, resolveValidatorTeam } from '../lib/orgResolver'
import { canPerform as evaluatorCanPerform } from '../lib/workflowEvaluator'
import type { Project, Team } from '../types/models'

export interface Permissions {
  // Global role flags
  isSuperAdmin: boolean
  isAdmin: boolean // admin OR super_admin (back-compat: gates v1 admin surfaces)
  isAdminOnly: boolean // strictly admin (the lead-role pool)
  isHorizontalLead: boolean

  // Project contextual flags
  isProjectOwner: boolean
  // Phase 2a: the user pinned as project lead (project.leadUid). Renamed from
  // isVerticalHead to match the per-workflow `leadRoleName`. Falls back to the
  // legacy vhId during the dual-write transition.
  isProjectLead: boolean
  isTeamLead: boolean
  isTeamMember: boolean

  // Team-of-record on the project, resolved via the tenant's org structure.
  // Phase 1: replaces the old name-regex CT/CS lookups. Returns false when
  // the tenant hasn't configured the relevant role.
  isValidatorLead: boolean
  isCoordinatorLead: boolean
  isValidatorMember: boolean

  // Phase 2a: single generic gate. Returns true when the workflow doc allows
  // this user to perform the named action at the project's current stage.
  // Replaces the named action flags (canAllocateVh, canAcceptOrEscalate, ...).
  canPerform: (actionId: string) => boolean

  canUpdateStatus: boolean
  canEditProject: boolean

  // Chat
  canViewProjectChat: boolean

  // Raw refs for callers that need the underlying docs
  project: Project | null
  team: Team | null
  loading: boolean
}

export function usePermissions(projectId?: string, teamId?: string): Permissions {
  const { profile } = useAuth()
  const org = useOrgStructure()
  const [project, setProject] = useState<Project | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [projectLoading, setProjectLoading] = useState<boolean>(Boolean(projectId))
  const [teamLoading, setTeamLoading] = useState<boolean>(Boolean(teamId))
  const [projectTeams, setProjectTeams] = useState<Team[]>([])
  const [projectTeamsLoading, setProjectTeamsLoading] = useState<boolean>(Boolean(projectId))
  // Per-project workflow: lazy-fetched when not in the active set (e.g. an
  // old project on a now-deactivated workflow). Returns null while loading.
  const workflow = useWorkflow(project?.workflowId)

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
    const projectLeadUid = project?.leadUid ?? null
    const isProjectLead = Boolean(uid && projectLeadUid && projectLeadUid === uid)
    const isTeamLead = Boolean(uid && team && team.leadId === uid)
    const isTeamMember = Boolean(uid && team && team.memberIds.includes(uid))

    const validatorTeam = resolveValidatorTeam(projectTeams, org)
    const coordinatorTeam = resolveCoordinatorTeam(projectTeams, org)
    const isValidatorLead = Boolean(uid && validatorTeam && validatorTeam.leadId === uid)
    const isCoordinatorLead = Boolean(uid && coordinatorTeam && coordinatorTeam.leadId === uid)
    const isValidatorMember = Boolean(
      uid && validatorTeam && validatorTeam.memberIds.includes(uid),
    )

    const closed = isProjectClosed(project?.status)

    // Status-update is orthogonal to the workflow engine: the status pill
    // opens a modal that calls updateProjectStatus directly. Who can wield it
    // depends on the workflow's flow-type:
    //   - collaborative — lead / coordinator lead / super admin (matches the
    //     prior "pipeline on" behaviour where the CT lead recorded the
    //     outcome at stage 10).
    //   - individual    — the assigned lead, the project owner, and admins.
    //     Sales rep manages their own pipeline; owner / admin can override.
    //   - basic         — owner and admins (simple-mode parity).
    // When the workflow hasn't loaded yet (rare; lazy fetch in flight) we
    // fall back to the safest superset so the pill isn't gratuitously gated.
    const flowType = workflow?.flowType
    const canUpdateStatusByFlow =
      flowType === 'collaborative'
        ? isProjectLead || isCoordinatorLead || isSuperAdmin
        : flowType === 'individual'
          ? isProjectLead || isProjectOwner || isAdmin
          : flowType === 'basic'
            ? isProjectOwner || isAdmin
            : // Unknown / not yet loaded — allow the admin path through so the
              // pill remains usable during the lazy fetch.
              isProjectOwner || isAdmin
    const canUpdateStatus = Boolean(project && !closed && canUpdateStatusByFlow)
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

    // Generic action gate. Reads the active workflow + evaluator. False when:
    //   - no project loaded yet
    //   - no profile (signed out)
    //   - workflow not loaded yet (e.g. fresh tab before cache populates)
    //   - project is closed
    //   - the workflow's permission check rejects this user for this action
    function canPerform(actionId: string): boolean {
      if (!project || !profile || !workflow || closed) return false
      try {
        return evaluatorCanPerform(project, workflow, profile, projectTeams, org, actionId)
      } catch {
        return false
      }
    }

    return {
      isSuperAdmin,
      isAdmin,
      isAdminOnly,
      isHorizontalLead,
      isProjectOwner,
      isProjectLead,
      isTeamLead,
      isTeamMember,
      isValidatorLead,
      isCoordinatorLead,
      isValidatorMember,
      canPerform,
      canUpdateStatus,
      canEditProject,
      canViewProjectChat,
      project,
      team,
      loading: projectLoading || teamLoading || projectTeamsLoading,
    }
  }, [profile, org, workflow, project, team, projectTeams, projectLoading, teamLoading, projectTeamsLoading])
}
