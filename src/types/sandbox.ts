/**
 * Sandbox-only schemas. None of these types appear on production paths; they
 * live under `/sandbox/{visitorUid}/_meta` (singleton) or are pure UI state.
 */

import type { Timestamp } from 'firebase/firestore'

export type CaptureStage = 'entry' | 'firstAction' | 'engagement' | 'deepIntent' | 'exitIntent'

export type EntryMode = 'tour' | 'roam' | null

export interface SandboxMeta {
  visitorUid: string
  createdAt: Timestamp
  lastSeenAt: Timestamp
  sessionsCount: number

  // Phase A vs Phase B seed gating — see sandboxBoot.ts. Phase A runs the
  // minimal pre-wizard seed (this _meta doc + leads + an empty orgStructure
  // placeholder). Phase B runs the rich seed (projects, personas, sample
  // tasks) after both wizards complete.
  richSeedCompleted: boolean

  visitor: {
    email: string
    name?: string
    company?: string
    role?: string
    intent?: string
    wantsCallback?: boolean
    wantsRecap?: boolean
  }

  contactCapture: {
    entry: boolean
    firstAction: boolean
    engagement: boolean
    deepIntent: boolean
    exitIntent: boolean
    dismissals?: {
      firstAction?: Timestamp
      engagement?: Timestamp
      deepIntent?: Timestamp
      exitIntent?: Timestamp
    }
    dismissalCounts?: {
      firstAction?: number
      engagement?: number
    }
  }

  entryMode: EntryMode

  tourProgress?: {
    tourId: string
    currentStepId: string
    completedStepIds: string[]
    startedAt?: Timestamp
    completedAt?: Timestamp
    abandonedAt?: Timestamp
  }

  engagement: {
    totalActiveSeconds: number
    lastActiveAt: Timestamp
    actionsCompleted: string[]
  }

  dismissedHints?: Record<string, boolean>
}

/** Public sandbox config doc (paranoia-check beacon + Calendly URL etc.) */
export interface SandboxConfig {
  isSandbox: boolean
  banner: string
  contactEmail: string
  calendlyUrl?: string
}

/** Persona archetype seeded under /sandbox/{uid}/users/persona:* */
export interface PersonaArchetype {
  uid: string                  // deterministic, e.g. "persona:vh-primary"
  displayName: string
  email: string                // synthetic; never used for auth
  globalRole: 'super_admin' | 'admin' | 'horizontal_lead' | 'user'
  teamHint?: string            // the team name (sandbox seed uses the visitor's wizard-named teams)
  roleChip: string             // short label for the persona pill (e.g. "VH", "Designer")
}
