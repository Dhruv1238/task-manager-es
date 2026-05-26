/**
 * 60-second tour types. The tour overlay reads these step definitions and
 * orchestrates: route navigation, persona switching, target highlighting,
 * and (optionally) programmatic action invocation via the tour orchestrator.
 */

export type TourAutoActionKind =
  | { kind: 'navigate'; path: string }
  | { kind: 'openProject'; projectId: string }
  | { kind: 'scrollTo'; selector: string }
  | { kind: 'performAction'; actionId: string; projectId: string; inputs?: Record<string, unknown> }

export interface TourStep {
  id: string
  targetSelector: string // data-tour-id value
  targetRoute?: string   // route to navigate to before showing
  actAs?: string | 'visitor' // persona uid or back to visitor
  title: string
  body: string
  bodyMobile?: string
  primaryCta?: { label: string }
  autoAction?: TourAutoActionKind
  dwellMs?: number
  manualAdvance?: boolean
}

export interface TourState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'errored'
  currentStepIndex: number
  startedAt?: number
  completedAt?: number
  source: 'menu' | 'header' | 'resume'
}
