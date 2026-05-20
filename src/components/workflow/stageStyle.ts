// Generic palette indexed by Stage.order. Replaces the per-stage tone map
// from Phase 1 — stages are now data, so colours need to come from order
// (or another generic property), not the legacy numeric id.
//
// Six tones cycle for any number of stages. Order 1 always gets the warm
// "starting" tone; the terminal stage gets the success tone via stageTone's
// special-case branch when the caller passes `isTerminal: true`.

const PALETTE: Array<{ pill: string; ring: string; dot: string }> = [
  { pill: 'pill-warn border', ring: 'border-warn-dot/30', dot: 'bg-warn-dot' },
  { pill: 'pill-info border', ring: 'border-info-dot/30', dot: 'bg-info-dot' },
  { pill: 'pill-cool border', ring: 'border-cool-dot/30', dot: 'bg-cool-dot' },
  { pill: 'pill-brandtone border', ring: 'border-brandtone-dot/30', dot: 'bg-brandtone-dot' },
  { pill: 'pill-accent border', ring: 'border-accent-dot/30', dot: 'bg-accent-dot' },
  { pill: 'pill-success border', ring: 'border-success-dot/30', dot: 'bg-success-dot' },
]

const TERMINAL_TONE = {
  pill: 'pill-success border',
  ring: 'border-success-dot/30',
  dot: 'bg-success-dot',
}

export function stageTone(order: number, isTerminal = false) {
  if (isTerminal) return TERMINAL_TONE
  // 1-indexed; cycle through the palette.
  const idx = ((order - 1) % PALETTE.length + PALETTE.length) % PALETTE.length
  return PALETTE[idx]
}
