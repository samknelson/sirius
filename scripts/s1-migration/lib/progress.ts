/**
 * Shared timer-backed progress heartbeat for the S1 migration — used by the
 * staging extractor AND the long-running loaders.
 *
 * AGGREGATES ONLY: counts, elapsed seconds, rows/s — never row content,
 * names, or nids beyond counts (HIPAA boundary; heartbeat lines land in the
 * ECS task's CloudWatch stream).
 *
 * Behavior:
 *  - Emits at most one line per interval (default 60s, override via
 *    S1_PROGRESS_INTERVAL_MS — test/dev only). The timer fires even while a
 *    single slow batch (query/write/verify) is still awaited, reporting the
 *    last completed count — so silence really does mean hung, not merely
 *    slow.
 *  - Row-loop form:   `  progress <label>: done=N/M (P%) elapsed=Es rate=R rows/s`
 *    (the verb is `staged=` for the extractor, for output compatibility).
 *  - Silent phases (pre-scan, verify, flush, …) set `phase(name)`; ticks
 *    then emit a distinct liveness line
 *    `  progress <label>: phase=<name> done=N/M elapsed=Es (liveness)`
 *    so a hung connection is distinguishable from a slow healthy phase.
 *    `phase(null)` returns to the row-loop form.
 *  - Silent for runs that finish inside the first interval, so small-volume
 *    output is unchanged. The timer is unref()'d and stop()'d by callers, so
 *    it never keeps the process alive.
 */

const PROGRESS_INTERVAL_MS = (() => {
  const n = Number(process.env.S1_PROGRESS_INTERVAL_MS ?? "");
  return Number.isInteger(n) && n > 0 ? n : 60_000;
})();

export interface ProgressLogger {
  /** Record the latest successfully completed count (absolute). */
  update(done: number): void;
  /** Increment the completed count (per-row convenience). */
  add(n?: number): void;
  /** Enter a named silent phase (liveness ticks); `null` returns to rows. */
  phase(name: string | null): void;
  /** Stop the heartbeat timer — call when the loop is done. */
  stop(): void;
}

export function makeProgressLogger(
  label: string,
  total: number,
  opts?: { verb?: string },
): ProgressLogger {
  const verb = opts?.verb ?? "done";
  const start = Date.now();
  let done = 0;
  let currentPhase: string | null = null;
  const timer = setInterval(() => {
    const elapsedS = (Date.now() - start) / 1000;
    const elapsed = Math.round(elapsedS);
    if (currentPhase) {
      console.log(
        `  progress ${label}: phase=${currentPhase} ${verb}=${done}/${total} elapsed=${elapsed}s (liveness)`,
      );
      return;
    }
    const rate = elapsedS > 0 ? Math.round(done / elapsedS) : 0;
    const pct = total > 0 ? ` (${((done / total) * 100).toFixed(1)}%)` : "";
    console.log(
      `  progress ${label}: ${verb}=${done}/${total}${pct} elapsed=${elapsed}s rate=${rate} rows/s`,
    );
  }, PROGRESS_INTERVAL_MS);
  timer.unref();
  return {
    update(n: number) {
      done = n;
    },
    add(n = 1) {
      done += n;
    },
    phase(name: string | null) {
      currentPhase = name;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
