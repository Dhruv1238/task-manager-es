import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { unlinkTasks } from '../../lib/firestore'
import { relationLabel, relationStyle } from '../../lib/taskLinks'
import LinkTaskModal from './LinkTaskModal'
import type { Task } from '../../types/models'

interface Props {
  task: Task
  canEdit: boolean
}

// Advisory only — chips describe the relationship, they never gate status.
// Rows render join-free from the denormalized link data, so a link to a deleted
// task simply lands on the modal's existing "Task not found" state.
export default function LinkedTasksSection({ task, canEdit }: Props) {
  const { user, profile } = useAuth()
  const location = useLocation()
  const [modalOpen, setModalOpen] = useState(false)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  const links = task.links ?? []
  const backgroundLocation =
    (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation ??
    location

  async function handleUnlink(targetTaskId: string) {
    if (!user || unlinkingId) return
    setUnlinkingId(targetTaskId)
    try {
      await unlinkTasks({
        sourceTaskId: task.id,
        targetTaskId,
        projectId: task.projectId,
        actorId: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
      })
    } finally {
      setUnlinkingId(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
          Linked tasks {links.length > 0 && <span className="text-fg-muted">({links.length})</span>}
        </h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-fill-2 px-3 py-1.5 text-xs font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Link task
          </button>
        )}
      </div>

      {links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center">
          <p className="text-sm text-fg-subtle">
            No linked tasks.{' '}
            {canEdit ? 'Relate this to other tasks on the project.' : ''}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card divide-y divide-line-subtle">
          {links.map((l) => (
            <div key={l.taskId} className="flex items-center gap-2 px-3 py-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${relationStyle(l.relation)}`}
              >
                {relationLabel(l.relation)}
              </span>
              <Link
                to={`/tasks/${l.taskId}`}
                state={{ backgroundLocation }}
                className="min-w-0 flex-1 truncate text-sm text-fg hover:underline"
              >
                {l.title}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void handleUnlink(l.taskId)}
                  disabled={unlinkingId !== null}
                  className="shrink-0 rounded-md border border-line bg-fill-2 px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-fill-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {unlinkingId === l.taskId ? 'Removing…' : 'Unlink'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <LinkTaskModal open={modalOpen} onClose={() => setModalOpen(false)} task={task} />
    </div>
  )
}
