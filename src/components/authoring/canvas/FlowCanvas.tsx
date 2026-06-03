import { useCallback, useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react'
import { ComingSoonNode, TaskNode, TerminalNode } from './TaskNode'
import { OutcomeEdge } from './OutcomeEdge'
import { deriveCanvasEdges } from './autoLayout'
import { readOutcomes } from '../../../lib/rules/outcomeAdapter'
import { parseOutcomeHandle, type OutcomeFlowEdge, type TaskFlowNode } from './canvasTypes'
import { ALL_SHAPES, SHAPE_CORE_VAR, SHAPE_GLOW_VAR, SHAPE_GRADIENT_ID } from './edgeTokens'
import type { Workflow } from '../../../types/workflow'
import type { FlowValidationResult } from '../../../lib/flowValidation'

// Module-scope so React Flow doesn't remount node/edge renderers each render.
const nodeTypes: NodeTypes = { task: TaskNode, terminal: TerminalNode, comingSoon: ComingSoonNode }
const edgeTypes: EdgeTypes = { outcome: OutcomeEdge }

export interface FlowCanvasProps {
  workflow: Workflow
  validation: FlowValidationResult
  selectedStageId: string | null
  leadRoleName?: string
  // Bumped by the parent on initial layout + Auto-arrange so the view reframes.
  fitSignal?: number
  onSelectStage: (id: string | null) => void
  onMoveNode: (stageId: string, x: number, y: number) => void
  onConnectOutcome: (fromStageId: string, outcomeId: string, toStageId: string) => void
  onDeleteStage: (stageId: string) => void
  onDisconnectOutcome: (fromStageId: string, outcomeId: string) => void
  readOnly?: boolean
}

// Swap {leadRoleName} (and any future placeholders) so labels read cleanly on
// the canvas instead of showing the raw template token.
function interp(text: string, leadRoleName?: string): string {
  return text.replace(/\{leadRoleName\}/g, leadRoleName || 'Lead')
}

// Parallax orb layer — drifts with pan at fractional speed for ambient depth.
function OrbBackdrop() {
  const tx = useStore((s) => s.transform[0])
  const ty = useStore((s) => s.transform[1])
  const orb = (factor: number, cls: string, size: number, left: string, top: string) => (
    <div
      className={`absolute rounded-full blur-3xl ${cls}`}
      style={{
        width: size,
        height: size,
        left,
        top,
        transform: `translate3d(${tx * factor}px, ${ty * factor}px, 0)`,
      }}
    />
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {orb(0.02, 'bg-canvas-orb-a canvas-orb-a', 460, '8%', '12%')}
      {orb(0.035, 'bg-canvas-orb-b canvas-orb-b', 380, '62%', '8%')}
      {orb(0.05, 'bg-canvas-orb-c canvas-orb-c', 320, '40%', '58%')}
    </div>
  )
}

// SVG paint-server defs (neon gradients + blur). Rendered once; referenced by
// every OutcomeEdge via url(#id). Ids are document-global so a hidden svg works.
function EdgeDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {ALL_SHAPES.map((shape) => (
          <linearGradient key={shape} id={SHAPE_GRADIENT_ID[shape]} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={SHAPE_GLOW_VAR[shape]} />
            <stop offset="100%" stopColor={SHAPE_CORE_VAR[shape]} />
          </linearGradient>
        ))}
        <filter id="edgeBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
    </svg>
  )
}

