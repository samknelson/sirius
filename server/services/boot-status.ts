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

export const bootStatus: { driftCheck: DriftCheckStatus } = {
  driftCheck: "not-run",
};
