import { useEffect, useState } from 'react'
import { onSnapshot, orderBy, query } from 'firebase/firestore'
import { Plus, Circle, CircleDot, CheckCircle2, Trash2 } from 'lucide-react'
import { tenantCol, addSubtaskItem, updateSubtaskItem, deleteSubtaskItem } from '../../lib/firestore'
import { useAuth } from '../../contexts/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import type { Subtask } from '../../types/v2'

interface Props {
  projectId: string
}

const STATUS_ORDER: Subtask['status'][] = ['todo', 'in_progress', 'done']
const STATUS_ICON = { todo: Circle, in_progress: CircleDot, done: CheckCircle2 } as const
const STATUS_TONE = {
  todo: 'text-fg-subtle',
  in_progress: 'text-tone-warn-fg',
  done: 'text-tone-success-fg',
} as const

// Phase 3: a simple work-item list under a project. Assignee + status + due date;
// no nested tasks, no per-subtask actions/rules.
export default function SubtasksPanel({ projectId }: Props) {
  const { effectiveUid, user } = useAuth()
  const perms = usePermissions(projectId)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [adding, setAdding] = useState('')
  const canEdit = perms.canEditProjectMeta

  useEffect(() => {
    const q = query(tenantCol('projects', projectId, 'subtasks'), orderBy('createdAt', 'asc'))
    return onSnapshot(q, (snap) => {
      setSubtasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subtask))
    })
  }, [projectId])

  async function add() {
    const title = adding.trim()
    if (!title) return
    setAdding('')
    await addSubtaskItem({
      projectId,
      title,
      createdBy: (__IS_SANDBOX__ ? effectiveUid : user?.uid) ?? user?.uid ?? '',
    })
  }

  function cycleStatus(st: Subtask) {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(st.status) + 1) % STATUS_ORDER.length]
    void updateSubtaskItem(projectId, st.id, { status: next })
  }

  const doneCount = subtasks.filter((s) => s.status === 'done').length

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">
          Subtasks
          {subtasks.length > 0 && (
            <span className="ml-2 text-xs font-normal text-fg-subtle">
              {doneCount}/{subtasks.length} done
            </span>
          )}
        </h3>
      </div>

      <ul className="space-y-1.5">
        {subtasks.map((st) => {
          const Icon = STATUS_ICON[st.status]
          return (
            <li
              key={st.id}
              className="group flex items-center gap-2.5 rounded-lg border border-line bg-fill-1 px-3 py-2"
            >
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => cycleStatus(st)}
                title={st.status.replace('_', ' ')}
                className={`shrink-0 transition ${STATUS_TONE[st.status]} ${canEdit ? 'hover:opacity-80' : ''}`}
              >
                <Icon size={16} />
              </button>
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  st.status === 'done' ? 'text-fg-subtle line-through' : 'text-fg'
                }`}
              >
                {st.title}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void deleteSubtaskItem(projectId, st.id)}
                  className="shrink-0 rounded p-1 text-fg-faint opacity-0 transition hover:text-tone-danger-fg group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          )
        })}
        {subtasks.length === 0 && (
          <li className="rounded-lg border border-dashed border-line bg-fill-1 px-3 py-4 text-center text-xs text-fg-subtle">
            No subtasks yet.
          </li>
        )}
      </ul>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
          className="mt-2 flex items-center gap-2"
        >
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Add a subtask…"
            className="flex-1 rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
          />
          <button
            type="submit"
            disabled={!adding.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-3 py-2 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient disabled:opacity-50"
          >
            <Plus size={15} />
          </button>
        </form>
      )}
    </section>
  )
}
