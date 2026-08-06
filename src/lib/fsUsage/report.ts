/**
 * Firestore usage watchdog — the report writer. The ONLY fsUsage module that
 * touches Firestore, and it is loaded exclusively by dynamic import from
 * breaker.ts at trip time (never in the static module graph, so it can't
 * cycle with firebase.ts / firestore.ts, both long-initialized by then).
 *
 * RECURSION SAFETY IS STRUCTURAL, and it must stay that way:
 *  - `doc`/`setDoc`/`serverTimestamp` are imported straight from
 *    '@firebase/firestore', NOT through the aliased wrapper, so this write is
 *    invisible to the counters.
 *  - `tenantCol` builds its ref with `collection()`, which fsIntercept does
 *    not override, so that is uncounted too.
 * Do NOT "add a runtime guard flag" here as belt-and-braces: an earlier
 * version set a module flag across the awaited setDoc, and because a Firestore
 * write promise only settles on server ACK, going offline mid-report left the
 * flag stuck on forever — which silently disabled ALL counting exactly when
 * the client was in trouble. If you change the imports above, fix the imports.
 *
 * Never throws: every failure resolves to a ReportOutcome; the breaker
 * decides what (if anything) to do with it.
 */
import { doc, setDoc, serverTimestamp } from '@firebase/firestore'
import { FS_USAGE } from './thresholds'
import { consumeReportSlot, type TripInfo } from './breaker'

export type ReportOutcome = 'written' | 'no-auth' | 'cooldown' | 'failed'

export async function writeReport(info: TripInfo): Promise<ReportOutcome> {
  try {
    const { auth } = await import('../firebase')
    const user = auth.currentUser
    if (!user) return 'no-auth'
    if (!consumeReportSlot(user.uid, info.collection)) return 'cooldown'

    const { tenantCol } = await import('../firestore')

    const payload = {
      uid: user.uid,
      sessionId: info.sessionId,
      collection: info.collection,
      reason: info.reason,
      windowCounts: info.windowCounts,
      globalCounts: info.globalCounts,
      topCollections: info.topCollections,
      route: typeof window !== 'undefined' ? window.location.pathname : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    }
    // Trim samples until the payload fits comfortably under MAX_REPORT_BYTES
    // (itself far under Firestore's 1MiB doc limit). Drop oldest first.
    let samples = info.samples.map((s) => ({
      op: s.op,
      path: s.path,
      tMs: s.tMs,
      ...(s.stack ? { stack: s.stack } : {}),
    }))
    while (
      samples.length > 0 &&
      JSON.stringify({ ...payload, samples }).length > FS_USAGE.MAX_REPORT_BYTES
    ) {
      samples = samples.slice(1)
    }

    await setDoc(doc(tenantCol('clientOpsReports')), {
      ...payload,
      samples,
      createdAt: serverTimestamp(),
    })
    return 'written'
  } catch (err) {
    // Surfaced, not swallowed: the most likely cause is a rules/permission
    // problem on the new clientOpsReports collection, which would otherwise
    // make the watchdog look like it simply never trips.
    console.warn('[fsUsage] report write failed', err)
    return 'failed'
  }
}
