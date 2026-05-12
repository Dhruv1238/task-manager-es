import { Link, useParams } from 'react-router-dom'
import { useTask } from '../hooks/useTask'
import TaskDetailContent from '../components/tasks/TaskDetailContent'

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const { task, loading } = useTask(taskId)

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-fg-subtle sm:px-6 lg:px-8">
        Loading task…
      </div>
    )
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-fg">Task not found</h1>
        <p className="mt-2 text-fg-subtle">
          It may have been deleted, or you might not have access.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm text-fg-muted transition hover:bg-fill-4"
        >
          Back home
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to={`/projects/${task.projectId}/teams/${task.teamId}`}
        className="inline-flex items-center gap-1 text-sm text-fg-subtle transition hover:text-fg-muted"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Team workspace
      </Link>

      <h1 className="mt-4 mb-8 text-3xl font-semibold tracking-tight text-fg">
        {task.title}
      </h1>

      <TaskDetailContent task={task} />
    </div>
  )
}