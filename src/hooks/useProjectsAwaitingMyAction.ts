import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useActiveWorkflow, useOrgStructure } from '../contexts/AppConfigContext'
import { useAccessibleProjects } from './useAccessibleProjects'
import { useAllTeams } from './useAllTeams'
import { isProjectClosed } from '../lib/projectStatus'
import {
  getAllowedActions,
  getCurrentStage,
} from '../lib/workflowEvaluator'
import { NUMERIC_STAGE_TO_ID } from '../lib/seedCollabWorkflow'
import type { Project } from '../types/models'
import type { Workflow } from '../types/workflow'

export interface ActionableProject {
  project: Project
  // Phase 2a: the action id from the workflow doc (e.g. 'allocate', 'sign_off').
  // Replaces the seven hardcoded reasons.
  reason: string
  cta: string
}

// Projects where the workflow is blocked on the current user. Client-side
// filter — Firestore can't OR across fields cleanly, and the data is small.
// Iterates accessible projects, asks the evaluator which actions are open for
// the viewer at each project's current stage, and surfaces the first one as
// the inbox row.
export function useProjectsAwaitingMyAction(): {
  projects: ActionableProject[]
  loading: boolean
} {
  const { profile } = useAuth()
  const org = useOrgStructure()
  const { workflow } = useActiveWorkflow()
  const { projects, loading: pLoading } = useAccessibleProjects()
  const { teams, loading: tLoading } = useAllTeams()

  const result = useMemo<ActionableProject[]>(() => {
    if (!profile || !workflow) return []

    const out: ActionableProject[] = []
    for (const p of projects) {
      if (isProjectClosed(p.status)) continue

      // Pick the workflow for this project. In Phase 2a there's only one
      // active workflow at a time, so we use the cached active one and skip
      // projects pinned to a different workflow (rare during pipelineEnabled
      // flips after creation).
      const wf = p.workflowId && p.workflowId !== workflow.id ? null : workflow
      if (!wf) continue

      // Back-compat: legacy projects pre-Sprint-2 don't have currentStageId.
      // Derive it from the numeric `stage` so they still appear in the inbox.
      const effective = effectiveProject(p, wf)

      const stage = getCurrentStage(effective, wf)
      if (stage.isTerminal) continue

      // `mode: 'inbox'` so a project that already has its expected team
      // attached doesn't surface to override actors (project lead, owner,
      // super_admin) — only to the team lead the action canonically belongs
      // to. Permission to perform the action is still granted; we just
      // don't nag the override actors via /me.
      const allowed = getAllowedActions(effective, wf, profile, teams, org, 'inbox')
      if (!allowed.length) continue

      const action = allowed[0]
      out.push({
        project: p,
        reason: action.id,
        cta: action.label
          .replace(/\{leadRoleName\}/g, wf.leadRoleName || org.leadRoleName)
          .replace(/\{validatorTeamName\}/g, ''),
      })
    }
    return out
  }, [profile, org, projects, teams, workflow])

  return { projects: result, loading: pLoading || tLoading }
}

// Project view that has currentStageId filled in (deriving from legacy stage
// if necessary). Used during the dual-write transition so the evaluator can
// reason about projects created before Sprint 2.
function effectiveProject(p: Project, wf: Workflow): Project {
  if (p.currentStageId) return p
  if (wf.id === 'collab-default' && p.stage !== undefined) {
    return { ...p, currentStageId: NUMERIC_STAGE_TO_ID[p.stage] ?? wf.stages[0]?.id }
  }
  return { ...p, currentStageId: wf.stages[0]?.id }
}
