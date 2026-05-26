/**
 * Top-level `/leads/{leadId}` doc in the sandbox Firebase project. `leadId`
 * equals the visitor's auth uid — dedup guarantee within a uid. Cross-browser
 * same-email visits create separate lead docs; sales dedupes by email.
 *
 * The client writes its own lead doc directly; security rules lock each visitor
 * to their own document.
 */

import type { Timestamp } from 'firebase/firestore'
import type { CaptureStage } from './sandbox'

export interface Lead {
  id: string                          // == visitor auth uid
  email: string
  visitorUid: string
  source: 'sandbox'

  // Progressively populated profile fields
  name?: string
  company?: string
  role?: string
  intent?: string
  wantsCallback?: boolean
  wantsRecap?: boolean

  // Lifecycle
  capturedAt: Timestamp               // entry
  lastUpdatedAt: Timestamp
  capturedStages: CaptureStage[]

  // Engagement signals (mirrored from _meta on a debounced cadence)
  engagementMinutes: number
  actionsCompleted: string[]
  tourCompleted: boolean
  sessionsCount: number
  lastActiveAt: Timestamp

  // Sales-team annotations (not written by the app)
  contacted?: boolean
  contactedAt?: Timestamp
  contactedBy?: string
  notes?: string
}
