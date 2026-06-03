import type { Node, Edge } from '@xyflow/react'
import type { Stage } from '../../../types/workflow'
import type { Outcome, OutcomeShape } from '../../../types/v2'
import type { NodeValidity } from '../../../lib/flowValidation'

export interface TaskNodeData extends Record<string, unknown> {
  stage: Stage
  outcomes: Outcome[]
  validity: NodeValidity
  reason?: string
  isEntry: boolean
  actionCount: number
  // outcome ids that currently have a drawn edge (for handle styling/pulse).
  routedOutcomeIds: string[]
  selected?: boolean
}

export interface OutcomeEdgeData extends Record<string, unknown> {
  shape: OutcomeShape
  label: string
  active: boolean
}

export type TaskFlowNode = Node<TaskNodeData, 'task' | 'terminal' | 'comingSoon'>
export type OutcomeFlowEdge = Edge<OutcomeEdgeData, 'outcome'>

// Encodes an outcome handle id so onConnect can recover which outcome was dragged.
export const OUT_HANDLE_PREFIX = 'out:'
export function outcomeHandleId(outcomeId: string): string {
  return `${OUT_HANDLE_PREFIX}${outcomeId}`
}
export function parseOutcomeHandle(handleId: string | null | undefined): string | null {
  if (!handleId || !handleId.startsWith(OUT_HANDLE_PREFIX)) return null
  return handleId.slice(OUT_HANDLE_PREFIX.length)
}
