import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  findAssignGates,
  findEntryLeadGate,
  planCreationAllocation,
} from './creationAllocation'
import { resolveEntryStage } from './workflowEvaluator'
import type { Stage, Workflow } from '../types/workflow'

const base = {
  isSystemDefined: false,
  version: 1,
  updatedAt: Timestamp.now(),
  updatedBy: 'u',
} as const

function wf(partial: Partial<Workflow> & { stages: Stage[] }): Workflow {
  return {
    id: 'w',
    displayName: 'W',
    flowType: 'collaborative',
    leadRoleName: 'Vertical Head',
    ...base,
    ...partial,
  } as Workflow
}

const leadPicker = {
  id: 'leadUid',
  label: 'Choose lead',
  type: 'user_picker' as const,
  required: true,
  pickerScope: 'global_role:admin',
}

describe('legacy assign_lead (the seeds)', () => {
  const collabLike = wf({
    stages: [
      {
        id: 'created',
        displayName: 'Project Created',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'allocate',
            label: 'Allocate to {leadRoleName}',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'assign_lead', toStage: 'allocated' },
            inputs: [leadPicker],
          },
        ],
      },
      { id: 'allocated', displayName: 'Awaiting', order: 2, isTerminal: false, actions: [] },
    ],
  })

  it('detects the gate', () => {
    const gate = findEntryLeadGate(collabLike)
    expect(gate?.action.id).toBe('allocate')
    expect(gate?.target).toBe('lead')
    expect(gate?.input.id).toBe('leadUid')
  })

  it('plans one hop when a lead is supplied', () => {
    expect(planCreationAllocation(collabLike, { leadUid: 'vh1' })).toEqual([
      {
        actionId: 'allocate',
        outcomeId: 'allocate:advance',
        inputs: { leadUid: 'vh1' },
        requireOnly: ['leadUid'],
        target: 'lead',
        assigneeUid: 'vh1',
        toStageId: 'allocated',
      },
    ])
  })

  it('plans nothing when no lead is supplied', () => {
    expect(planCreationAllocation(collabLike, {})).toEqual([])
    expect(planCreationAllocation(collabLike, { leadUid: null })).toEqual([])
    expect(planCreationAllocation(collabLike, { leadUid: '' })).toEqual([])
  })
})

describe('cause #3 — gate is not actions[0]', () => {
  const w = wf({
    stages: [
      {
        id: 'created',
        displayName: 'Created',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'cancel',
            label: 'Cancel',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'mark_complete', toStage: 'dead', outcomes: ['not_submitted'] },
            inputs: [],
          },
          {
            id: 'allocate',
            label: 'Allocate',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'assign_lead', toStage: 'allocated' },
            inputs: [leadPicker],
          },
        ],
      },
      { id: 'allocated', displayName: 'A', order: 2, isTerminal: false, actions: [] },
      { id: 'dead', displayName: 'D', order: 3, isTerminal: true, actions: [] },
    ],
  })
  it('still finds it', () => {
    expect(findEntryLeadGate(w)?.action.id).toBe('allocate')
    expect(planCreationAllocation(w, { leadUid: 'x' })).toHaveLength(1)
  })
})

describe('cause #4 — entryStageId is not the lowest order', () => {
  const w = wf({
    entryStageId: 'intake',
    stages: [
      { id: 'triage', displayName: 'Triage', order: 1, isTerminal: false, actions: [] },
      {
        id: 'intake',
        displayName: 'Intake',
        order: 2,
        isTerminal: false,
        actions: [
          {
            id: 'allocate',
            label: 'Allocate',
            actor: { kind: 'global_role', role: 'super_admin' },
            effect: { kind: 'assign_lead', toStage: 'triage' },
            inputs: [leadPicker],
          },
        ],
      },
    ],
  })
  it('resolves the authored entry stage', () => {
    expect(resolveEntryStage(w)?.id).toBe('intake')
    expect(planCreationAllocation(w, { leadUid: 'x' })[0].toStageId).toBe('triage')
  })
})

