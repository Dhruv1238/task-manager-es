/**
 * Stack capture policy for the usage watchdog — pure, no firebase imports.
 *
 * A raw `new Error().stack` costs ~5-30µs plus string materialization; at
 * spike rates (hundreds of snapshot deliveries/sec) capturing every read is
 * unaffordable. Policy: writes and subscribes always capture (rare, and
 * subscribes are the churn signature we most need stacks for); reads sample
 * 1-in-N, escalating to every-op once the collection is "hot" (past
 * HOT_MODE_FRACTION of its threshold). Snapshot DELIVERIES must be given the
 * SUBSCRIBE-time stack held in the listener closure — a delivery's own stack
 * bottoms out in SDK scheduler frames and names nothing.
 */
import { FS_USAGE } from './thresholds'

let readCounter = 0

export function shouldCaptureReadStack(hot: boolean): boolean {
  if (hot) return true
  readCounter = (readCounter + 1) % FS_USAGE.READ_STACK_SAMPLE_ONE_IN
  return readCounter === 0
}

/**
 * Capture and trim the current stack: drop the Error header, drop our own
 * wrapper frames where we can identify them, keep the top STACK_FRAMES,
 * truncate each line. Returns undefined when stacks are unavailable.
 *
 * The name filter below only matches in DEV (Vite serves per-file URLs). A
 * production build minifies identifiers and bundles everything into one
 * chunk, so no frame matches and the first 2-3 entries are our own wrappers.
 * We deliberately do NOT compensate by skipping a fixed frame count — the
 * minifier may inline the wrappers, and over-skipping would discard the very
 * app call site the report exists to capture. Budgeting a few extra frames
 * is the cheap, safe trade instead.
 */
export function captureStack(): string | undefined {
  const raw = new Error().stack
  if (!raw) return undefined
  return trimStack(raw)
}

export function trimStack(raw: string): string {
  const lines = raw
    .split('\n')
    .slice(1) // drop "Error"
    .filter((l) => !/fsIntercept|fsUsage/.test(l)) // dev only; see note above
    .slice(0, FS_USAGE.STACK_FRAMES)
    .map((l) => l.trim().slice(0, FS_USAGE.STACK_FRAME_MAX_CHARS))
  return lines.join('\n')
}
