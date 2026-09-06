import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = (name: string) =>
  readFileSync(join(process.cwd(), "scripts/migrate/core", name), "utf8");

describe("process-table provenance migrations", () => {
  it("does not let the historical retirement versions seed or drop excluded tables", () => {
    for (const name of [
      "1083_retire_ledger_provenance_columns.ts",
      "1084_seed_snapshot_provenance.ts",
      "1085_drop_snapshot_author_columns.ts",
      "1090_retire_auth_identity_timestamps.ts",
      "1098_seed_worker_status_history_provenance.ts",
      "1099_drop_worker_msh_created_at.ts",
    ]) {
      const source = migration(name);
      expect(source).not.toMatch(/entityMetadataSeed|DROP COLUMN/i);
      expect(source).toContain("registerMigration");
    }
  });

  it("repairs old names before deleting metadata and never adds a now default", () => {
    const source = migration("1103_remove_process_entity_metadata.ts");

    expect(source).toContain("ALTER TABLE snapshots RENAME COLUMN captured_at TO created_at");
    expect(source).toContain("ALTER TABLE snapshots RENAME COLUMN captured_by TO author_id");
    expect(source).toContain("ALTER TABLE ledger_payments RENAME COLUMN created_at TO date_created");
    expect(source).toContain("UPDATE ledger_payments p");
    expect(source).toContain("DELETE FROM entity_metadata");
    expect(source).not.toMatch(/ADD COLUMN [^;]+DEFAULT now\(\)/i);
  });

  it("keeps the follow-up migration non-destructive", () => {
    const source = migration("1104_own_process_capture_provenance.ts");
    expect(source).not.toMatch(/ALTER TABLE|ADD COLUMN|DROP COLUMN|DELETE FROM/i);
    expect(source).toContain("Compatibility no-op");
  });

  it("does not fabricate dates when repairing a database after old cleanup", () => {
    const source = migration("1106_restore_process_local_provenance.ts");

    expect(source).toContain("ALTER COLUMN created_at DROP NOT NULL");
    expect(source).toContain("ALTER COLUMN date_created DROP NOT NULL");
    expect(source).not.toMatch(/ADD COLUMN [^;]+DEFAULT now\(\)/i);
    expect(source).not.toMatch(/ADD COLUMN [^;]+NOT NULL/i);
  });

  it("makes already-restored process columns nullable without rewriting values", () => {
    const source = migration("1107_allow_unknown_process_provenance.ts");

    expect(source).toContain("ALTER COLUMN created_at DROP NOT NULL");
    expect(source).toContain("ALTER COLUMN date_created DROP NOT NULL");
    expect(source).not.toMatch(/DEFAULT now\(\)/i);
    expect(source).not.toMatch(/UPDATE |DELETE FROM /i);
  });
});