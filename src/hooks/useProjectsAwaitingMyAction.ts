import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAppConfigContext, useOrgStructure } from '../contexts/AppConfigContext'
import { useAccessibleProjects } from './useAccessibleProjects'
import { useAllTeams } from './useAllTeams'
import { isProjectClosed } from '../lib/projectStatus'
import {
  getAllowedActions,
  getCurrentStage,
  type RoleResolutionCtx,
} from '../lib/workflowEvaluator'
import { computeEffectivePermissions } from '../lib/permissions/effectivePermissions'
import type { Project, User } from '../types/models'
import type { Workflow } from '../types/workflow'

export interface ActionableProject {
  project: Project
  // The action id from the workflow doc (e.g. 'allocate', 'sign_off').
  reason: string
  cta: string
  // The workflow this project is on — supplied so the row can render a
  // WorkflowBadge without a second context lookup.
  workflow: Workflow
}

// Projects where the workflow is blocked on a given user — defaults to the
// signed-in profile. Client-side filter — Firestore can't OR across fields
// cleanly, and the data is small. Iterates the accessible projects for that same
// user, asks the evaluator which actions are open for them at each project's
// current stage on its OWN workflow (not "the active one" — Phase 2b allows
// multiple workflows to coexist).
//
// `profileOverride` lets an admin surface render one member's inbox at a time
// (the Member Tasks view); everything below is pure in the user argument
// (getAllowedActions, computeEffectivePermissions), so handing it a different
// profile is all that's needed. Omitted = the signed-in profile; an explicit
// `null` = nobody = [], never a fallback to the viewer.
//
// Bug this fixes: /me is written against the sandbox persona lens
// (effectiveProfile), but this hook read the REAL auth profile, so while acting
// as a persona every other section showed the persona and "Projects awaiting my
// action" showed the visitor's own inbox. Me.tsx now passes `lensProfile`.
export function useProjectsAwaitingMyAction(profileOverride?: User | null): {
  projects: ActionableProject[]
  loading: boolean
} {
  const { profile: authProfile } = useAuth()
  const profile = profileOverride === undefined ? authProfile : profileOverride
  const org = useOrgStructure()
  const { workflowsById, ensureWorkflow } = useAppConfigContext()
  const { projects, loading: pLoading } = useAccessibleProjects(profile)
  const { teams, loading: tLoading } = useAllTeams()

  const result = useMemo<ActionableProject[]>(() => {
    if (!profile) return []

    // Phase 3.6: resolve `role`-kind actors for the viewer so hierarchy-gated
    // actions surface in their inbox (same compute usePermissions does).
    const roles = org.roleHierarchy ?? []
    const roleCtx: RoleResolutionCtx = {
      roles,
      effective: computeEffectivePermissions(profile, roles),
    }

    const out: ActionableProject[] = []
    for (const p of projects) {
      if (isProjectClosed(p.status)) continue
      if (!p.workflowId) continue
      const wf = workflowsById[p.workflowId]
      if (!wf) {
        // Workflow doc not in the in-memory map yet. Kick off a lazy fetch so
        // the next render has it. We can't surface this project now — skip
        // and revisit on re-render. ensureWorkflow is idempotent.
        void ensureWorkflow(p.workflowId)
        continue
      }

      const stage = getCurrentStage(p, wf)
      if (stage.isTerminal) continue

      // `mode: 'inbox'` so override actors (alsoAllow) don't surface when
      // the canonical team is attached — the action belongs to the team
      // lead. Permission is still granted; the inbox just doesn't nag.
      const allowed = getAllowedActions(p, wf, profile, teams, org, 'inbox', roleCtx)
      if (!allowed.length) continue

      const action = allowed[0]
      out.push({
        project: p,
        reason: action.id,
        cta: action.label
          .replace(/\{leadRoleName\}/g, wf.leadRoleName || org.leadRoleName)
          .replace(/\{validatorTeamName\}/g, ''),
        workflow: wf,
      })
    }
    return out
  }, [profile, org, projects, teams, workflowsById, ensureWorkflow])

  return { projects: result, loading: pLoading || tLoading }
}
