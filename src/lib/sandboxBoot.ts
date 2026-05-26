/**
 * Sandbox boot orchestrator. Sequences:
 *
 *   auth-resolved → Phase A seed → app-ready
 *                                ↓
 *                          (wizards run)
 *                                ↓
 *                          Phase B trigger (setupCompleted && activeWorkflowIds)
 *                                ↓
 *                          rich seed → tour overlay mounts
 *
 * This module owns the gating so AppConfigContext's existing `bootLoaded`
 * logic doesn't see partial state during the first paint.
 */

import { onAuthStateChanged, signInAnonymously, indexedDBLocalPersistence, setPersistence } from 'firebase/auth'
import { auth } from './firebase'
import { IS_SANDBOX } from './firestore'
import { runPhaseA, runPhaseB, shouldRunPhaseB } from './sandboxSeed'

export type SandboxBootStatus =
  | { phase: 'idle' }
  | { phase: 'awaiting-auth' }
  | { phase: 'seeding-a' }
  | { phase: 'ready'; uid: string }
  | { phase: 'seeding-b' }
  | { phase: 'rich-ready'; uid: string }
  | { phase: 'errored'; error: Error }

type Listener = (s: SandboxBootStatus) => void

let current: SandboxBootStatus = { phase: 'idle' }
const listeners = new Set<Listener>()
let authListenerAttached = false
let anonSignInStarted = false
let pendingOpts: { pendingEmail?: string; pendingName?: string } | undefined
// Track which uids we've already seeded in this tab so re-firing the listener
// on a transient state shift doesn't double-run Phase A. Phase A itself is
// idempotent at the Firestore level (the "returning visitor" branch only
// bumps sessionsCount), but skipping the round-trip is cheaper.
const seededUids = new Set<string>()
// Resolves once Phase A has completed at least once. Re-armed on sign-out so
// callers waiting for "the next sign-in" don't latch onto a stale resolution.
let phaseAResolver: (() => void) | null = null
let phaseAPromise: Promise<void> = new Promise<void>((resolve) => {
  phaseAResolver = resolve
})

function set(s: SandboxBootStatus) {
  current = s
  for (const l of listeners) l(s)
}

export function getBootStatus(): SandboxBootStatus {
  return current
}

export function subscribeBoot(fn: Listener): () => void {
  listeners.add(fn)
  fn(current)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Called from main.tsx on app start and from SandboxLogin.onEmail when the
 * visitor submits the email form. Both call sites converge on the same
 * persistent auth listener — Phase A runs on every fresh sign-in (not just
 * the first), which is what makes sign-out + sign-in-with-a-different-account
 * work without a hard page reload.
 *
 * Returns a promise that resolves once Phase A has completed at least once
 * for the current tab. Email-path callers can `await` this to know when the
 * visitor is fully bootstrapped before navigating.
 *
 * In production builds this returns immediately — no sandbox concerns.
 */
export async function initSandboxBoot(opts?: { pendingEmail?: string; pendingName?: string }): Promise<void> {
  if (!IS_SANDBOX) return

  // Keep the latest pendingEmail/Name available to whichever listener call
  // happens to handle the next sign-in event.
  if (opts?.pendingEmail) pendingOpts = opts

  if (!authListenerAttached) {
    authListenerAttached = true
    set({ phase: 'awaiting-auth' })
    // Pin persistence so visitor uids survive refresh on the same browser.
    try {
      await setPersistence(auth, indexedDBLocalPersistence)
    } catch {
      // Best effort — local-storage fallback is fine.
    }
    onAuthStateChanged(auth, async (u) => {
      if (!u) {
        // Re-arm the phaseAPromise so a sign-in after sign-out is awaitable.
        phaseAPromise = new Promise<void>((resolve) => {
          phaseAResolver = resolve
        })
        set({ phase: 'awaiting-auth' })
        return
      }
      if (seededUids.has(u.uid)) {
        set({ phase: 'ready', uid: u.uid })
        phaseAResolver?.()
        return
      }
      seededUids.add(u.uid)
      await finishPhaseA(u, pendingOpts)
      phaseAResolver?.()
    })
  }

  // If we have a pendingEmail and no current user, kick anon sign-in so the
  // listener above can fire. anonSignInStarted is single-shot per tab — once
  // it's been tried, we don't re-fire (sign-out followed by sign-in-with-Google
  // doesn't need anon sign-in).
  if (!auth.currentUser && opts?.pendingEmail && !anonSignInStarted) {
    anonSignInStarted = true
    try {
      await signInAnonymously(auth)
    } catch (err) {
      anonSignInStarted = false
      throw err
    }
  }

  return phaseAPromise
}

async function finishPhaseA(
  u: { uid: string; email: string | null; displayName: string | null },
  opts?: { pendingEmail?: string; pendingName?: string },
) {
  try {
    const email = opts?.pendingEmail ?? u.email ?? ''
    // Google sign-in carries the user's displayName via the OAuth profile;
    // anon-auth doesn't, but the email-path SandboxLogin can pass one in
    // via opts.pendingName. We capture whichever is available so Stage 2
    // (firstAction) can skip the Name input when we already know it.
    const name = opts?.pendingName ?? u.displayName ?? undefined
    set({ phase: 'seeding-a' })
    await runPhaseA({ uid: u.uid, email, name })
    set({ phase: 'ready', uid: u.uid })
  } catch (err) {
    set({ phase: 'errored', error: err as Error })
  }
}

/**
 * Watches for "wizards complete" — when setupCompleted && activeWorkflowIds is
 * non-empty — and triggers Phase B exactly once. Returns an unsubscribe.
 *
 * Should be mounted from a sandbox-only effect in App.tsx after the user is
 * authenticated.
 */
export function watchForPhaseB(): () => void {
  if (!IS_SANDBOX) return () => {}
  let cancelled = false
  // Track which uids we've already finished Phase B for in this tab. Sign-out
  // followed by sign-in-with-a-different-account leaves the same watcher
  // running; without this set the watcher would latch on the first uid and
  // never seed the second.
  const completedUids = new Set<string>()
  let inFlightUid: string | null = null

  const interval = setInterval(async () => {
    if (cancelled) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    if (completedUids.has(uid) || inFlightUid) return
    try {
      if (await shouldRunPhaseB()) {
        inFlightUid = uid
        set({ phase: 'seeding-b' })
        await runPhaseB()
        completedUids.add(uid)
        inFlightUid = null
        set({ phase: 'rich-ready', uid })
      }
    } catch (err) {
      set({ phase: 'errored', error: err as Error })
      // Mark this uid as completed-with-error so we don't retry forever;
      // a manual reset from the sandbox menu wipes _meta and lets a fresh
      // Phase B attempt fire on the next sign-in cycle.
      completedUids.add(uid)
      inFlightUid = null
    }
  }, 1500)

  return () => {
    cancelled = true
    clearInterval(interval)
  }
}
