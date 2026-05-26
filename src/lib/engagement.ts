/**
 * Visitor engagement tracking. A heartbeat increments _meta.totalActiveSeconds
 * while the tab is visible; action events append to actionsCompleted.
 *
 * Both signals are mirrored to /leads/{uid} on a debounced cadence so sales
 * sees activity in near-real-time without burning Firestore writes.
 */

import { getDoc, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore'
import { auth } from './firebase'
import { IS_SANDBOX, tenantDoc } from './firestore'
import { mirrorEngagement } from './leadCapture'
import type { SandboxMeta } from '../types/sandbox'

const HEARTBEAT_MS = 10_000
const SESSION_CAP_S = 5 * 3600 // 5 hours; prevent runaway counters
const MIRROR_DEBOUNCE_MS = 60_000

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let mirrorTimer: ReturnType<typeof setTimeout> | null = null
let isVisible = typeof document === 'undefined' ? true : !document.hidden
let pendingActions: string[] = []
let cachedMeta: SandboxMeta | null = null

function uid(): string | null {
  return auth.currentUser?.uid ?? null
}

async function loadMeta(): Promise<SandboxMeta | null> {
  if (cachedMeta) return cachedMeta
  const u = uid()
  if (!u) return null
  const snap = await getDoc(tenantDoc('_meta', 'main'))
  if (!snap.exists()) return null
  cachedMeta = snap.data() as SandboxMeta
  return cachedMeta
}

async function scheduleMirror() {
  if (mirrorTimer) return
  mirrorTimer = setTimeout(async () => {
    mirrorTimer = null
    const meta = await loadMeta()
    const u = uid()
    if (!meta || !u) return
    await mirrorEngagement({
      uid: u,
      engagementMinutes: Math.round(meta.engagement.totalActiveSeconds / 60),
      actionsCompleted: meta.engagement.actionsCompleted,
      tourCompleted: Boolean(meta.tourProgress?.completedAt),
      sessionsCount: meta.sessionsCount,
    })
  }, MIRROR_DEBOUNCE_MS)
}

async function heartbeat() {
  if (!isVisible) return
  const u = uid()
  if (!u) return
  const meta = await loadMeta()
  if (!meta) return
  const seconds = meta.engagement.totalActiveSeconds + HEARTBEAT_MS / 1000
  if (seconds > SESSION_CAP_S) return
  cachedMeta = {
    ...meta,
    engagement: { ...meta.engagement, totalActiveSeconds: seconds },
  }
  await updateDoc(tenantDoc('_meta', 'main'), {
    'engagement.totalActiveSeconds': seconds,
    'engagement.lastActiveAt': serverTimestamp(),
  })
  scheduleMirror()
}

/** Start the heartbeat. Idempotent. */
export function startEngagementTracking(): () => void {
  if (!IS_SANDBOX) return () => {}
  if (heartbeatTimer) return () => {}
  if (typeof document !== 'undefined') {
    isVisible = !document.hidden
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
  return () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

function onVisibilityChange() {
  isVisible = !document.hidden
}

/** Record a named action. Adds to _meta + drains pending into the next mirror. */
export async function recordAction(action: string): Promise<void> {
  if (!IS_SANDBOX) return
  const u = uid()
  if (!u) return
  pendingActions.push(action)
  const meta = await loadMeta()
  if (meta) {
    cachedMeta = {
      ...meta,
      engagement: {
        ...meta.engagement,
        actionsCompleted: [...new Set([...meta.engagement.actionsCompleted, action])],
      },
    }
  }
  await updateDoc(tenantDoc('_meta', 'main'), {
    'engagement.actionsCompleted': arrayUnion(action),
    'engagement.lastActiveAt': serverTimestamp(),
  })
  pendingActions = []
  scheduleMirror()
}
