import { useEffect, useState } from 'react'
import { getDoc } from 'firebase/firestore'
import { tenantDoc } from '../lib/firestore'
import type { Task, TaskKind } from '../types/models'
import { effectiveKind } from '../lib/taskKind'

export interface Ancestor {
  id: string
  title: string
  kind: TaskKind
}

// Walks parentTaskId up to the root for the breadcrumb on a task detail view.
// One getDoc per level, hard-capped at 3 hops (a 4-level tree has ≤3 ancestors)
// with a visited-set cycle guard. Not a live subscription — titles are
// immutable, so a one-shot read per open is enough. Returns root-first.
export function useAncestorChain(task: Pick<Task, 'parentTaskId'> | null | undefined): Ancestor[] {
  const [chain, setChain] = useState<Ancestor[]>([])
  const parentTaskId = task?.parentTaskId ?? null

  useEffect(() => {
    if (!parentTaskId) {
      setChain([])
      return
    }
    let cancelled = false
    const walk = async () => {
      const acc: Ancestor[] = []
      const visited = new Set<string>()
      let currentId: string | null = parentTaskId
      let hops = 0
      while (currentId && hops < 3 && !visited.has(currentId)) {
        visited.add(currentId)
        hops += 1
        const snap = await getDoc(tenantDoc('tasks', currentId))
        if (!snap.exists()) break
        const data = snap.data() as Task
        acc.push({
          id: currentId,
          title: data.title,
          kind: effectiveKind(data),
        })
        currentId = data.parentTaskId ?? null
      }
      if (!cancelled) setChain(acc.reverse()) // root-first
    }
    void walk()
    return () => {
      cancelled = true
    }
  }, [parentTaskId])

  return chain
}
