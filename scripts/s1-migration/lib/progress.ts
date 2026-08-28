import { getEnvironmentVariable } from "./script-env";

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
 *  - Row-loop form:   `  progress <label>: done=N/M (P%) elapsed=Es rate=R rows/s eta=E`
 *    (the verb is `staged=` for the extractor, for output compatibility).
 *  - Named phases come in three forms:
 *      phase(name)         — silent phase (single set-based query, unknown
 *                            span): ticks emit a liveness line
 *                            `  progress <label>: phase=<name> done=N/M elapsed=Es rate=R rows/s eta=E (liveness)`
 *                            so a hung connection is distinguishable from a
 *                            slow healthy phase. add()/update() still apply
 *                            to the MAIN counter (pre-2026-08 behavior);
 *                            rate/eta come from the MAIN counter and are
 *                            omitted when the total is unknown or nothing
 *                            has completed yet.
 *      phase(name, total)  — counted phase (verify loops etc.): starts a
 *                            fresh per-phase counter; add()/update() apply to
 *                            IT, and ticks emit real progress
 *                            `  progress <label>: phase=<name> done=N/M (P%) elapsed=Es rate=R rows/s eta=E`
 *                            with rate computed from the phase's own start.
 *      phase(name, total, { cumulative: true })
 *                          — cumulative counted phase: re-entering the same
 *                            name ACCUMULATES done/total and in-phase active
 *                            time across stints, so rate/ETA report true
 *                            phase-local throughput even when the phase is
 *                            interleaved with others (e.g. a write flush
 *                            every N scanned rows). `stats(name)` exposes
 *                            the accumulated counters for run reports.
 *  - `eta=` is remaining/rate formatted `2h05m` / `12m30s` / `45s`; omitted
 *    when the rate is 0 or the total is unknown.
 *    `phase(null)` returns to the row-loop form and the main counter.
 *  - Silent for runs that finish inside the first interval, so small-volume
 *    output is unchanged. The timer is unref()'d and stop()'d by callers, so
 *    it never keeps the process alive.
 */

/** ` eta=2h05m` / ` eta=12m30s` / ` eta=45s`, or "" when unknowable. */
function etaSuffix(remaining: number, ratePerSec: number): string {
  if (!(ratePerSec > 0) || !(remaining > 0)) return "";
  const s = Math.round(remaining / ratePerSec);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return ` eta=${h}h${String(m).padStart(2, "0")}m`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return ` eta=${m}m${String(rest).padStart(2, "0")}s`;
  }
  return ` eta=${s}s`;
}

const PROGRESS_INTERVAL_MS = (() => {
  const n = Number(getEnvironmentVariable("S1_PROGRESS_INTERVAL_MS") ?? "");
  return Number.isInteger(n) && n > 0 ? n : 60_000;
})();

