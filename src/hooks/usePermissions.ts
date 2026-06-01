import { useEffect, useMemo, useState } from 'react'
import {   onSnapshot, query, where } from 'firebase/firestore'
import { tenantCol, tenantDoc } from '../lib/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useOrgStructure, useProjectWorkflow } from '../contexts/AppConfigContext'
import { isProjectClosed } from '../lib/projectStatus'
import { resolveCoordinatorTeam, resolveValidatorTeam } from '../lib/orgResolver'
import {
  canPerform as evaluatorCanPerform,
  canUpdateProjectStatus,
} from '../lib/workflowEvaluator'
import type { Project, Team } from '../types/models'

export interface Permissions {
  // Global role flags
  isSuperAdmin: boolean
  isAdmin: boolean // admin OR super_admin (back-compat: gates v1 admin surfaces)
  isAdminOnly: boolean // strictly admin (the lead-role pool)
  isHorizontalLead: boolean

  // Project contextual flags
  // Phase 2d: owner retired. isProjectOwner is kept as an alias of
  // isProjectCreator (createdBy ?? legacy ownerId === uid) for back-compat.
  isProjectOwner: boolean
  isProjectCreator: boolean
  // Phase 2d: the user holds at least one project role on this project.
  isAnyRoleHolder: boolean
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
  // Phase 2d: the always-on "operations" capability — edit project fields,
  // reassign roles, create tasks, upload docs. Granted to admins, any project
  // role-holder, and the creator (baseline). Gates the new sidebar edit affordances.
  canEditProjectMeta: boolean

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
  // Phase 2c: prefer the snapshot pinned at creation so workflow edits never
  // change permission resolution on an in-flight project. Falls back to the
  // live lookup for projects that pre-date the pinning migration.
  const workflow = useProjectWorkflow(project)

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      setProjectLoading(false)
      return
    }
    setProjectLoading(true)
    return onSnapshot(tenantDoc('projects', projectId), (snap) => {
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
    return onSnapshot(tenantDoc('teams', teamId), (snap) => {
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
    const q = query(tenantCol('teams'), where('projectIds', 'array-contains', projectId))
    return onSnapshot(q, (snap) => {
      setProjectTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Team))
      setProjectTeamsLoading(false)
    })
  }, [projectId])

  // Phase S3 (sandbox): when the visitor has switched persona via
  // setActAs, permission resolution must run against the *persona's* profile
  // so role-gated UI flips (VH-only buttons hide when acting as Sneha, etc.).
  // In production __IS_SANDBOX__ is false and effectiveProfile === profile —
  // these branches are dead code in production bundles.
  const { effectiveUid, effectiveProfile } = useAuth()
  const resolvedProfile = __IS_SANDBOX__ ? (effectiveProfile ?? profile) : profile

  return useMemo<Permissions>(() => {
    const uid = __IS_SANDBOX__ ? (effectiveUid ?? resolvedProfile?.uid ?? null) : profile?.uid ?? null
    const role = resolvedProfile?.globalRole

    const isSuperAdmin = role === 'super_admin'
    const isAdminOnly = role === 'admin'
    const isAdmin = isSuperAdmin || isAdminOnly
    const isHorizontalLead = role === 'horizontal_lead'

    // Phase 2d owner retirement: the creator (createdBy, legacy ownerId fallback)
    // is the baseline-capability holder. isProjectOwner aliases it for back-compat.
    const creatorUid = project ? (project.createdBy ?? project.ownerId ?? null) : null
    const isProjectCreator = Boolean(uid && creatorUid && creatorUid === uid)
    const isProjectOwner = isProjectCreator
    const roleValues = project?.roleAssignments ? Object.values(project.roleAssignments) : []
    const isAnyRoleHolder = Boolean(
      uid && roleValues.some((v) => (Array.isArray(v) ? v.includes(uid) : v === uid)),
    )
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

    // Phase 2d: the always-on operations capability. Admins, any project
    // role-holder, and the creator (baseline) may edit fields, reassign roles,
    // create tasks, and upload docs — at any stage, never author-configurable.
    const canEditProjectMeta = Boolean(
      project && !closed && (isAdmin || isAnyRoleHolder || isProjectCreator),
    )

    // Status-update is orthogonal to the workflow engine: the status pill opens
    // a modal that calls updateProjectStatus directly. Phase 2d routes the gate
    // through the evaluator's canUpdateProjectStatus, which prefers the
    // workflow's author-configured canUpdateStatusActors and falls back to the
    // legacy flow-type rule + the creator baseline. While the workflow is still
    // lazy-loading, fall back to the safe creator/admin superset.
    const canUpdateStatusResolved =
      project && resolvedProfile && workflow
        ? canUpdateProjectStatus(project, workflow, resolvedProfile, projectTeams, org)
        : isProjectCreator || isAdmin
    const canUpdateStatus = Boolean(project && !closed && canUpdateStatusResolved)
    const canEditProject = Boolean(
      project && (isSuperAdmin || isAnyRoleHolder || isProjectCreator) && !closed,
    )

    const userTeamIds = resolvedProfile?.teamIds ?? []
    const isProjectTeamMember = Boolean(
      uid && project && project.teamIds.some((tid) => userTeamIds.includes(tid)),
    )
    const canViewProjectChat = Boolean(
      project && (isSuperAdmin || isProjectCreator || isAnyRoleHolder || isProjectTeamMember),
    )

    // Generic action gate. Reads the active workflow + evaluator. False when:
    //   - no project loaded yet
    //   - no profile (signed out)
    //   - workflow not loaded yet (e.g. fresh tab before cache populates)
    //   - project is closed
    //   - the workflow's permission check rejects this user for this action
    function canPerform(actionId: string): boolean {
      if (!project || !resolvedProfile || !workflow || closed) return false
      try {
        return evaluatorCanPerform(project, workflow, resolvedProfile, projectTeams, org, actionId)
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
      isProjectCreator,
      isAnyRoleHolder,
      isProjectLead,
      isTeamLead,
      isTeamMember,
      isValidatorLead,
      isCoordinatorLead,
      isValidatorMember,
      canPerform,
      canUpdateStatus,
      canEditProject,
      canEditProjectMeta,
      canViewProjectChat,
      project,
      team,
      loading: projectLoading || teamLoading || projectTeamsLoading,
    }
  }, [profile, resolvedProfile, org, workflow, project, team, projectTeams, projectLoading, teamLoading, projectTeamsLoading])
}
