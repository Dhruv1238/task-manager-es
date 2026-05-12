import type { Project, Stage } from '../../types/models'
import { STAGE_NAMES, STAGE_SHORT_NAMES } from '../../types/models'

// Visual treatment for each stage. Each entry references the semantic pill
// utilities defined in index.css (pill-warn, pill-info, etc.) so the same
// tone reads correctly under both dark and light themes — saturated brand
// hues with light text in dark mode, softened fills with deep text in light.
// Tones: warn (amber/pending), danger (red/escalation), info (blue/in-flight),
// cool (sky/eligibility), brandtone (purple/review), accent (indigo/VH review),
// success (emerald/delivery).
export const STAGE_TONE: Record<Stage, { pill: string; ring: string; dot: string }> = {
  1: {
    pill: 'pill-warn border',
    ring: 'border-warn-dot/30',
    dot: 'bg-warn-dot',
  },
  2: {
    pill: 'pill-warn border',
    ring: 'border-warn-dot/30',
    dot: 'bg-warn-dot',
  },
  3: {
    pill: 'pill-danger border',
    ring: 'border-danger-dot/30',
    dot: 'bg-danger-dot',
  },
  4: {
    pill: 'pill-info border',
    ring: 'border-info-dot/30',
    dot: 'bg-info-dot',
  },
  5: {
    pill: 'pill-cool border',
    ring: 'border-cool-dot/30',
    dot: 'bg-cool-dot',
  },
  6: {
    pill: 'pill-info border',
    ring: 'border-info-dot/30',
    dot: 'bg-info-dot',
  },
  7: {
    pill: 'pill-brandtone border',
    ring: 'border-brandtone-dot/30',
    dot: 'bg-brandtone-dot',
  },
  8: {
    pill: 'pill-accent border',
    ring: 'border-accent-dot/30',
    dot: 'bg-accent-dot',
  },
  9: {
    pill: 'pill-danger border',
    ring: 'border-danger-dot/30',
    dot: 'bg-danger-dot',
  },
  10: {
    pill: 'pill-success border',
    ring: 'border-success-dot/30',
    dot: 'bg-success-dot',
  },
}

// Friendly per-user-role hint text shown in the banner when no action button is rendered.
export const STAGE_HINT: Record<Stage, string> = {
  1: 'Waiting on the super admin to allocate a Vertical Head.',
  2: 'Waiting on the assigned Vertical Head to accept or escalate.',
  3: 'Escalated — bouncing back to allocation.',
  4: 'Accepted. Moving to task setup.',
  5: "Super admin is reviewing eligibility based on the VH's assessment.",
  6: 'The VH is setting up tasks for each team.',
  7: 'Teams are executing.',
  8: 'The VH is reviewing the deliverable with CS.',
  9: 'Reworking after VH feedback.',
  10: 'Sent to client. CS will record the outcome.',
}

// Single source of truth for "what phase chip should we render for this project".
// A project that's been escalated and is sitting back at stage 1 isn't visually
// the same as a fresh project — surface that distinction here so every chip
// (banner, project list, /me) reads consistently.
export interface DisplayedPhase {
  // The stage whose tone we render. For escalation it's stage 3 (red), even
  // though the live `project.stage` is 1.
  toneStage: Stage
  label: string
  shortLabel: string
  hint: string
  isEscalated: boolean
}

export function displayedPhase(project: Project): DisplayedPhase {
  const stage = (project.stage ?? 1) as Stage
  const escalated = stage === 1 && (project.escalationCount ?? 0) > 0
  if (escalated) {
    return {
      toneStage: 3,
      label: 'Escalated — needs re-allocation',
      shortLabel: 'Escalated',
      hint: 'Sent back by the previous VH. Allocate to a VH to continue.',
      isEscalated: true,
    }
  }
  return {
    toneStage: stage,
    label: STAGE_NAMES[stage],
    shortLabel: STAGE_SHORT_NAMES[stage],
    hint: STAGE_HINT[stage],
    isEscalated: false,
  }
}
