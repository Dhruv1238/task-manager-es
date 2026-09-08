import { describe, it, expect } from 'vitest'
import type { Timestamp } from 'firebase/firestore'
import type { Task } from '../types/models'
import {
  groupByProjectTeam,
  isOverdueTask,
  mergeUniqueById,
  tasksByProject,
} from './myTasksDerive'

// Minimal Timestamp stand-in — these derivations only ever call toDate().
function stamp(ms: number): Timestamp {
  return { toDate: () => new Date(ms) } as unknown as Timestamp
}

const NOW = Date.parse('2026-09-03T12:00:00Z')
const DAY = 86_400_000

let seq = 0
function task(over: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    projectId: 'p1',
    teamId: 'team1',
    parentTaskId: null,
    title: `Task ${seq}`,
    description: '',
    assigneeId: 'u1',
    status: 'todo',
    priority: 'medium',
    attachments: [],
    createdBy: 'u1',
    createdAt: stamp(NOW),
    updatedAt: stamp(NOW),
    ...over,
  }
}

describe('groupByProjectTeam', () => {
  it('buckets tasks by project then team, keeping first-seen order', () => {
    const groups = groupByProjectTeam([
      task({ id: 'a', projectId: 'p2', projectTitle: 'Gala', teamId: 'build', teamName: 'Build' }),
      task({ id: 'b', projectId: 'p1', projectTitle: 'Expo', teamId: 'design', teamName: 'Design' }),
      task({ id: 'c', projectId: 'p2', projectTitle: 'Gala', teamId: 'av', teamName: 'AV' }),
      task({ id: 'd', projectId: 'p2', projectTitle: 'Gala', teamId: 'build', teamName: 'Build' }),
    ])

    expect(groups.map((g) => g.projectId)).toEqual(['p2', 'p1'])
    const gala = groups[0]
    expect([...gala.teams.keys()]).toEqual(['build', 'av'])
    expect(gala.teams.get('build')!.tasks.map((t) => t.id)).toEqual(['a', 'd'])
    expect(gala.teams.get('av')!.tasks.map((t) => t.id)).toEqual(['c'])
    expect(groups[1].teams.get('design')!.teamName).toBe('Design')
  })

  it('falls back to placeholders when the denormalized names are missing', () => {
    const [group] = groupByProjectTeam([task({ projectTitle: undefined, teamName: undefined })])
    expect(group.projectTitle).toBe('(Untitled project)')
    expect(group.teams.get('team1')!.teamName).toBe('(Untitled team)')
  })

  it('returns no groups for an empty list', () => {
    expect(groupByProjectTeam([])).toEqual([])
  })
})

describe('mergeUniqueById', () => {
  it('keeps the first occurrence of an id and drops later duplicates', () => {
    const mine = [task({ id: 'x', title: 'assigned view' }), task({ id: 'y' })]
    const led = [task({ id: 'x', title: 'led view' }), task({ id: 'z' })]

    const merged = mergeUniqueById(mine, led)
    expect(merged.map((t) => t.id)).toEqual(['x', 'y', 'z'])
    expect(merged[0].title).toBe('assigned view')
  })

  it('de-duplicates within a single list and tolerates empty input', () => {
    const dup = task({ id: 'x' })
    expect(mergeUniqueById([dup, dup]).map((t) => t.id)).toEqual(['x'])
    expect(mergeUniqueById()).toEqual([])
    expect(mergeUniqueById([], [])).toEqual([])
  })
})

