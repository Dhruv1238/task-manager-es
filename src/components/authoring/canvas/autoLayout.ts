import type { Stage } from '../../../types/workflow'
import type { CanvasNode } from '../../../types/v2'
import { readOutcomes } from '../../../lib/rules/outcomeAdapter'

// Dagre is ~15KB — imported dynamically inside the function so a flow that never
// auto-lays-out (already has canvasLayout) doesn't pay for it.

const NODE_W = 264
const TERMINAL_W = 168 // the rounded-pill terminal node is much narrower
function nodeWidth(stage: Stage): number {
  return stage.isTerminal ? TERMINAL_W : NODE_W
}
function nodeHeight(stage: Stage): number {
  if (stage.isTerminal) return 56
  // Grows with the number of outcome handles down the right edge.
  const handles = stage.actions.reduce((n, a) => n + readOutcomes(a).length, 0)
  return 72 + 22 * Math.max(1, handles)
}

export async function autoLayout(
  stages: Stage[],
  opts?: { rankdir?: 'LR' | 'TB' },
): Promise<CanvasNode[]> {
  const dagre = (await import('dagre')) as typeof import('dagre')
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: opts?.rankdir ?? 'LR',
    nodesep: 80,
    ranksep: 170,
    marginx: 56,
    marginy: 56,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const s of stages) g.setNode(s.id, { width: nodeWidth(s), height: nodeHeight(s) })
  for (const s of stages) {
    for (const action of s.actions) {
      for (const outcome of readOutcomes(action)) {
        // Include close edges too (they point at terminal markers) so dagre
        // ranks endings to the RIGHT instead of stranding them at rank 0 —
        // otherwise close→terminal edges sweep back across the whole canvas.
        // Skip self-loops (toStage === own id): dagre can't rank a self-edge,
        // and feeding it skews neighbouring ranks. The canvas still draws the
        // loop (OutcomeEdge routes it cleanly below the node).
        if (outcome.toStageId && outcome.toStageId !== s.id && outcome.shape !== 'hold') {
          g.setEdge(s.id, outcome.toStageId)
        }
      }
    }
  }

  dagre.layout(g)

  return stages.map((s) => {
    const n = g.node(s.id) as { x: number; y: number } | undefined
    const w = nodeWidth(s)
    const h = nodeHeight(s)
    return {
      taskId: s.id,
      // dagre centres nodes; React Flow positions by top-left. Snap to the 16px grid.
      x: n ? Math.round((n.x - w / 2) / 16) * 16 : 0,
      y: n ? Math.round((n.y - h / 2) / 16) * 16 : 0,
    }
  })
}

// Edges the canvas should render = every advance/branch outcome that has a
// resolved target. Stable ids derive from the outcome id.
export function deriveCanvasEdges(stages: Stage[]) {
  const edges: { id: string; fromTaskId: string; outcomeId: string; toTaskId: string }[] = []
  for (const s of stages) {
    for (const action of s.actions) {
      for (const outcome of readOutcomes(action)) {
        if (outcome.toStageId && (outcome.shape === 'advance' || outcome.shape === 'branch' || outcome.shape === 'close')) {
          edges.push({
            id: `e:${s.id}:${outcome.id}`,
            fromTaskId: s.id,
            outcomeId: outcome.id,
            toTaskId: outcome.toStageId,
          })
        }
      }
    }
  }
  return edges
}
