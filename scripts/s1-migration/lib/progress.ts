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
 *  - Named phases come in two forms:
 *      phase(name)         — silent phase (single set-based query, unknown
 *                            span): ticks emit a liveness line
 *                            `  progress <label>: phase=<name> done=N/M elapsed=Es (liveness)`
 *                            so a hung connection is distinguishable from a
 *                            slow healthy phase. add()/update() still apply
 *                            to the MAIN counter (pre-2026-08 behavior).
 *      phase(name, total)  — counted phase (verify loops etc.): starts a
 *                            fresh per-phase counter; add()/update() apply to
 *                            IT, and ticks emit real progress
 *                            `  progress <label>: phase=<name> done=N/M (P%) elapsed=Es rate=R rows/s`
 *                            with rate computed from the phase's own start.
 *    `phase(null)` returns to the row-loop form and the main counter.
 *  - Silent for runs that finish inside the first interval, so small-volume
 *    output is unchanged. The timer is unref()'d and stop()'d by callers, so
 *    it never keeps the process alive.
 */

const PROGRESS_INTERVAL_MS = (() => {
  const n = Number(process.env.S1_PROGRESS_INTERVAL_MS ?? "");
  return Number.isInteger(n) && n > 0 ? n : 60_000;
})();

export interface ProgressLogger {
  /** Record the latest successfully completed count (absolute). Applies to the
   * current counted phase when one is active, else the main counter. */
  update(done: number): void;
  /** Increment the completed count (per-row convenience). Applies to the
   * current counted phase when one is active, else the main counter. */
  add(n?: number): void;
  /**
   * Enter a named phase. With `total`, the phase gets its own counter and
   * ticks report real progress; without, ticks are liveness-only and
   * add()/update() keep mutating the main counter. `null` returns to rows.
   */
  phase(name: string | null, total?: number): void;
  /**
   * Set/replace the MAIN counter's total. Lets a loader start the heartbeat
   * BEFORE the staged load (when the total is still unknown, pass 0 at
   * construction) and fill it in once counted — the pre-scan stretch then
   * still emits liveness ticks instead of silence.
   */
  setTotal(total: number): void;
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
  let phaseTotal: number | null = null;
  let phaseDone = 0;
  let phaseStart = start;
  const timer = setInterval(() => {
    const now = Date.now();
    const elapsed = Math.round((now - start) / 1000);
    if (currentPhase) {
      if (phaseTotal != null) {
        const phaseElapsedS = (now - phaseStart) / 1000;
        const rate = phaseElapsedS > 0 ? Math.round(phaseDone / phaseElapsedS) : 0;
        const pct = phaseTotal > 0 ? ` (${((phaseDone / phaseTotal) * 100).toFixed(1)}%)` : "";
        console.log(
          `  progress ${label}: phase=${currentPhase} ${verb}=${phaseDone}/${phaseTotal}${pct} elapsed=${elapsed}s rate=${rate} rows/s`,
        );
      } else {
        const counted = total > 0 ? `${done}/${total}` : `${done}`;
        console.log(
          `  progress ${label}: phase=${currentPhase} ${verb}=${counted} elapsed=${elapsed}s (liveness)`,
        );
      }
      return;
    }
    const elapsedS = (now - start) / 1000;
    const rate = elapsedS > 0 ? Math.round(done / elapsedS) : 0;
    const pct = total > 0 ? ` (${((done / total) * 100).toFixed(1)}%)` : "";
    const counted = total > 0 ? `${done}/${total}` : `${done}`;
    console.log(
      `  progress ${label}: ${verb}=${counted}${pct} elapsed=${elapsed}s rate=${rate} rows/s`,
    );
  }, PROGRESS_INTERVAL_MS);
  timer.unref();
  return {
    update(n: number) {
      if (currentPhase && phaseTotal != null) phaseDone = n;
      else done = n;
    },
    add(n = 1) {
      if (currentPhase && phaseTotal != null) phaseDone += n;
      else done += n;
    },
    phase(name: string | null, phaseTotalArg?: number) {
      currentPhase = name;
      phaseTotal = name != null && phaseTotalArg != null ? phaseTotalArg : null;
      phaseDone = 0;
      phaseStart = Date.now();
    },
    setTotal(n: number) {
      total = n;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
