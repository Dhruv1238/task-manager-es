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
  // Calibrated against the real incident: 396K reads/hr org-wide across ~16
  // fan-out clients ≈ 400 reads/min PER CLIENT, versus ~22/min normal. The
  // original 1,500 bar would have missed it entirely on the read side.
  //
  // DELTAS is the sharpest instrument and the one that catches this exact
  // shape. It counts snapshot UPDATE DELIVERIES (events), not documents:
  //   - a cold page load is ONE delivery carrying thousands of docs
  //     (AdminDashboard's useAllTasks reads the whole tasks collection) —
  //     large read count, 1 delta;
  //   - a write-loop fanned out over a collection listener is HUNDREDS of
  //     deliveries carrying one changed doc each — 400 deltas.
  // So deltas separate "legitimately expensive" from "leaking" in a way raw
  // read counts cannot, which is why reads stay comparatively high (dropping
  // them far enough to catch 400/min would fire on every admin page load and
  // drown the signal in false positives).
  PER_COLLECTION_DELTAS_PER_MIN: 120, // vs ~400 in the incident, ~6-18 normal
  GLOBAL_DELTAS_PER_MIN: 200,
  // Writes have no legitimate sustained burst in this app (~1/min per client
  // normally; the looping client hit ~400/min), so this can be tight. Bulk
  // admin operations (migrations, a team edit recomputing access keys across
  // many projects) may trip it — that's report-only and worth knowing about.
  PER_COLLECTION_WRITES_PER_MIN: 40,
  GLOBAL_WRITES_PER_MIN: 100,
  // Listener-churn storms — the signature of a dependency-array bug
  // re-mounting a collection listener.
  PER_COLLECTION_SUBS_PER_MIN: 25,
  // Only SERVER-served reads count here (cache deliveries don't bill); both
  // are reported. Kept above the largest legitimate single-collection
  // snapshot; deltas above are the precision instrument.
  PER_COLLECTION_SERVER_READS_PER_MIN: 900,
  GLOBAL_SERVER_READS_PER_MIN: 2_500,

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
