import type { PillColor } from '../types/workflow'

// Phase 2d: static class maps for the shared colour palette (project-role chips,
// custom-field select options, author-defined statuses).
//
// CRITICAL: Tailwind v4's JIT scans source for literal class names. A
// template-interpolated string like `pill-${tone}` is NEVER seen by the scanner
// and gets purged from the build, so the chip renders unstyled. Every class
// string below is written out literally so the JIT keeps them. Always resolve a
// PillColor through these maps — never build the class name by interpolation.

export const PILL_CLASS: Record<PillColor, string> = {
  info: 'pill-info border',
  success: 'pill-success border',
  warn: 'pill-warn border',
  danger: 'pill-danger border',
  brandtone: 'pill-brandtone border',
  accent: 'pill-accent border',
  cool: 'pill-cool border',
  mint: 'pill-mint border',
  neutral: 'pill-neutral border',
  orange: 'pill-orange border',
  yellow: 'pill-yellow border',
  pink: 'pill-pink border',
}

export const DOT_CLASS: Record<PillColor, string> = {
  info: 'bg-info-dot',
  success: 'bg-success-dot',
  warn: 'bg-warn-dot',
  danger: 'bg-danger-dot',
  brandtone: 'bg-brandtone-dot',
  accent: 'bg-accent-dot',
  cool: 'bg-cool-dot',
  mint: 'bg-mint-dot',
  neutral: 'bg-neutral-dot',
  orange: 'bg-orange-dot',
  yellow: 'bg-yellow-dot',
  pink: 'bg-pink-dot',
}

// Ordered swatch palette for the colour pickers (roles / field options /
// statuses). Neutral last — it reads as "no colour".
export const PILL_COLORS: PillColor[] = [
  'brandtone',
  'info',
  'cool',
  'mint',
  'success',
  'warn',
  'orange',
  'yellow',
  'danger',
  'pink',
  'accent',
  'neutral',
]

export function pillClassFor(color: PillColor | undefined): string {
  return PILL_CLASS[color ?? 'neutral']
}

export function dotClassFor(color: PillColor | undefined): string {
  return DOT_CLASS[color ?? 'neutral']
}

// Deterministic colour for an option/role by index — used when seeding new
// options so successive adds don't all land on the same tone.
export function nextPillColor(index: number): PillColor {
  return PILL_COLORS[index % PILL_COLORS.length]
}
