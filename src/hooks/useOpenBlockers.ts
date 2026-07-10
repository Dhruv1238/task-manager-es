import { useEffect, useState } from 'react'
import { documentId, onSnapshot, query, where } from 'firebase/firestore'
import { tenantCol } from '../lib/firestore'
import type { Task } from '../types/models'

export interface OpenBlocker {
  id: string
  title: string
}

// Live list of the tasks that BLOCK this one (its `blocked_by` links) and are
// not yet done. Drives the UI completion gate; the write path (setTaskStatus /
// transitionTaskFromReview) enforces it authoritatively. Returns [] when the
// task has no blockers. Fails open (returns []) on query error — the write path
// still guards, so a transient read error never lets the UI hard-lock a task.
export function useOpenBlockers(task: Task | null): OpenBlocker[] {
  const [openBlockers, setOpenBlockers] = useState<OpenBlocker[]>([])

  // Stable primitive dep: the sorted set of blocker ids for this task.
  const key = Array.from(
    new Set((task?.links ?? []).filter((l) => l.relation === 'blocked_by').map((l) => l.taskId)),
  )
    .sort()
    .join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setOpenBlockers([])
      return
    }
    // Firestore `in` allows up to 30 values; a task realistically has a handful.
    const q = query(tenantCol('tasks'), where(documentId(), 'in', ids.slice(0, 30)))
    return onSnapshot(
      q,
      (snap) => {
        setOpenBlockers(
          snap.docs
            .map((d) => ({ ...(d.data() as Task), id: d.id }))
            .filter((t) => t.status !== 'done')
            .map((t) => ({ id: t.id, title: t.title })),
        )
      },
      () => setOpenBlockers([]),
    )
  }, [key])

  return openBlockers
}