describe('cause #2 — canvas-authored outcome.assign', () => {
  const leadV2 = wf({
    stages: [
      {
        id: 'intake',
        displayName: 'Intake',
        order: 1,
        isTerminal: false,
        actions: [
          {
            id: 'pick_vh',
            label: 'Pick VH',
            actor: { kind: 'role', roleId: 'r1' },
            // Canvas leaves the legacy effect alone — this is exactly why the
            // old `effect.kind === 'assign_lead'` check missed it.
            effect: { kind: 'transition', toStage: 'work' },
            outcomes: [
              {
                id: 'o1',
                label: 'Assigned',
                shape: 'advance',
                toStageId: 'work',
                assign: { target: 'lead', fromInputId: 'leadUid' },
              },
            ],
            inputs: [leadPicker],
          },
        ],
      },
      { id: 'work', displayName: 'Work', order: 2, isTerminal: false, actions: [] },
    ],
  })

  it('detects a v2 lead assign', () => {
    expect(findEntryLeadGate(leadV2)?.outcome.id).toBe('o1')
    expect(planCreationAllocation(leadV2, { leadUid: 'vh' })).toEqual([
      {
        actionId: 'pick_vh',
        outcomeId: 'o1',
        inputs: { leadUid: 'vh' },
        requireOnly: ['leadUid'],
        target: 'lead',
        assigneeUid: 'vh',
        toStageId: 'work',
      },
    ])
  })

  it('detects a v2 project-role assign, and it is not a lead gate', () => {
    const roleV2 = wf({
      projectRoles: [
        { id: 'admin_head', label: 'Admin Head', multiple: false, required: false, order: 0 },
      ],
      stages: [
        {
          id: 'intake',
          displayName: 'Intake',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'pick_ah',
              label: 'Pick AH',
              actor: { kind: 'global_role', role: 'admin' },
              effect: { kind: 'transition', toStage: 'work' },
              outcomes: [
                {
                  id: 'o1',
                  label: 'Assigned',
                  shape: 'advance',
                  toStageId: 'work',
                  assign: { target: { roleId: 'admin_head' }, fromInputId: 'assignUid:admin_head' },
                },
              ],
              inputs: [
                { ...leadPicker, id: 'assignUid:admin_head', label: 'Choose Admin Head' },
              ],
            },
          ],
        },
        { id: 'work', displayName: 'Work', order: 2, isTerminal: false, actions: [] },
      ],
    })
    expect(findEntryLeadGate(roleV2)).toBeNull()
    expect(findAssignGates(roleV2.stages[0])).toHaveLength(1)
    // Only fires when the form supplied that role.
    expect(planCreationAllocation(roleV2, { leadUid: 'x' })).toEqual([])
    const hops = planCreationAllocation(roleV2, { roleAssignments: { admin_head: 'ah1' } })
    expect(hops).toHaveLength(1)
    expect(hops[0].inputs).toEqual({ 'assignUid:admin_head': 'ah1' })
    expect(hops[0].target).toEqual({ roleId: 'admin_head' })
    // A `multiple` role arrives as an array — take the first.
    const multi = planCreationAllocation(roleV2, { roleAssignments: { admin_head: ['a', 'b'] } })
    expect(multi[0].assigneeUid).toBe('a')
  })
})