describe('isOverdueTask', () => {
  it('is true for an open task past its due date', () => {
    expect(isOverdueTask(task({ dueDate: stamp(NOW - DAY) }), NOW)).toBe(true)
  })

  it('is false for a future due date', () => {
    expect(isOverdueTask(task({ dueDate: stamp(NOW + DAY) }), NOW)).toBe(false)
  })

  it('is false without a due date', () => {
    expect(isOverdueTask(task(), NOW)).toBe(false)
  })

  it('is false for terminal tasks however late they landed', () => {
    expect(isOverdueTask(task({ status: 'done', dueDate: stamp(NOW - DAY) }), NOW)).toBe(false)
    expect(isOverdueTask(task({ status: 'cancelled', dueDate: stamp(NOW - DAY) }), NOW)).toBe(false)
  })

  it('defaults the clock to now', () => {
    expect(isOverdueTask(task({ dueDate: stamp(Date.now() - DAY) }))).toBe(true)
    expect(isOverdueTask(task({ dueDate: stamp(Date.now() + DAY) }))).toBe(false)
  })
})

describe('tasksByProject', () => {
  it('excludes terminal tasks and carries the rows behind each count', () => {
    const rows = tasksByProject([
      task({ id: 'a', projectId: 'p1', projectTitle: 'Expo' }),
      task({ id: 'b', projectId: 'p1', projectTitle: 'Expo', status: 'done' }),
      task({ id: 'c', projectId: 'p1', projectTitle: 'Expo', status: 'cancelled' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('drops a project entirely once all its work is terminal', () => {
    const rows = tasksByProject([task({ projectId: 'p9', status: 'done' })])
    expect(rows).toEqual([])
  })

  it('sorts by open count descending, ties broken by project title', () => {
    const rows = tasksByProject([
      task({ projectId: 'p1', projectTitle: 'Zebra' }),
      task({ projectId: 'p2', projectTitle: 'Expo' }),
      task({ projectId: 'p2', projectTitle: 'Expo' }),
      task({ projectId: 'p2', projectTitle: 'Expo' }),
      task({ projectId: 'p3', projectTitle: 'Apex' }),
    ])

    expect(rows.map((r) => [r.projectTitle, r.tasks.length])).toEqual([
      ['Expo', 3],
      ['Apex', 1],
      ['Zebra', 1],
    ])
  })

  it('caps the result at the limit, keeping the biggest piles', () => {
    const many = ['p1', 'p2', 'p3', 'p4'].flatMap((projectId, i) =>
      Array.from({ length: 4 - i }, () => task({ projectId, projectTitle: projectId })),
    )

    expect(tasksByProject(many, { limit: 2 }).map((r) => r.projectId)).toEqual(['p1', 'p2'])
    expect(tasksByProject(many).map((r) => r.projectId)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('falls back to the untitled label when projectTitle is missing', () => {
    const rows = tasksByProject([task({ projectTitle: undefined })])
    expect(rows[0].projectTitle).toBe('(Untitled project)')
  })

  it('returns no rows for an empty list', () => {
    expect(tasksByProject([])).toEqual([])
  })

  describe('with includeCompleted (the "Show completed" toggle)', () => {
    it('counts finished work alongside open work', () => {
      const rows = tasksByProject(
        [
          task({ id: 'a', projectId: 'p1', projectTitle: 'Expo' }),
          task({ id: 'b', projectId: 'p1', projectTitle: 'Expo', status: 'done' }),
          task({ id: 'c', projectId: 'p1', projectTitle: 'Expo', status: 'cancelled' }),
        ],
        { includeCompleted: true },
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].tasks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    })

    it('keeps a fully finished project, which the open-only view drops', () => {
      const done = [task({ projectId: 'p9', projectTitle: 'Wrapped', status: 'done' })]

      expect(tasksByProject(done)).toEqual([])
      expect(tasksByProject(done, { includeCompleted: true }).map((r) => r.projectTitle)).toEqual([
        'Wrapped',
      ])
    })

    it('still honours the limit', () => {
      const many = ['p1', 'p2', 'p3'].flatMap((projectId, i) =>
        Array.from({ length: 3 - i }, () =>
          task({ projectId, projectTitle: projectId, status: 'done' }),
        ),
      )

      expect(
        tasksByProject(many, { limit: 2, includeCompleted: true }).map((r) => r.projectId),
      ).toEqual(['p1', 'p2'])
    })
  })
})