export interface ProgressLogger {
  /** Record the latest successfully completed count (absolute). Applies to the
   * current counted/cumulative phase when one is active, else the main counter. */
  update(done: number): void;
  /** Increment the completed count (per-row convenience). Applies to the
   * current counted/cumulative phase when one is active, else the main counter. */
  add(n?: number): void;
  /**
   * Enter a named phase. With `total`, the phase gets its own counter and
   * ticks report real progress; without, ticks are liveness-only and
   * add()/update() keep mutating the main counter. With
   * `{ cumulative: true }`, re-entering the same name accumulates
   * done/total/active-time across stints. `null` returns to rows.
   */
  phase(name: string | null, total?: number, opts?: { cumulative?: boolean }): void;
  /**
   * Set/replace the MAIN counter's total. Lets a loader start the heartbeat
   * BEFORE the staged load (when the total is still unknown, pass 0 at
   * construction) and fill it in once counted — the pre-scan stretch then
   * still emits liveness ticks instead of silence.
   */
  setTotal(total: number): void;
  /**
   * Accumulated counters for a cumulative phase (in-phase active seconds
   * include the current stint when the phase is active). Undefined for names
   * never entered cumulatively — callers use this for run-report phase
   * stats (throughput per phase, not per wall clock).
   */
  stats(name: string): { done: number; total: number; activeSeconds: number } | undefined;
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
  // Cumulative phases: per-name accumulators surviving re-entry.
  interface CumulRec {
    done: number;
    total: number;
    activeMs: number;
  }
  const cumul = new Map<string, CumulRec>();
  let activeCumul: CumulRec | null = null;
  let cumulEnteredAt = start;
  const leaveCumul = () => {
    if (activeCumul) {
      activeCumul.activeMs += Date.now() - cumulEnteredAt;
      activeCumul = null;
    }
  };
  const timer = setInterval(() => {
    const now = Date.now();
    const elapsed = Math.round((now - start) / 1000);
    if (currentPhase) {
      if (activeCumul) {
        const rec = activeCumul;
        const activeS = (rec.activeMs + (now - cumulEnteredAt)) / 1000;
        const exactRate = activeS > 0 ? rec.done / activeS : 0;
        const rate = Math.round(exactRate);
        const pct = rec.total > 0 ? ` (${((rec.done / rec.total) * 100).toFixed(1)}%)` : "";
        const eta = etaSuffix(rec.total - rec.done, exactRate);
        console.log(
          `  progress ${label}: phase=${currentPhase} ${verb}=${rec.done}/${rec.total}${pct} elapsed=${elapsed}s rate=${rate} rows/s${eta}`,
        );
      } else if (phaseTotal != null) {
        const phaseElapsedS = (now - phaseStart) / 1000;
        const exactRate = phaseElapsedS > 0 ? phaseDone / phaseElapsedS : 0;
        const rate = Math.round(exactRate);
        const pct = phaseTotal > 0 ? ` (${((phaseDone / phaseTotal) * 100).toFixed(1)}%)` : "";
        const eta = etaSuffix(phaseTotal - phaseDone, exactRate);
        console.log(
          `  progress ${label}: phase=${currentPhase} ${verb}=${phaseDone}/${phaseTotal}${pct} elapsed=${elapsed}s rate=${rate} rows/s${eta}`,
        );
      } else {
        const counted = total > 0 ? `${done}/${total}` : `${done}`;
        const elapsedS = (now - start) / 1000;
        const exactRate = elapsedS > 0 ? done / elapsedS : 0;
        const speed =
          done > 0 && total > 0
            ? ` rate=${Math.round(exactRate)} rows/s${etaSuffix(total - done, exactRate)}`
            : "";
        console.log(
          `  progress ${label}: phase=${currentPhase} ${verb}=${counted} elapsed=${elapsed}s${speed} (liveness)`,
        );
      }
      return;
    }
    const elapsedS = (now - start) / 1000;
    const exactRate = elapsedS > 0 ? done / elapsedS : 0;
    const rate = Math.round(exactRate);
    const pct = total > 0 ? ` (${((done / total) * 100).toFixed(1)}%)` : "";
    const counted = total > 0 ? `${done}/${total}` : `${done}`;
    const eta = total > 0 ? etaSuffix(total - done, exactRate) : "";
    console.log(
      `  progress ${label}: ${verb}=${counted}${pct} elapsed=${elapsed}s rate=${rate} rows/s${eta}`,
    );
  }, PROGRESS_INTERVAL_MS);
  timer.unref();
  return {
    update(n: number) {
      if (activeCumul) activeCumul.done = n;
      else if (currentPhase && phaseTotal != null) phaseDone = n;
      else done = n;
    },
    add(n = 1) {
      if (activeCumul) activeCumul.done += n;
      else if (currentPhase && phaseTotal != null) phaseDone += n;
      else done += n;
    },
    phase(name: string | null, phaseTotalArg?: number, phaseOpts?: { cumulative?: boolean }) {
      leaveCumul();
      currentPhase = name;
      if (name != null && phaseOpts?.cumulative) {
        let rec = cumul.get(name);
        if (!rec) {
          rec = { done: 0, total: 0, activeMs: 0 };
          cumul.set(name, rec);
        }
        if (phaseTotalArg != null) rec.total += phaseTotalArg;
        activeCumul = rec;
        cumulEnteredAt = Date.now();
        phaseTotal = null;
        phaseDone = 0;
        phaseStart = cumulEnteredAt;
        return;
      }
      phaseTotal = name != null && phaseTotalArg != null ? phaseTotalArg : null;
      phaseDone = 0;
      phaseStart = Date.now();
    },
    setTotal(n: number) {
      total = n;
    },
    stats(name: string) {
      const rec = cumul.get(name);
      if (!rec) return undefined;
      const activeMs = rec.activeMs + (activeCumul === rec ? Date.now() - cumulEnteredAt : 0);
      return { done: rec.done, total: rec.total, activeSeconds: activeMs / 1000 };
    },
    stop() {
      leaveCumul();
      clearInterval(timer);
    },
  };
}
