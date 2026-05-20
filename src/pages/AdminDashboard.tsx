import { useMemo, useState } from 'react'
import { useAllProjects } from '../hooks/useAllProjects'
import { useAllTasks } from '../hooks/useAllTasks'
import { useAllTeams } from '../hooks/useAllTeams'
import { useActiveWorkflows, useDefaultWorkflow } from '../contexts/AppConfigContext'
import Tabs from '../components/admin/Tabs'
import ProjectsByStatus from '../components/charts/ProjectsByStatus'
import TeamUtilization from '../components/charts/TeamUtilization'
import AtRiskProjects from '../components/charts/AtRiskProjects'
import NewVsCompleted from '../components/charts/NewVsCompleted'
import PipelineFunnel from '../components/charts/PipelineFunnel'
import AtRiskBySubmission from '../components/charts/AtRiskBySubmission'
import { COLLAB_DEFAULT_WORKFLOW_ID } from '../contexts/AppConfigContext'
import { isProjectClosed } from '../lib/projectStatus'

// Phase 2b: dashboard splits into two sections:
//   1. Cross-workflow header strip — panels that aren't workflow-scoped
//      (status mix, team load, throughput, blocked tasks).
//   2. Tabbed per-workflow funnels — one tab per active workflow, each with
//      its own PipelineFunnel; the collab tab also renders the
//      submission-deadline panel (a collab-specific metric).
export default function AdminDashboard() {
  const { projects } = useAllProjects()
  const { teams } = useAllTeams()
  const { tasks } = useAllTasks()
  const { workflows: activeWorkflows } = useActiveWorkflows()
  const defaultWorkflow = useDefaultWorkflow()

  // Tab selection. Defaults to the registry's default workflow, falling back
  // to the first active workflow. Tab state is ephemeral on purpose — it's
  // a viewing preference, not a saved filter.
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () => defaultWorkflow?.id ?? activeWorkflows[0]?.id ?? null,
  )
  const safeActiveId =
    activeWorkflows.find((wf) => wf.id === activeTabId)?.id ??
    activeWorkflows[0]?.id ??
    null
  const activeWorkflow = activeWorkflows.find((wf) => wf.id === safeActiveId) ?? null

  // Per-workflow project counts for the tab badges. Counts only non-terminal
  // projects — the tab badge reads "active project count on this workflow."
  const countsByWorkflow = useMemo(() => {
    const out: Record<string, number> = {}
    for (const wf of activeWorkflows) out[wf.id] = 0
    for (const p of projects) {
      if (!p.workflowId || !(p.workflowId in out)) continue
      if (isProjectClosed(p.status)) continue
      out[p.workflowId] += 1
    }
    return out
  }, [projects, activeWorkflows])

  const tabs = useMemo(
    () =>
      activeWorkflows.map((wf) => ({
        id: wf.id,
        label: wf.displayName,
        badge: countsByWorkflow[wf.id] ?? 0,
      })),
    [activeWorkflows, countsByWorkflow],
  )

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm text-fg-subtle">Admin</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
          Global analytics
        </h1>
        <p className="mt-2 max-w-2xl text-fg-muted">
          Org-wide health: project status, team load, and throughput. Per-workflow pipelines below.
        </p>
      </div>
      {/* Per-workflow tabs. Shown only when at least one workflow is active —
       * a fresh tenant with no seeded workflows skips this whole section. */}
      {activeWorkflows.length > 0 && activeWorkflow && (
        <div className="mb-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              Per-workflow pipelines
            </h2>
            <p className="mt-1 text-sm text-fg-subtle">
              Funnels, bottlenecks, and deadline metrics scoped to each active workflow.
            </p>
          </div>
          <Tabs tabs={tabs} activeId={activeWorkflow.id} onChange={setActiveTabId} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <PipelineFunnel projects={projects} workflow={activeWorkflow} />
            {/* AtRiskBySubmission is collab-specific (uses submissionDate).
             * Other flow types render a soft placeholder explaining no
             * deadline-based metric exists for them yet. */}
            {activeWorkflow.id === COLLAB_DEFAULT_WORKFLOW_ID ? (
              <AtRiskBySubmission projects={projects} workflow={activeWorkflow} />
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-fill-1 p-6 text-sm text-fg-subtle">
                No deadline-based metric for{' '}
                <span className="font-medium text-fg-muted">{activeWorkflow.displayName}</span>{' '}
                yet. (Submission-deadline tracking is collab-specific.)
              </div>
            )}
          </div>
        </div>
      )}
      {/* Cross-workflow strip — always rendered, regardless of workflows set. */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Org-wide health
          </h2>
          <p className="mt-1 text-sm text-fg-subtle">
            Status mix, team load, and throughput across every workflow.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ProjectsByStatus projects={projects} />
          <TeamUtilization teams={teams} tasks={tasks} />
          <div className="lg:col-span-2">
            <AtRiskProjects projects={projects} tasks={tasks} />
          </div>
          <div className="lg:col-span-2">
            <NewVsCompleted tasks={tasks} />
          </div>
        </div>
      </div>
    </main>
  )
}
