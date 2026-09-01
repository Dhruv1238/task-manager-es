import type { TaskKind, TaskPriority, TaskStatus } from '../../types/models'
import { TECH_STATUSES } from '../../lib/taskStatus'
import { EMPTY_FILTERS, type TaskFilterState } from './TaskFilters'

// Board filters persist per project (and per team workspace) in localStorage,
// mirroring the Projects.tsx viewMode pattern. Keys:
//   boardFilters:{projectId}                — ProjectBoard
//   teamBoardFilters:{projectId}:{teamId}   — TeamOnProject
// Per-project keys on purpose: filters encode a project's people/teams, and a
// shared key would carry a stale assigneeId into other projects and silently
// blank their boards.

// Flag-INDEPENDENT whitelist: the full 9-id union (TECH_STATUSES is the
// superset of both sets), so a saved filter survives techTaskStatuses flips
// without dropping tech-only statuses.
const TASK_STATUSES: readonly TaskStatus[] = TECH_STATUSES
const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high']
const TASK_KINDS: readonly TaskKind[] = ['epic', 'story', 'task', 'subtask']

interface StoredTaskFilters {
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  kinds: TaskKind[]
  assigneeId: string | null
  teamId: string | null
}

// Keys stay unversioned: widening the status whitelist is backward compatible
// (pre-existing payloads hold only the 5 legacy ids, all still valid), and
// these filters have no server copy — bumping the key would silently reset
// every user's saved filters instead of migrating them.
export function boardFiltersKey(projectId: string): string {
  return `boardFilters:${projectId}`
}

export function teamBoardFiltersKey(projectId: string, teamId: string): string {
  return `teamBoardFilters:${projectId}:${teamId}`
}

// Sets don't survive JSON; store arrays and rehydrate, dropping any value that
// isn't a known enum member (corrupt/legacy payloads degrade to EMPTY_FILTERS).
export function readStoredFilters(key: string): TaskFilterState {
  if (typeof window === 'undefined') return EMPTY_FILTERS
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return EMPTY_FILTERS
    const parsed = JSON.parse(raw) as Partial<StoredTaskFilters> | null
    if (!parsed || typeof parsed !== 'object') return EMPTY_FILTERS
    const statuses = Array.isArray(parsed.statuses)
      ? parsed.statuses.filter((s): s is TaskStatus => TASK_STATUSES.includes(s as TaskStatus))
      : []
    const priorities = Array.isArray(parsed.priorities)
      ? parsed.priorities.filter((p): p is TaskPriority => TASK_PRIORITIES.includes(p as TaskPriority))
      : []
    const kinds = Array.isArray(parsed.kinds)
      ? parsed.kinds.filter((k): k is TaskKind => TASK_KINDS.includes(k as TaskKind))
      : []
    return {
      statuses: new Set(statuses),
      priorities: new Set(priorities),
      kinds: new Set(kinds),
      assigneeId: typeof parsed.assigneeId === 'string' ? parsed.assigneeId : null,
      teamId: typeof parsed.teamId === 'string' ? parsed.teamId : null,
    }
  } catch {
    return EMPTY_FILTERS
  }
}

export function writeStoredFilters(key: string, filters: TaskFilterState): void {
  if (typeof window === 'undefined') return
  try {
    const payload: StoredTaskFilters = {
      statuses: Array.from(filters.statuses),
      priorities: Array.from(filters.priorities),
      kinds: Array.from(filters.kinds),
      assigneeId: filters.assigneeId,
      teamId: filters.teamId,
    }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // ignore quota / private-mode errors
  }
}
