import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "scripts/migrate/core/1194_unify_ledger_payment_attachments.ts",
);
const source = readFileSync(migrationPath, "utf8");

describe("ledger payment attachment cutover migration", () => {
  it("runs the adoption and retirement in one database transaction", () => {
    expect(source).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    expect(source).toContain("INSERT INTO entity_files");
    expect(source).toContain("ALTER TABLE ledger_payments DROP COLUMN IF EXISTS attachment_file_id");
    expect(source).toContain("ALTER TABLE ledger_payment_batches DROP COLUMN IF EXISTS attachment_file_id");
  });

  it("explicitly guards the optional payment-batch table before querying it", () => {
    expect(source).toContain('const hasBatchesTable = await tableExists("ledger_payment_batches", tx)');
    expect(source).toMatch(
      /hasBatchesTable\s*&&\s*\(await columnExists\(tx, "ledger_payment_batches", "attachment_file_id"\)\)/,
    );
    expect(source).toMatch(
      /if \(sources\.some\(\(s\) => s\.table === "ledger_payment_batches"\)\) \{\s*const rows = await tx\.execute\(sql`[\s\S]*?FROM ledger_payment_batches/,
    );
  });

  it("is rerunnable and preserves file identity and storage metadata", () => {
    expect(source).toContain("ON CONFLICT (file_id) DO NOTHING");
    expect(source).toContain("SET entity_type =");
    expect(source).toContain("entity_id =");
    expect(source).not.toMatch(/UPDATE files[\s\S]*storage_path/);
    expect(source).not.toMatch(/UPDATE files[\s\S]*file_system_id/);
  });

  it("rejects missing, shared, and conflicting ownership before destructive DDL", () => {
    expect(source).toContain("referenced by multiple legacy records");
    expect(source).toContain("points to missing file");
    expect(source).toContain("entity_files already owns it");
    expect(source).toContain("files ownership metadata");
    const validationEnd = source.indexOf("for (const ref of refs) {\n      await tx.execute(sql`");
    const dropStart = source.indexOf("// Drop the old FKs explicitly");
    expect(validationEnd).toBeGreaterThan(-1);
    expect(dropStart).toBeGreaterThan(validationEnd);
  });

  it("proves each legacy reference is represented before dropping columns", () => {
    expect(source).toContain("was not represented in entity_files");
    expect(source).toContain("WHERE context_id =");
    expect(source).toContain("WHERE id =");
  });
});