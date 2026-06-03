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
import type { Project } from '../types/models'
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

// Projects where the workflow is blocked on the current user. Client-side
// filter — Firestore can't OR across fields cleanly, and the data is small.
// Iterates accessible projects, asks the evaluator which actions are open for
// the viewer at each project's current stage on its OWN workflow (not "the
// active one" — Phase 2b allows multiple workflows to coexist).
export function useProjectsAwaitingMyAction(): {
  projects: ActionableProject[]
  loading: boolean
} {
  const { profile } = useAuth()
  const org = useOrgStructure()
  const { workflowsById, ensureWorkflow } = useAppConfigContext()
  const { projects, loading: pLoading } = useAccessibleProjects()
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
