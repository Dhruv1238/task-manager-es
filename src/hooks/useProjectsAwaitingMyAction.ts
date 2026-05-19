import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useOrgStructure } from '../contexts/AppConfigContext'
import { useAccessibleProjects } from './useAccessibleProjects'
import { useAllTeams } from './useAllTeams'
import { isProjectClosed } from '../lib/projectStatus'
import { resolveCoordinatorTeam, resolveValidatorTeam } from '../lib/orgResolver'
import type { Project, Team } from '../types/models'

export interface ActionableProject {
  project: Project
  reason:
    | 'allocate-vh'
    | 'accept-or-escalate'
    | 'review-eligibility'
    | 'add-tasks'
    | 'sign-off-validation'
    | 'vh-review'
    | 'update-status'
  cta: string
}

// Projects where the workflow is blocked on the current user.
// Client-side filter — Firestore can't OR across fields cleanly. Small data, fast.
export function useProjectsAwaitingMyAction(): {
  projects: ActionableProject[]
  loading: boolean
} {
  const { profile } = useAuth()
  const org = useOrgStructure()
  const { projects, loading: pLoading } = useAccessibleProjects()
  const { teams, loading: tLoading } = useAllTeams()

  const result = useMemo<ActionableProject[]>(() => {
    if (!profile) return []
    const isSuperAdmin = profile.globalRole === 'super_admin'

    function validatorLeadOf(p: Project): string | null {
      const projectTeams: Team[] = teams.filter((t) => p.teamIds?.includes(t.id))
      return resolveValidatorTeam(projectTeams, org)?.leadId ?? null
    }

    function coordinatorLeadOf(p: Project): string | null {
      const projectTeams: Team[] = teams.filter((t) => p.teamIds?.includes(t.id))
      return resolveCoordinatorTeam(projectTeams, org)?.leadId ?? null
    }

    const out: ActionableProject[] = []
    for (const p of projects) {
      if (isProjectClosed(p.status)) continue
      const stage = p.stage
      if (!stage) continue

      if (stage === 1 && isSuperAdmin) {
        const wasEscalated = (p.escalationCount ?? 0) > 0
        out.push({
          project: p,
          reason: 'allocate-vh',
          cta: wasEscalated ? 'Re-allocate after escalation' : `Allocate to ${org.leadRoleName}`,
        })
        continue
      }
      if (stage === 2 && p.vhId === profile.uid) {
        out.push({ project: p, reason: 'accept-or-escalate', cta: 'Accept or Escalate' })
        continue
      }
      // Super admin checkpoint after VH accepts (stage 5).
      if (stage === 5 && isSuperAdmin) {
        out.push({ project: p, reason: 'review-eligibility', cta: 'Review eligibility' })
        continue
      }
      if (stage === 6 && p.vhId === profile.uid) {
        out.push({ project: p, reason: 'add-tasks', cta: 'Add tasks for teams' })
        continue
      }
      // Validator team's lead signs off at stage 7. Skipped when the tenant
      // has no validator role configured (resolver returns null).
      if (stage === 7 && validatorLeadOf(p) === profile.uid) {
        out.push({
          project: p,
          reason: 'sign-off-validation',
          cta: `Sign off — ready for ${org.leadRoleName} review`,
        })
        continue
      }
      if (stage === 8 && p.vhId === profile.uid) {
        out.push({ project: p, reason: 'vh-review', cta: 'Approve or Reject' })
        continue
      }
      if (stage === 10 && coordinatorLeadOf(p) === profile.uid) {
        out.push({ project: p, reason: 'update-status', cta: 'Update status' })
        continue
      }
    }
    return out
  }, [profile, org, projects, teams])

  return { projects: result, loading: pLoading || tLoading }
}
