import { useNavigate, useParams } from 'react-router-dom'
import Modal from '../ui/Modal'
import { useTask } from '../../hooks/useTask'
import TaskDetailContent from './TaskDetailContent'

// Rendered only when a backgroundLocation is set on the current route (see App.tsx).
// Closing pops one history entry so the user returns to the underlying page.
export default function TaskDetailModal() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { task, loading } = useTask(taskId)

  return (
    <Modal
      open
      onClose={() => navigate(-1)}
      title={task?.title ?? (loading ? 'Loading task…' : 'Task')}
      size="xl"
    >
      {task ? (
        // key by task id so per-task state (duplicating flag, approve error,
        // etc.) resets when navigating between tasks in-place — this modal is a
        // single persistent overlay route, so without a key React would reuse
        // the instance and carry stale state (e.g. a stuck "Duplicating…").
        <TaskDetailContent key={task.id} task={task} />
      ) : loading ? (
        <div className="py-10 text-center text-sm text-fg-subtle">Loading task…</div>
      ) : (
        <div className="py-10 text-center text-sm text-fg-subtle">
          Task not found. It may have been deleted.
        </div>
      )}
    </Modal>
  )
}