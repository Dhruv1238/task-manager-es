import type { OutcomeShape } from '../../../types/v2'

// Literal shape→class/var maps. Kept as explicit literals (not template
// interpolation) so Tailwind v4 JIT never purges them — same discipline as
// src/lib/fieldTokens.ts. The CSS vars resolve per-theme, so light/dark
// legibility is inherited, not reinvented.

export const SHAPE_PILL: Record<OutcomeShape, string> = {
  advance: 'pill-brandtone',
  branch: 'pill-accent',
  hold: 'pill-warn',
  close: 'pill-danger',
}

export const SHAPE_CORE_VAR: Record<OutcomeShape, string> = {
  advance: 'var(--edge-advance-core)',
  branch: 'var(--edge-branch-core)',
  hold: 'var(--edge-hold-core)',
  close: 'var(--edge-close-core)',
}

export const SHAPE_GLOW_VAR: Record<OutcomeShape, string> = {
  advance: 'var(--edge-advance-glow)',
  branch: 'var(--edge-branch-glow)',
  hold: 'var(--edge-hold-glow)',
  close: 'var(--edge-close-glow)',
}

// SVG <linearGradient> ids defined once in FlowCanvas defs and referenced by edges.
export const SHAPE_GRADIENT_ID: Record<OutcomeShape, string> = {
  advance: 'edgeGlow-advance',
  branch: 'edgeGlow-branch',
  hold: 'edgeGlow-hold',
  close: 'edgeGlow-close',
}

export const SHAPE_LABEL: Record<OutcomeShape, string> = {
  advance: 'Advance',
  branch: 'Branch',
  hold: 'Hold',
  close: 'Close',
}

export const ALL_SHAPES: OutcomeShape[] = ['advance', 'branch', 'hold', 'close']