describe('guards', () => {
  it('skips a multi-outcome (branching) assign action', () => {
    const w = wf({
      stages: [
        {
          id: 'intake',
          displayName: 'I',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'a',
              label: 'A',
              actor: { kind: 'global_role', role: 'admin' },
              effect: { kind: 'transition', toStage: 'work' },
              // The canvas stamps `assign` onto EVERY outcome of an action.
              outcomes: [
                {
                  id: 'o1',
                  label: 'Yes',
                  shape: 'advance',
                  toStageId: 'work',
                  assign: { target: 'lead', fromInputId: 'leadUid' },
                },
                {
                  id: 'o2',
                  label: 'No',
                  shape: 'advance',
                  toStageId: 'intake',
                  assign: { target: 'lead', fromInputId: 'leadUid' },
                },
              ],
              inputs: [leadPicker],
            },
          ],
        },
        { id: 'work', displayName: 'W', order: 2, isTerminal: false, actions: [] },
      ],
    })
    expect(findEntryLeadGate(w)).toBeNull()
    expect(planCreationAllocation(w, { leadUid: 'x' })).toEqual([])
  })

  it('skips a hold assign (no stage move ⇒ nothing to skip)', () => {
    const w = wf({
      stages: [
        {
          id: 'intake',
          displayName: 'I',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'a',
              label: 'A',
              actor: { kind: 'global_role', role: 'admin' },
              effect: { kind: 'transition', toStage: 'work' },
              outcomes: [
                {
                  id: 'o1',
                  label: 'Assigned',
                  shape: 'hold',
                  assign: { target: 'lead', fromInputId: 'leadUid' },
                },
              ],
              inputs: [leadPicker],
            },
          ],
        },
      ],
    })
    expect(planCreationAllocation(w, { leadUid: 'x' })).toEqual([])
  })

  it('skips when the named input is missing or not a user_picker', () => {
    const w = wf({
      stages: [
        {
          id: 'intake',
          displayName: 'I',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'a',
              label: 'A',
              actor: { kind: 'global_role', role: 'admin' },
              effect: { kind: 'assign_lead', toStage: 'work' },
              inputs: [{ id: 'leadUid', label: 'x', type: 'text', required: true }],
            },
          ],
        },
        { id: 'work', displayName: 'W', order: 2, isTerminal: false, actions: [] },
      ],
    })
    expect(planCreationAllocation(w, { leadUid: 'x' })).toEqual([])
  })

  it('basic-flow style workflow yields no gate', () => {
    const w = wf({
      flowType: 'basic',
      stages: [
        {
          id: 'in_progress',
          displayName: 'In Progress',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'mark_complete',
              label: 'Mark complete',
              actor: { kind: 'creator' },
              effect: { kind: 'mark_complete', toStage: 'completed', outcomes: ['completed'] },
              inputs: [],
            },
          ],
        },
        { id: 'completed', displayName: 'Completed', order: 2, isTerminal: true, actions: [] },
      ],
    })
    expect(findEntryLeadGate(w)).toBeNull()
    expect(planCreationAllocation(w, { leadUid: 'x' })).toEqual([])
  })
})

describe('multi-hop', () => {
  it('collapses back-to-back gates and stops when the next needs a decision', () => {
    const w = wf({
      projectRoles: [
        { id: 'admin_head', label: 'AH', multiple: false, required: false, order: 0 },
      ],
      stages: [
        {
          id: 's1',
          displayName: 'S1',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'allocate',
              label: 'A',
              actor: { kind: 'global_role', role: 'super_admin' },
              effect: { kind: 'assign_lead', toStage: 's2' },
              inputs: [leadPicker],
            },
          ],
        },
        {
          id: 's2',
          displayName: 'S2',
          order: 2,
          isTerminal: false,
          actions: [
            {
              id: 'pick_ah',
              label: 'B',
              actor: { kind: 'pipeline_role', role: 'lead' },
              effect: { kind: 'transition', toStage: 's3' },
              outcomes: [
                {
                  id: 'o',
                  label: 'ok',
                  shape: 'advance',
                  toStageId: 's3',
                  assign: { target: { roleId: 'admin_head' }, fromInputId: 'assignUid:admin_head' },
                },
              ],
              inputs: [{ ...leadPicker, id: 'assignUid:admin_head' }],
            },
          ],
        },
        {
          id: 's3',
          displayName: 'S3',
          order: 3,
          isTerminal: false,
          actions: [
            {
              id: 'accept',
              label: 'Accept',
              actor: { kind: 'pipeline_role', role: 'lead' },
              effect: { kind: 'transition', toStage: 's1' },
              inputs: [],
            },
          ],
        },
      ],
    })
    const hops = planCreationAllocation(w, {
      leadUid: 'vh',
      roleAssignments: { admin_head: 'ah' },
    })
    expect(hops.map((h) => h.actionId)).toEqual(['allocate', 'pick_ah'])
    expect(hops[1].toStageId).toBe('s3')
    // Only the lead supplied → stops after hop 1.
    expect(planCreationAllocation(w, { leadUid: 'vh' }).map((h) => h.actionId)).toEqual([
      'allocate',
    ])
  })

  it('does not loop on a self-referential gate', () => {
    const w = wf({
      stages: [
        {
          id: 's1',
          displayName: 'S1',
          order: 1,
          isTerminal: false,
          actions: [
            {
              id: 'allocate',
              label: 'A',
              actor: { kind: 'global_role', role: 'super_admin' },
              effect: { kind: 'assign_lead', toStage: 's1' },
              inputs: [leadPicker],
            },
          ],
        },
      ],
    })
    expect(planCreationAllocation(w, { leadUid: 'x' })).toHaveLength(1)
  })
})
