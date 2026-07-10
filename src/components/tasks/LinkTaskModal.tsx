import { useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import Modal from '../ui/Modal'
import SearchInput from '../ui/SearchInput'
import { useAuth } from '../../contexts/AuthContext'
import { useAllProjectTasks } from '../../hooks/useAllProjectTasks'
import { linkTasks } from '../../lib/firestore'
import { RELATION_OPTIONS } from '../../lib/taskLinks'
import { KIND_STYLES, effectiveKind } from '../../lib/taskKind'
import type { Task, TaskLinkRelation } from '../../types/models'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
}

function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

// Same-project link picker: client-filters the bounded useAllProjectTasks set,
// excluding self and already-linked tasks.
export default function LinkTaskModal({ open, onClose, task }: Props) {
  const { user, profile } = useAuth()
  const { tasks } = useAllProjectTasks(open ? task.projectId : undefined)
  const [search, setSearch] = useState('')
  const [relation, setRelation] = useState<TaskLinkRelation>('relates_to')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const linkedIds = useMemo(
    () => new Set((task.links ?? []).map((l) => l.taskId)),
    [task.links],
  )

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks
      .filter((t) => t.id !== task.id && !linkedIds.has(t.id))
      .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
      .slice(0, 50)
  }, [tasks, task.id, linkedIds, search])

  async function handleLink(target: Task) {
    if (!user || submittingId) return
    setSubmittingId(target.id)
    setError(null)
    try {
      await linkTasks({
        sourceTaskId: task.id,
        sourceTitle: task.title,
        targetTaskId: target.id,
        targetTitle: target.title,
        relation,
        projectId: task.projectId,
        actorId: user.uid,
        actorName: profile?.displayName ?? user.email ?? 'User',
      })
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Link a task" size="lg">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-fg-muted">Relationship</label>
          <div className="flex flex-wrap gap-2">
            {RELATION_OPTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRelation(r.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  relation === r.value
                    ? 'border-brand-edge bg-brand-soft text-fg'
                    : 'border-line bg-fill-2 text-fg-muted hover:bg-fill-4'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search tasks on this project"
          infoText="Only tasks on this project can be linked."
        />

        {error && (
          <div role="alert" className="rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg">
            {error}
          </div>
        )}

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-card p-6 text-center text-sm text-fg-subtle">
              No matching tasks.
            </div>
          ) : (
            candidates.map((t) => {
              const kind = effectiveKind(t)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void handleLink(t)}
                  disabled={submittingId !== null}
                  className="flex w-full items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-left transition hover:border-line-strong hover:bg-fill-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${KIND_STYLES[kind].cls}`}
                  >
                    {KIND_STYLES[kind].label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{t.title}</span>
                  {submittingId === t.id && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </Modal>
  )
}
