/**
 * Reads the public `/sandboxConfig/main` beacon doc at sandbox boot. Two jobs:
 *
 *   1. Surface the Calendly URL + contact email so capture modals don't hard-
 *      code them.
 *   2. Cross-env paranoia check: if a sandbox build accidentally connects to a
 *      production Firebase project, the doc won't exist (or will have
 *      `isSandbox !== true`). `loadSandboxConfig` rejects, and the App-level
 *      paranoia gate refuses to render — see CrossEnvGuard.
 */

import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { SandboxConfig } from '../types/sandbox'
import { IS_SANDBOX } from './firestore'

// Top-level (non-tenant-prefixed) ref. Same as `/leads/{uid}`, the sandboxConfig
// doc lives at the root of the sandbox Firebase. ESLint exemption noted.
function sandboxConfigDocRef() {
  // eslint-disable-next-line no-restricted-syntax -- public sandbox beacon doc, never tenant-prefixed
  return doc(db, 'sandboxConfig', 'main')
}

export async function loadSandboxConfig(): Promise<SandboxConfig> {
  if (!IS_SANDBOX) {
    throw new Error('loadSandboxConfig called outside a sandbox build')
  }
  const snap = await getDoc(sandboxConfigDocRef())
  if (!snap.exists()) {
    throw new Error(
      'Sandbox misconfiguration: /sandboxConfig/main not found. This build expected to connect to the sandbox Firebase project but found a different environment.',
    )
  }
  const data = snap.data() as Partial<SandboxConfig>
  if (data.isSandbox !== true) {
    throw new Error(
      'Sandbox misconfiguration: /sandboxConfig/main.isSandbox is not true. Refusing to render.',
    )
  }
  return {
    isSandbox: true,
    banner: data.banner ?? "You're in sandbox mode",
    contactEmail: data.contactEmail ?? 'hello@example.com',
    calendlyUrl: data.calendlyUrl,
  }
}