export function FlowCanvas({
  workflow,
  validation,
  selectedStageId,
  leadRoleName,
  fitSignal,
  onSelectStage,
  onMoveNode,
  onConnectOutcome,
  onDeleteStage,
  onDisconnectOutcome,
  readOnly,
}: FlowCanvasProps) {
  const rf = useReactFlow()
  const layoutById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>()
    for (const n of workflow.canvasLayout?.nodes ?? []) m.set(n.taskId, { x: n.x, y: n.y })
    return m
  }, [workflow.canvasLayout])

  const entryId = useMemo(() => {
    if (workflow.entryStageId) return workflow.entryStageId
    return [...workflow.stages].sort((a, b) => a.order - b.order)[0]?.id ?? null
  }, [workflow.entryStageId, workflow.stages])

  const routedOutcomeIds = useMemo(
    () => new Set(deriveCanvasEdges(workflow.stages).map((e) => e.outcomeId)),
    [workflow.stages],
  )

  const computedNodes = useMemo<TaskFlowNode[]>(() => {
    return workflow.stages.map((stage, i) => {
      const outcomes = stage.actions.flatMap((a) => readOutcomes(a))
      const routed = routedOutcomeIds
      const pos = layoutById.get(stage.id) ?? { x: (i % 4) * 320, y: Math.floor(i / 4) * 220 }
      return {
        id: stage.id,
        type: stage.isTerminal ? 'terminal' : 'task',
        position: pos,
        // Keep terminal pills (and the selected node) above task cards so a
        // tight layout never hides one behind another.
        zIndex: stage.id === selectedStageId ? 20 : stage.isTerminal ? 10 : 1,
        data: {
          stage,
          outcomes,
          validity: validation.nodeValidity[stage.id] ?? 'neutral',
          reason: validation.nodeReason[stage.id],
          isEntry: stage.id === entryId,
          actionCount: stage.actions.length,
          routedOutcomeIds: outcomes.filter((o) => routed.has(o.id)).map((o) => o.id),
        },
        selected: stage.id === selectedStageId,
      }
    })
  }, [workflow.stages, layoutById, validation, entryId, selectedStageId, routedOutcomeIds])

  const computedEdges = useMemo<OutcomeFlowEdge[]>(() => {
    const edges = deriveCanvasEdges(workflow.stages)
    const outcomeById = new Map(
      workflow.stages.flatMap((s) => s.actions.flatMap((a) => readOutcomes(a))).map((o) => [o.id, o]),
    )
    return edges.map((e) => {
      const o = outcomeById.get(e.outcomeId)
      const active = e.fromTaskId === selectedStageId || e.toTaskId === selectedStageId
      return {
        id: e.id,
        type: 'outcome',
        source: e.fromTaskId,
        target: e.toTaskId,
        sourceHandle: `out:${e.outcomeId}`,
        targetHandle: 'in',
        data: { shape: o?.shape ?? 'advance', label: interp(o?.label ?? '', leadRoleName), active },
      }
    })
  }, [workflow.stages, selectedStageId, leadRoleName])

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>(computedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<OutcomeFlowEdge>(computedEdges)

  // Re-sync when the draft / validation / selection changes upstream.
  useEffect(() => setNodes(computedNodes), [computedNodes, setNodes])
  useEffect(() => setEdges(computedEdges), [computedEdges, setEdges])

  // Reframe the view after the parent re-lays-out (initial load + Auto-arrange).
  // A tick lets React Flow measure the freshly-positioned nodes first.
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.18, duration: 400, maxZoom: 1.1 }), 60)
    return () => clearTimeout(t)
  }, [fitSignal, rf])

  const onConnect = useCallback(
    (c: Connection) => {
      const outcomeId = parseOutcomeHandle(c.sourceHandle)
      if (c.source && c.target && outcomeId) onConnectOutcome(c.source, outcomeId, c.target)
    },
    [onConnectOutcome],
  )

  // Self-loops ARE valid (e.g. "request changes" sends a task back to itself —
  // the seed's In Execution does exactly this). Allow source === target.
  const isValidConnection = useCallback(
    (c: Connection | OutcomeFlowEdge) => Boolean(c.source && c.target),
    [],
  )

  return (
    <div className="rf-canvas relative h-full w-full" style={{ background: 'var(--canvas-bg)' }}>
      <EdgeDefs />
      <OrbBackdrop />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'outcome' }}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.3}
        maxZoom={1.75}
        snapToGrid
        snapGrid={[16, 16]}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        selectNodesOnDrag={false}
        panOnScroll
        zoomOnDoubleClick={false}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        onNodeClick={(_, node) => onSelectStage(node.id)}
        onPaneClick={() => onSelectStage(null)}
        onNodeDragStop={(_, node) =>
          onMoveNode(node.id, Math.round(node.position.x / 16) * 16, Math.round(node.position.y / 16) * 16)
        }
        onNodesDelete={(deleted) => {
          if (readOnly) return
          for (const n of deleted) onDeleteStage(n.id)
        }}
        onEdgesDelete={(deleted) => {
          if (readOnly) return
          for (const e of deleted) {
            const outcomeId = parseOutcomeHandle(e.sourceHandle)
            if (e.source && outcomeId) onDisconnectOutcome(e.source, outcomeId)
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--canvas-dot)" />
        <MiniMap
          pannable
          zoomable
          maskColor="var(--rf-minimap-mask)"
          style={{ background: 'var(--rf-minimap-bg)' }}
          nodeColor={(n) => {
            const v = (n.data as TaskFlowNode['data'])?.validity
            if (v === 'invalid') return 'var(--color-danger-dot)'
            if (v === 'neutral') return 'var(--color-fg-subtle)'
            return 'var(--color-brandtone-dot)'
          }}
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
