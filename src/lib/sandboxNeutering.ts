/**
 * Wrappers for external-effect operations that must be no-oped in sandbox
 * builds. Keeps production call paths untouched: each surface checks IS_SANDBOX
 * and short-circuits when true.
 *
 * The current codebase doesn't yet have email-send / invite-teammate / CSV-
 * export features, so most wrappers here are scaffolds. They become live the
 * day those features land. The discipline is: any new external integration
 * routes through one of these helpers.
 */

import { IS_SANDBOX } from './firestore'

interface ToastSink {
  show: (msg: string) => void
}

let toastSink: ToastSink | null = null

/** Register a UI toast handler so neutered ops can surface a friendly notice. */
export function setSandboxToastSink(sink: ToastSink | null) {
  toastSink = sink
}

function notice(msg: string) {
  if (toastSink) toastSink.show(msg)
  else if (typeof console !== 'undefined') console.info(`[sandbox] ${msg}`)
}

/** Email send wrapper. In production, run `actual`. In sandbox, no-op + toast. */
export async function sendEmail<T>(
  recipient: string,
  subject: string,
  actual: () => Promise<T>,
): Promise<T | null> {
  if (IS_SANDBOX) {
    notice(`Email would have been sent to ${recipient}: "${subject}"`)
    return null
  }
  return actual()
}

/** Invite-teammate wrapper. In sandbox, simulate success. */
export async function inviteTeammate<T>(
  email: string,
  actual: () => Promise<T>,
): Promise<T | null> {
  if (IS_SANDBOX) {
    notice(`Invite to ${email} simulated — sandbox doesn't send real invites.`)
    return null
  }
  return actual()
}

/** Webhook fire wrapper. In sandbox, no-op + console log. */
export async function fireWebhook<T>(
  url: string,
  actual: () => Promise<T>,
): Promise<T | null> {
  if (IS_SANDBOX) {
    if (typeof console !== 'undefined') console.log(`[sandbox] webhook skipped: ${url}`)
    return null
  }
  return actual()
}
