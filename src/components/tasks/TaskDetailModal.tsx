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
        <TaskDetailContent task={task} />
      ) : loading ? (
        <div className="py-10 text-center text-sm text-white/40">Loading task…</div>
      ) : (
        <div className="py-10 text-center text-sm text-white/40">
          Task not found. It may have been deleted.
        </div>
      )}
    </Modal>
  )
}