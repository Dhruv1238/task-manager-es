import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
// framer-motion is PARKED on canvas nodes — see the note on TaskNodeImpl below.
// Kept as a dependency (NodeInspector / overlays still use it); just not applied
// to anything that lives inside React Flow's zoom-scaled viewport.
// import { motion, useReducedMotion } from 'framer-motion'
import { Layers, Flag, LogIn, Zap, AlertTriangle, Lock } from 'lucide-react'
import { outcomeHandleId, type TaskFlowNode } from './canvasTypes'
import { SHAPE_CORE_VAR, SHAPE_GLOW_VAR } from './edgeTokens'

// Frosted-glass task node. Header (icon + name + entry chip), body (action count
// + first invalid reason), one target handle (left) and one source handle per
// outcome (right), color-coded by shape. Validation ring via box-shadow.

function ringFor(validity: string, selected: boolean | undefined): string {
  if (selected) return 'var(--ring-node-selected)'
  if (validity === 'invalid') return 'var(--ring-node-invalid)'
  if (validity === 'valid') return 'var(--ring-node-valid)'
  return 'none'
}

// NOTE: framer-motion is intentionally parked here. Its layout/FLIP animations
// measure the element's rect in *screen* pixels, which already include React
// Flow's viewport `transform: scale(zoom)`. Framer doesn't account for that
// ancestor scale, so at non-100% zoom the correction is off by the zoom factor —
// nodes flew out and sprang back while dragging, and after auto-arrange the card
// glided over ~300ms while React Flow drew the wires to the final position,
// leaving edges visibly detached until the spring settled. dagre + fitView is
// smooth on its own. Hover/selection feedback is now pure CSS box-shadow (no
// transform → handles don't move → connected edges don't jitter). To re-enable,
// wrap nodes in a zoom-aware motion layer rather than animating them directly.
function TaskNodeImpl({ data, selected }: NodeProps<TaskFlowNode>) {
  const { stage, outcomes, validity, reason, isEntry, actionCount, routedOutcomeIds } = data
  const routed = new Set(routedOutcomeIds)
  const n = Math.max(1, outcomes.length)

  return (
    <div
      className="node-glass min-w-[15rem] max-w-[17rem] select-none rounded-2xl transition-shadow duration-150"
      style={{ boxShadow: ringFor(validity, selected) }}
    >
      {/* Incoming target handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{
          width: 9,
          height: 9,
          background: 'var(--color-line-strong)',
          border: '1.5px solid var(--color-canvas)',
        }}
      />

      {/* Header strip */}
      <div className="flex items-center gap-2 rounded-t-2xl bg-[var(--color-node-header)] px-3.5 py-2.5">
        <Layers size={14} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
          {stage.displayName || 'Untitled task'}
        </span>
        {isEntry && (
          <span className="inline-flex items-center gap-1 rounded-md border border-transparent pill-brandtone px-1.5 py-0.5 text-[10px] font-medium">
            <LogIn size={10} /> Entry
          </span>
        )}
      </div>

      {/* Body */}
      <div className="space-y-1.5 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Zap size={12} className="text-fg-subtle" />
          {actionCount} action{actionCount === 1 ? '' : 's'}
        </div>
        {validity === 'invalid' && reason && (
          <div className="flex items-start gap-1.5 text-xs text-tone-danger-fg">
            <AlertTriangle size={12} className="mt-px shrink-0" />
            <span className="line-clamp-2">{reason}</span>
          </div>
        )}
        {stage.description && validity !== 'invalid' && (
          <p className="line-clamp-2 text-xs text-fg-subtle">{stage.description}</p>
        )}
      </div>

      {/* Outcome source handles, stacked down the right edge */}
      {outcomes.map((o, i) => {
        const top = `${((i + 0.5) / n) * 100}%`
        const color = SHAPE_CORE_VAR[o.shape]
        const isRouted = routed.has(o.id) || o.shape === 'hold'
        return (
          <Handle
            key={o.id}
            type="source"
            position={Position.Right}
            id={outcomeHandleId(o.id)}
            title={`${o.label} → ${o.shape}`}
            className={!isRouted ? 'animate-pulse motion-reduce:animate-none' : undefined}
            style={{
              top,
              width: 10,
              height: 10,
              background: o.shape === 'hold' ? 'transparent' : color,
              border:
                o.shape === 'hold'
                  ? '1.5px dashed var(--edge-hold-core)'
                  : `1.5px solid var(--color-canvas)`,
              boxShadow: o.shape === 'hold' ? 'none' : `0 0 8px ${SHAPE_GLOW_VAR[o.shape]}`,
            }}
          />
        )
      })}
    </div>
  )
}

export const TaskNode = memo(TaskNodeImpl)

// Terminal / close marker node — a small glass pill, target handle only.
function TerminalNodeImpl({ data, selected }: NodeProps<TaskFlowNode>) {
  return (
    <div
      className="node-glass flex items-center gap-2 rounded-full px-4 py-2 transition-shadow duration-150"
      style={{
        boxShadow: selected ? 'var(--ring-node-selected)' : 'none',
        borderColor: 'var(--edge-close-core)',
      }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ width: 9, height: 9 }} />
      <Flag size={13} style={{ color: 'var(--edge-close-core)' }} />
      <span className="text-sm font-medium text-fg">{data.stage.displayName || 'End'}</span>
    </div>
  )
}
export const TerminalNode = memo(TerminalNodeImpl)

// Disabled "coming soon" palette node type — greyed, non-interactive body.
function ComingSoonNodeImpl({ data }: NodeProps<TaskFlowNode>) {
  return (
    <div className="node-glass pointer-events-none rounded-2xl px-3.5 py-3 opacity-60">
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Lock size={14} /> {data.stage.displayName || 'Coming soon'}
      </div>
    </div>
  )
}
export const ComingSoonNode = memo(ComingSoonNodeImpl)
