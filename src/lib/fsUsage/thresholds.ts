/**
 * Firestore usage watchdog — the single tuning surface.
 *
 * Context for the numbers: this tenant's ORG-WIDE organic load averages
 * ~100K reads/day (~70 reads/min across every connected client), yet we've
 * seen single-day spikes to 7.5M reads and hourly bursts of 396K reads /
 * 24K writes. One client sustaining any threshold below is anomalous by an
 * order of magnitude — but each is sized ABOVE a legitimate burst (a cold
 * boot snapshotting the whole users/projects collections, a team edit
 * recomputing access keys across its projects) so normal use cannot trip.
 *
 * No import may be added to this file — it is shared by the hot path and by
 * pure unit tests.
 */
export const FS_USAGE = {
  // ── Rolling window ─────────────────────────────────────────────────────
  WINDOW_MS: 60_000,
  SLOT_MS: 10_000, // 6 slots of 10s; advanced lazily inside recordOp — no timers

  // ── Trip thresholds (per client, per rolling minute) ───────────────────
  // Calibrated twice against real data:
  //  - the Aug-6 incident: ~400 writes+deltas/min from ONE client (a write
  //    loop fanned out over the users-collection listeners);
  //  - the healthiest busy day after the fixes (Aug 7): peak hour 24K reads /
  //    1.9K writes ORG-WIDE ≈ 400 reads/min + 32 writes/min across ~16-20
  //    concurrent clients, i.e. ~25 reads/min and ~2 writes/min PER CLIENT.
  // The gap between "busiest normal" and "incident" is ~15×, so thresholds
  // sit in the middle: several × above the busiest legitimate burst, well
  // under the incident shape.
  //
  // DELTAS is the sharpest instrument. It counts snapshot UPDATE DELIVERIES
  // (events), not documents:
  //   - a cold page load is ONE delivery carrying thousands of docs
  //     (AdminDashboard's useAllTasks reads the whole tasks collection) —
  //     large read count, 1 delta;
  //   - a write-loop fanned out over a collection listener is HUNDREDS of
  //     deliveries carrying one changed doc each.
  PER_COLLECTION_DELTAS_PER_MIN: 300, // incident ~400-600; busy normal ≤40
  GLOBAL_DELTAS_PER_MIN: 500,
  // Writes: ~2/min per client normally; the looping client hit ~400/min.
  // 150 also clears deliberate bulk ops (the accessKeys backfill stages up to
  // 200 batch writes per commit — a VERY large migration run may still log
  // one rate-limited report, which is acceptable visibility, not noise).
  PER_COLLECTION_WRITES_PER_MIN: 150,
  GLOBAL_WRITES_PER_MIN: 300,
  // Listener-churn storms — the signature of a dependency-array bug
  // re-mounting a collection listener. A project page mounts ~5 listeners on
  // 'projects'; 60 allows ~12 rapid page hops/min, churn bugs run hundreds.
  PER_COLLECTION_SUBS_PER_MIN: 60,
  // Only SERVER-served reads count here (cache deliveries don't bill); both
  // are reported. This is the blunt catch-all, NOT the diagnostic — it must
  // clear every legitimate single-shot scan: AdminDashboard's full-tasks
  // snapshot, the KPI page's auditEvents window, the backfill dry-run's
  // whole-collection getDocs (the source of the "for no reason" reports at
  // the old 900 bar). If auditEvents outgrows this, raise it again — deltas/
  // subs/writes above are what actually name leaks.
  PER_COLLECTION_SERVER_READS_PER_MIN: 3_000,
  GLOBAL_SERVER_READS_PER_MIN: 5_000,

  // ── Reporting (report-only breaker — no blocking, by decision) ─────────
  REPORT_COOLDOWN_PER_COLLECTION_MS: 10 * 60_000,
  MAX_REPORTS_PER_SESSION: 5,
  // A trip that fires before auth resolves can't write (tenantCol needs a
  // user); it logs to console only and re-arms after this much time.
  RETRY_UNREPORTED_TRIP_MS: 60_000,

  // ── Stack sampling ──────────────────────────────────────────────────────
  // new Error().stack per op is too hot at spike rates; writes + subscribes
  // are rare enough to always capture, reads are sampled — escalating to
  // every-op once a collection passes HOT_MODE_FRACTION of its threshold so
  // trip-time samples are dense exactly when they matter.
  READ_STACK_SAMPLE_ONE_IN: 25,
  HOT_MODE_FRACTION: 0.5,
  SAMPLE_RING_SIZE: 15,
  // Budgeted for 2-3 leading wrapper frames: in a minified production build
  // the name-based filter in stackSampler can't identify them (see the note
  // there), so the first few frames are ours and the app call site follows.
  STACK_FRAMES: 10,
  STACK_FRAME_MAX_CHARS: 200,
  MAX_REPORT_BYTES: 45_000,

  // NOTE — hard-block mode (refusing writes to a repeatedly-tripping
  // collection) was designed but deliberately NOT implemented: the breaker is
  // report-only by product decision. If ever revisited, remember that audit /
  // notification docs join primary writeBatches, so a staging-time throw on a
  // helper collection would abort whole composite operations (e.g. project
  // creation). Any future block needs an exempt list at minimum.
} as const
