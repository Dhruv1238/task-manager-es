import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAccessibleProjects } from './useAccessibleProjects'
import { useAllTeams } from './useAllTeams'
import { isProjectClosed } from '../lib/projectStatus'
import type { Project, Team } from '../types/models'

export interface ActionableProject {
  project: Project
  reason:
    | 'allocate-vh'
    | 'accept-or-escalate'
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
  const { projects, loading: pLoading } = useAccessibleProjects()
  const { teams, loading: tLoading } = useAllTeams()

  const result = useMemo<ActionableProject[]>(() => {
    if (!profile) return []
    const isSuperAdmin = profile.globalRole === 'super_admin'

    function csLeadOf(p: Project): string | null {
      const projectTeams: Team[] = teams.filter((t) => p.teamIds?.includes(t.id))
      const cs = projectTeams.find((t) => /client servicing|^cs\b/i.test(t.name))
      return cs?.leadId ?? null
    }

    const out: ActionableProject[] = []
    for (const p of projects) {
      if (isProjectClosed(p.status)) continue
      const stage = p.stage
      if (!stage) continue

      if (stage === 1 && isSuperAdmin) {
        out.push({ project: p, reason: 'allocate-vh', cta: 'Allocate to VH' })
        continue
      }
      if (stage === 2 && p.vhId === profile.uid) {
        out.push({ project: p, reason: 'accept-or-escalate', cta: 'Accept or Escalate' })
        continue
      }
      if (stage === 6 && p.vhId === profile.uid) {
        out.push({ project: p, reason: 'add-tasks', cta: 'Add tasks for teams' })
        continue
      }
      // CS lead validates and signs off at stage 7 (was CT in early spec).
      if (stage === 7 && csLeadOf(p) === profile.uid) {
        out.push({ project: p, reason: 'sign-off-validation', cta: 'Sign off — ready for VH review' })
        continue
      }
      if (stage === 8 && p.vhId === profile.uid) {
        out.push({ project: p, reason: 'vh-review', cta: 'Approve or Reject' })
        continue
      }
      if (stage === 10 && csLeadOf(p) === profile.uid) {
        out.push({ project: p, reason: 'update-status', cta: 'Update status' })
        continue
      }
    }
    return out
  }, [profile, projects, teams])

  return { projects: result, loading: pLoading || tLoading }
}
