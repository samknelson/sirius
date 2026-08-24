/**
 * Boot-status registry.
 *
 * A tiny, dependency-free module that boot-time services write into and the
 * production entry point's /health endpoint reads from. It MUST stay free of
 * imports (no logger, no db, no shared/schema) so `production-entry.ts` can
 * import it before DATABASE_URL is assembled and regardless of whether
 * app-init ever loaded successfully.
 */

export type DriftCheckStatus = "not-run" | "passed" | "skipped" | "failed";

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
  | "other";

export const bootStatus: {
  driftCheck: DriftCheckStatus;
  blockedOn: BootBlockedOn;
} = {
  driftCheck: "not-run",
  blockedOn: "none",
};
