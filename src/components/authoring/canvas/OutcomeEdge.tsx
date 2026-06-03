import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { ArrowRight, GitBranch, PauseCircle, Flag, X } from 'lucide-react'
import type { OutcomeFlowEdge } from './canvasTypes'
import { SHAPE_CORE_VAR, SHAPE_GRADIENT_ID, SHAPE_PILL } from './edgeTokens'
import type { OutcomeShape } from '../../../types/v2'

const SHAPE_ICON = {
  advance: ArrowRight,
  branch: GitBranch,
  hold: PauseCircle,
  close: Flag,
} as const

// Stable small int from an id, used to stagger the depth of stacked back-edge
// lanes so two loops over the same span don't draw on top of each other.
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Build an SVG path through axis-aligned points with rounded corners. Every
// turn gets a quadratic fillet of radius `r` (clamped to half the shorter
// adjacent segment) so the orthogonal detour reads as clean right-angles with
// soft corners instead of hard kinks.
function orthRoundedPath(pts: { x: number; y: number }[], r = 14): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const segIn = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const segOut = Math.hypot(next.x - cur.x, next.y - cur.y)
    const rr = Math.max(0, Math.min(r, segIn / 2, segOut / 2))
    const ux = Math.sign(cur.x - prev.x)
    const uy = Math.sign(cur.y - prev.y)
    const vx = Math.sign(next.x - cur.x)
    const vy = Math.sign(next.y - cur.y)
    d += ` L ${cur.x - ux * rr},${cur.y - uy * rr}`
    d += ` Q ${cur.x},${cur.y} ${cur.x + vx * rr},${cur.y + vy * rr}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x},${last.y}`
  return d
}

function OutcomeEdgeImpl(props: EdgeProps<OutcomeFlowEdge>) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props
  const rf = useReactFlow()
  const shape: OutcomeShape = data?.shape ?? 'advance'
  const active = Boolean(data?.active) || Boolean(selected)

  // A self-loop (outcome points at its own task, e.g. "request changes — stays
  // here") or a back-edge (target sits left of the source in the LR layout, i.e.
  // a feedback loop like "escalate back") can't be drawn as a forward smooth-step
  // path without cutting straight through the nodes. Route those down into a lane
  // *below* the row and back up, so the wire goes cleanly around the cards.
  const isSelf = source === target
  const isBack = !isSelf && targetX <= sourceX + 8

  let edgePath: string
  let lx: number
  let ly: number

  if (isSelf || isBack) {
    const stub = 16 // short horizontal exit/entry off the node before turning
    const drop = 76 // clearance below the handle so the lane misses the card
    const stagger = (hashId(id) % 3) * 18 // separate overlapping lanes
    const laneY = Math.max(sourceY, targetY) + drop + stagger
    const pts = [
      { x: sourceX, y: sourceY }, // leave the source (right) handle
      { x: sourceX + stub, y: sourceY }, // short stub right
      { x: sourceX + stub, y: laneY }, // drop into the lane
      { x: targetX - stub, y: laneY }, // travel under the row to the target
      { x: targetX - stub, y: targetY }, // climb back up
      { x: targetX, y: targetY }, // into the target (left) handle
    ]
    edgePath = orthRoundedPath(pts, 14)
    lx = (sourceX + stub + (targetX - stub)) / 2
    ly = laneY
  } else {
    // Forward edge — orthogonal smooth-step reads cleanest for a layered LR flow
    // and keeps labels on the horizontal run between ranks.
    const [p, mx, my] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 14,
    })
    edgePath = p
    lx = mx
    ly = my
  }

  const Icon = SHAPE_ICON[shape]
  const core = active ? SHAPE_CORE_VAR[shape] : 'var(--edge-idle)'
  const full = data?.label ?? shape
  const short = full.length > 18 ? `${full.slice(0, 17)}…` : full

  return (
    <>
      {/* Neon glow halo (blurred, under the core). */}
      <path
        d={edgePath}
        fill="none"
        stroke={`url(#${SHAPE_GRADIENT_ID[shape]})`}
        strokeWidth={8}
        strokeLinecap="round"
        style={{ filter: 'url(#edgeBlur)', opacity: active ? 0.9 : 0.18, transition: 'opacity 180ms ease' }}
      />
      {/* Core stroke + arrowhead. */}
      <BaseEdge id={id} path={edgePath} style={{ stroke: core, strokeWidth: 1.75 }} markerEnd={props.markerEnd} />
      {/* Flow particles on the active path (CSS keyframe; auto-suspends on reduced-motion). */}
      {active && (
        <path
          d={edgePath}
          fill="none"
          className="edge-flow-anim"
          stroke="var(--flow-particle)"
          strokeWidth={3}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      <EdgeLabelRenderer>
        <div
          title={full}
          className={`nodrag nopan group absolute flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium backdrop-blur transition-opacity ${
            active ? 'opacity-100' : 'opacity-70 hover:opacity-100'
          }`}
          style={{
            transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
            background: 'var(--edge-label-bg)',
            pointerEvents: 'all',
            zIndex: active ? 2 : 1,
          }}
        >
          <span className={`inline-flex max-w-40 items-center gap-1 truncate rounded-full border-transparent ${SHAPE_PILL[shape]} px-1 py-0`}>
            <Icon size={11} className="shrink-0" />
            {short}
          </span>
          <button
            type="button"
            title="Disconnect"
            onClick={(e) => {
              e.stopPropagation()
              rf.deleteElements({ edges: [{ id }] })
            }}
            className="ml-0.5 hidden rounded-full p-0.5 text-fg-subtle transition hover:bg-fill-3 hover:text-fg group-hover:inline-flex"
          >
            <X size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const OutcomeEdge = memo(OutcomeEdgeImpl)
