import { useAllProjects } from '../hooks/useAllProjects'
import { useAllTasks } from '../hooks/useAllTasks'
import { useAllTeams } from '../hooks/useAllTeams'
import { usePipelineEnabled } from '../contexts/AppConfigContext'
import ProjectsByStatus from '../components/charts/ProjectsByStatus'
import TeamUtilization from '../components/charts/TeamUtilization'
import AtRiskProjects from '../components/charts/AtRiskProjects'
import NewVsCompleted from '../components/charts/NewVsCompleted'
import TenderPipelineFunnel from '../components/charts/TenderPipelineFunnel'
import AtRiskBySubmission from '../components/charts/AtRiskBySubmission'

export default function AdminDashboard() {
  const { projects } = useAllProjects()
  const { teams } = useAllTeams()
  const { tasks } = useAllTasks()
  const pipelineEnabled = usePipelineEnabled()

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm text-fg-subtle">Admin</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
          Global analytics
        </h1>
        <p className="mt-2 max-w-2xl text-fg-muted">
          {pipelineEnabled
            ? 'Org-wide health: tender pipeline, at-risk submissions, team load, and throughput.'
            : 'Org-wide health: project status, team load, and throughput.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {pipelineEnabled && <TenderPipelineFunnel projects={projects} />}
        {pipelineEnabled && <AtRiskBySubmission projects={projects} />}
        <ProjectsByStatus projects={projects} />
        <TeamUtilization teams={teams} tasks={tasks} />
        <div className="lg:col-span-2">
          <AtRiskProjects projects={projects} tasks={tasks} />
        </div>
        <div className="lg:col-span-2">
          <NewVsCompleted tasks={tasks} />
        </div>
      </div>
    </main>
  )
}