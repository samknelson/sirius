/**
 * The product boundary for record history.
 *
 * Entity metadata is for records a person directly maintains, not for
 * operational output that happens to have a UUID. Keep this module free of
 * database and registry imports so both the write path and the admin registry
 * can enforce the same decision without creating an import cycle. (The
 * generated component metadata bridge holds only table declarations.)
 */
import { componentExcludedMetadataTables } from "../../generated/component-metadata";

/** Process-owned tables that must not receive record-history metadata. */
export const EXCLUDED_METADATA_TABLES = [
  "auth_identities",
  "bulk_participants",
  "comm",
  "comm_tags",
  "job_runs",
  "processes",
  "esigs",
  "event_occurrences",
  "event_participants",
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
  "ledger",
  "ledger_ea",
  "ledger_gateway_customers",
] as const;

// A component declares its own process tables from its metadata module, so
// the exclusion holds whether or not the component is enabled.
const excludedMetadataTables = new Set<string>([
  ...EXCLUDED_METADATA_TABLES,
  ...componentExcludedMetadataTables.map(name => name.toLowerCase()),
]);

/**
 * Whether a table is allowed to own an entity-metadata row.
 *
 * Denormalized tables are a family and are rejected by name. Ledger tables
 * are intentionally table-specific: maintained account/payment records are
 * eligible, while accounting entries and provider mappings are not.
 */
export function isMetadataTableEligible(tableName: string): boolean {
  const lowerName = tableName.toLowerCase();
  return (
    !lowerName.includes("denorm") &&
    !excludedMetadataTables.has(lowerName)
  );
}