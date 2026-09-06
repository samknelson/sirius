/**
 * The product boundary for record history.
 *
 * Entity metadata is for records a person directly maintains, not for
 * operational output that happens to have a UUID. Keep this module free of
 * database and registry imports so both the write path and the admin registry
 * can enforce the same decision without creating an import cycle.
 */

/** Process-owned tables that are not covered by a name pattern. */
export const EXCLUDED_METADATA_TABLES = [
  "auth_identities",
  "bulk_participants",
  "comm",
  "comm_tags",
  "cron_job_runs",
  "esigs",
  "event_occurrences",
  "event_participants",
  "grievance_status_history",
  "sessions",
  "snapshots",
  "trust_wmb",
  "worker_aat",
  "worker_msh",
  "worker_wsh",
  "winston_logs",
  "worker_dispatch_asi",
  "worker_dispatch_department",
  "worker_dispatch_dnc",
  "worker_dispatch_eba",
  "worker_dispatch_hfe",
  "worker_dispatch_status",
] as const;

const excludedMetadataTables = new Set<string>(EXCLUDED_METADATA_TABLES);

/**
 * Whether a table is allowed to own an entity-metadata row.
 *
 * Ledger and denormalized tables are families, so they are rejected by name
 * rather than by an exhaustively maintained list. The explicit set covers
 * other process-owned tables whose names are not reliably distinctive.
 */
export function isMetadataTableEligible(tableName: string): boolean {
  const lowerName = tableName.toLowerCase();
  return (
    !lowerName.includes("ledger") &&
    !lowerName.includes("denorm") &&
    !excludedMetadataTables.has(lowerName)
  );
}