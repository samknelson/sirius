import { describe, expect, it } from "vitest";
import { isMetadataTableEligible } from "../server/storage/system/entity-metadata-policy";

describe("entity metadata eligibility", () => {
  it.each([
    "ledger",
    "ledger_accounts",
    "ledger_payment_batches",
    "winston_logs",
    "cron_job_runs",
    "worker_msh_denorm",
    "worker_dispatch_elig_denorm_denorm_id",
  ])("rejects process table %s", (tableName) => {
    expect(isMetadataTableEligible(tableName)).toBe(false);
  });

  it.each([
    "auth_identities",
    "bulk_participants",
    "comm",
    "event_occurrences",
    "grievance_status_history",
    "sessions",
    "snapshots",
    "trust_wmb",
    "worker_aat",
    "worker_dispatch_status",
    "worker_msh",
    "worker_wsh",
  ])("rejects explicitly excluded table %s", (tableName) => {
    expect(isMetadataTableEligible(tableName)).toBe(false);
  });

  it.each([
    "bulk_messages",
    "companies",
    "contacts",
    "entity_files",
    "entity_notes",
    "employer_policy_history",
    "plugin_configs",
    "policies",
    "users",
    "workers",
  ])("keeps directly maintained table %s eligible", (tableName) => {
    expect(isMetadataTableEligible(tableName)).toBe(true);
  });

  it("applies the denorm rule to future table names without a registry update", () => {
    expect(isMetadataTableEligible("future_feature_denorm_cache")).toBe(false);
  });
});