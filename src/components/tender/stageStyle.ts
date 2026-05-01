import type { Project, Stage } from '../../types/models'
import { STAGE_NAMES, STAGE_SHORT_NAMES } from '../../types/models'

// Visual treatment for each stage's pill / banner border.
// Aligned with v1's chartTheme palette: amber for pending, blue for in-flight,
// purple for review, indigo for VH review, red for escalation/rework, emerald for delivery.
export const STAGE_TONE: Record<Stage, { pill: string; ring: string; dot: string }> = {
  1: {
    pill: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
    ring: 'border-amber-400/30',
    dot: 'bg-amber-400',
  },
  2: {
    pill: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
    ring: 'border-amber-400/30',
    dot: 'bg-amber-400',
  },
  3: {
    pill: 'border-red-400/40 bg-red-500/15 text-red-200',
    ring: 'border-red-400/30',
    dot: 'bg-red-400',
  },
  4: {
    pill: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
    ring: 'border-blue-400/30',
    dot: 'bg-blue-400',
  },
  6: {
    pill: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
    ring: 'border-blue-400/30',
    dot: 'bg-blue-400',
  },
  7: {
    pill: 'border-purple-400/40 bg-purple-500/15 text-purple-200',
    ring: 'border-purple-400/30',
    dot: 'bg-purple-400',
  },
  8: {
    pill: 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200',
    ring: 'border-indigo-400/30',
    dot: 'bg-indigo-400',
  },
  9: {
    pill: 'border-red-400/40 bg-red-500/15 text-red-200',
    ring: 'border-red-400/30',
    dot: 'bg-red-400',
  },
  10: {
    pill: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
    ring: 'border-emerald-400/30',
    dot: 'bg-emerald-400',
  },
}

// Friendly per-user-role hint text shown in the banner when no action button is rendered.
export const STAGE_HINT: Record<Stage, string> = {
  1: 'Waiting on the super admin to allocate a Vertical Head.',
  2: 'Waiting on the assigned Vertical Head to accept or escalate.',
  3: 'Escalated — bouncing back to allocation.',
  4: 'Accepted. Moving to task setup.',
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
