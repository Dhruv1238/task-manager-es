/**
 * Sandbox lead capture. Writes the visitor's lead doc at top-level
 * `/leads/{leadId}` in the sandbox Firebase project — NOT tenant-prefixed.
 *
 * Each visitor's auth uid is their leadId, so writes from the same browser
 * session merge into one document. Cross-browser visits create separate lead
 * docs with the same email; sales dedupes by email.
 *
 * Security rules enforce that visitors can only write to their own /leads/{uid}.
 */

import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { IS_SANDBOX } from './firestore'
import type { Lead } from '../types/lead'
import type { CaptureStage } from '../types/sandbox'

function leadRef(uid: string) {
  // eslint-disable-next-line no-restricted-syntax -- sandbox-only top-level path; never tenant-prefixed
  return doc(db, 'leads', uid)
}

/** Stage-1 entry: creates the lead doc with email + entry marker. Idempotent. */
export async function captureEntry(opts: {
  uid: string
  email: string
  name?: string
}): Promise<void> {
  if (!IS_SANDBOX) return
  const ref = leadRef(opts.uid)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    // Already captured — opportunistically backfill name if we got one this time.
    if (opts.name && !(existing.data() as Lead).name) {
      await updateDoc(ref, { name: opts.name, lastUpdatedAt: serverTimestamp() })
    }
    return
  }
  await setDoc(ref, {
    id: opts.uid,
    email: opts.email,
    visitorUid: opts.uid,
    source: 'sandbox',
    ...(opts.name ? { name: opts.name } : {}),
    capturedAt: serverTimestamp(),
    lastUpdatedAt: serverTimestamp(),
    capturedStages: ['entry'],
    engagementMinutes: 0,
    actionsCompleted: [],
    tourCompleted: false,
    sessionsCount: 1,
    lastActiveAt: serverTimestamp(),
  })
}

/** Patches the lead doc with progressive capture fields. Merges into stages. */
export async function captureStage(opts: {
  uid: string
  stage: CaptureStage
  fields?: Partial<Pick<Lead, 'name' | 'company' | 'role' | 'intent' | 'wantsCallback' | 'wantsRecap'>>
}): Promise<void> {
  if (!IS_SANDBOX) return
  const ref = leadRef(opts.uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    // First-time write (defensive — entry should have created it). Bootstrap.
    await setDoc(ref, {
      id: opts.uid,
      visitorUid: opts.uid,
      source: 'sandbox',
      capturedAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
      capturedStages: [opts.stage],
      engagementMinutes: 0,
      actionsCompleted: [],
      tourCompleted: false,
      sessionsCount: 1,
      lastActiveAt: serverTimestamp(),
      ...(opts.fields ?? {}),
    })
    return
  }
  const cur = snap.data() as Lead
  const stages = Array.from(new Set([...(cur.capturedStages ?? []), opts.stage]))
  await updateDoc(ref, {
    ...(opts.fields ?? {}),
    capturedStages: stages,
    lastUpdatedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
  })
}

/** Mirror engagement signals to the lead doc. Called on a debounced cadence. */
export async function mirrorEngagement(opts: {
  uid: string
  engagementMinutes: number
  actionsCompleted: string[]
  tourCompleted: boolean
  sessionsCount: number
}): Promise<void> {
  if (!IS_SANDBOX) return
  const ref = leadRef(opts.uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  await updateDoc(ref, {
    engagementMinutes: opts.engagementMinutes,
    actionsCompleted: opts.actionsCompleted,
    tourCompleted: opts.tourCompleted,
    sessionsCount: opts.sessionsCount,
    lastActiveAt: serverTimestamp(),
    lastUpdatedAt: serverTimestamp(),
  })
}

/** Read the lead doc — used for "have we captured X?" gating. */
export async function readLead(uid: string): Promise<Lead | null> {
  if (!IS_SANDBOX) return null
  const snap = await getDoc(leadRef(uid))
  return snap.exists() ? (snap.data() as Lead) : null
}

// Re-export for callers that need direct read.
export const _internal = { leadRef }
