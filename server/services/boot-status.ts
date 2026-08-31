/**
 * Boot-status registry.
 *
 * A tiny, dependency-free module that boot-time services write into and the
 * boot-status HTTP surface (`server/services/boot-status-http.ts`) reads
 * from. It MUST stay free of imports (no logger, no db, no shared/schema) so
 * the entry points can import it before DATABASE_URL is assembled and
 * regardless of whether app-init ever loaded successfully.
 */

export type DriftCheckStatus = "not-run" | "passed" | "skipped" | "failed";

/**
 * Which state this process's boot is actually in.
 *
 * The distinction is the whole point: "starting" is a state that will change
 * on its own, while "init-failed" and "report-only" never will. Telling an
 * operator to wait for one of the latter two is a lie, and it is the lie
 * that left a wedged deployment undiagnosed.
 *
 *   - "starting"    — bootstrap is still running; retrying may succeed.
 *   - "ready"       — bootstrap finished; the application serves traffic.
 *   - "init-failed" — bootstrap threw. Permanent for this process.
 *   - "report-only" — BRINGUP_REPORT_ONLY=1 stopped the boot on purpose.
 *                     Not a failure; the report is the deliverable.
 */
export type BootPhase = "starting" | "ready" | "init-failed" | "report-only";

/**
 * What stopped the boot, for the health endpoint.
 *
 * A deployment blocked on migrations or drift is a different operational
 * situation from an ordinary startup failure: it means the image is fine and
 * the DATABASE is the problem, which is what the operator has to know before
 * they can decide between redeploying, setting a recovery variable, or
 * shipping a baseline.
 */
export type BootBlockedOn =
  | "none"
  | "database"
  | "migrations"
  | "drift"
  | "report-only"
  // Waited out the whole deadline for the schema bring-up lock: another
  // process is holding it, or held it and died without releasing. NOT a
  // schema problem — the image and the database may both be fine.
  | "bringup-lock"
  // Another process ran the bring-up while we waited, and ITS run failed.
  // Re-applying what it just failed at would only reproduce its error, so
  // this process refuses instead; the peer's failure is the thing to fix.
  | "peer-bringup"
  | "other";

/**
 * How this process's schema bring-up related to the OTHER processes booting
 * against the same database (Task #1350).
 *
 * A rollout restarts the UI and API services simultaneously, so "I ran the
 * bring-up" and "I watched another task run it" are routinely both true of a
 * successful deploy. They must not look identical afterwards: when a task
 * never becomes ready, the first question is whether it was doing the work or
 * waiting on someone else who was.
 */
export type BringUpConcurrency =
  /** Bring-up has not reached the lock yet. */
  | "not-run"
  /** Report-only dry run: writes nothing, so it takes no lock. */
  | "unlocked-report-only"
  /** Took the lock uncontended — this process did the work alone. */
  | "sole"
  /** Waited for another task, then still had work of its own to do. */
  | "waited-and-proceeded"
  /** Waited for another task, which succeeded and left the schema current. */
  | "deferred-to-peer"
  /** Waited for another task, whose bring-up FAILED. */
  | "peer-failed"
  /** Gave up waiting for the lock. */
  | "lock-timeout";
export const bootStatus: {
  driftCheck: DriftCheckStatus;
  blockedOn: BootBlockedOn;
  bringUpConcurrency: BringUpConcurrency;
  phase: BootPhase;
  /**
   * The error that ended the boot, in BOTH the failed and the report-only
   * phase (report-only stops by throwing a named error). Held so the HTTP
   * surface can expose its message/stack under EXPOSE_BOOT_ERRORS.
   */
  initError: Error | null;
} = {
  driftCheck: "not-run",
  blockedOn: "none",
  bringUpConcurrency: "not-run",
  phase: "starting",
  initError: null,
};

/** Bootstrap finished; the application is serving. */
export function markBootReady(): void {
  bootStatus.phase = "ready";
}

/**
 * Bootstrap threw. Permanent for this process: the entry points deliberately
 * keep serving instead of exiting, so the failure stays observable over HTTP
 * rather than crash-looping the container.
 */
export function markBootFailed(error: Error): void {
  bootStatus.phase = "init-failed";
  bootStatus.initError = error;
}

/**
 * BRINGUP_REPORT_ONLY=1 stopped the boot after producing the report. The
 * process did exactly what it was told; nothing was written and nothing will
 * change without a redeploy that drops the variable.
 */
export function markBootReportOnly(error: Error): void {
  bootStatus.phase = "report-only";
  bootStatus.initError = error;
}
