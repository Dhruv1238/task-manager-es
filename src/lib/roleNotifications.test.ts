import { describe, expect, it } from 'vitest'
import type { WriteBatch } from 'firebase/firestore'
import {
  leadRoleLabel,
  projectRoleLabel,
  queueRoleAssignmentNotifications,
} from './firestore'
import type { Workflow } from '../types/workflow'

// queueRoleAssignmentNotifications only ever calls batch.set(ref, data), so a
// recorder that captures the payloads is enough to assert the fan-out contract.
function recorder() {
  const writes: Record<string, unknown>[] = []
  const batch = {
    set: (_ref: unknown, data: Record<string, unknown>) => {
      writes.push(data)
      return batch
    },
  } as unknown as WriteBatch
  return { batch, writes }
}

const base = {
  roleLabel: 'Admin Head',
  projectId: 'p1',
  projectTitle: 'Tender ABC',
  actorId: 'actor',
  actorName: 'Dhruv',
}

describe('queueRoleAssignmentNotifications', () => {
  it('writes one project-scoped notification per recipient', () => {
    const { batch, writes } = recorder()
    queueRoleAssignmentNotifications(batch, { ...base, recipientIds: ['ah1'] })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      recipientId: 'ah1',
      type: 'role_assignment',
      actorId: 'actor',
      actorName: 'Dhruv',
      projectId: 'p1',
      // The subject is the PROJECT, and the role rides in snippet.
      taskTitle: 'Tender ABC',
      snippet: 'Admin Head',
      resolved: false,
    })
    // No taskId key at all — Firestore rejects an explicit undefined, and the
    // bell keys its project-vs-task routing off its absence.
    expect('taskId' in writes[0]).toBe(false)
  })

  it('never notifies the actor about their own assignment', () => {
    const { batch, writes } = recorder()
    queueRoleAssignmentNotifications(batch, { ...base, recipientIds: ['actor'] })
    expect(writes).toHaveLength(0)
  })

  it('drops the actor but keeps everyone else', () => {
    const { batch, writes } = recorder()
    queueRoleAssignmentNotifications(batch, { ...base, recipientIds: ['a', 'actor', 'b'] })
    expect(writes.map((w) => w.recipientId)).toEqual(['a', 'b'])
  })

  it('collapses duplicates and ignores empty entries', () => {
    const { batch, writes } = recorder()
    queueRoleAssignmentNotifications(batch, {
      ...base,
      recipientIds: ['a', 'a', null, undefined, ''],
    })
    expect(writes.map((w) => w.recipientId)).toEqual(['a'])
  })

  it('writes nothing for an empty recipient list', () => {
    const { batch, writes } = recorder()
    queueRoleAssignmentNotifications(batch, { ...base, recipientIds: [] })
    expect(writes).toHaveLength(0)
  })
})

describe('label resolution', () => {
  const wf = {
    id: 'w',
    leadRoleName: 'Vertical Head',
    projectRoles: [
      { id: 'admin_head', label: 'Admin Head', multiple: false, required: false, order: 0 },
      { id: 'functional_head', label: 'Functional Head', multiple: true, required: false, order: 1 },
    ],
  } as unknown as Workflow

  it('resolves project-role labels', () => {
    expect(projectRoleLabel(wf, 'admin_head')).toBe('Admin Head')
    expect(projectRoleLabel(wf, 'functional_head')).toBe('Functional Head')
  })

  it('falls back to the raw id for an unknown role', () => {
    // A role deleted from the workflow after assignment must still name itself.
    expect(projectRoleLabel(wf, 'gone')).toBe('gone')
    expect(projectRoleLabel(undefined, 'gone')).toBe('gone')
  })

  it('prefers the per-workflow lead label', () => {
    expect(leadRoleLabel(wf)).toBe('Vertical Head')
  })

  it('never returns an empty lead label', () => {
    // '' means "inherit" (basic flow) — must resolve to org-wide or the literal,
    // never to a blank notification.
    expect(leadRoleLabel({ ...wf, leadRoleName: '' } as Workflow)).toBeTruthy()
    expect(leadRoleLabel(undefined)).toBeTruthy()
  })
})
