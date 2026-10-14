import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const harness = vi.hoisted(() => ({
  migrations: new Map<number, () => Promise<void>>(),
  tables: new Set<string>(),
  legacyHasRows: false as boolean | undefined,
  statements: [] as string[],
}));

vi.mock("../../server/services/migration-runner", () => ({
  registerMigration: (migration: { version: number; up: () => Promise<void> }) => {
    harness.migrations.set(migration.version, migration.up);
  },
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../../server/db", () => ({
  db: {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const { sql: statement, params } = new PgDialect().sqlToQuery(query);
      harness.statements.push(statement);
      if (statement.includes("information_schema.tables")) {
        const exists = statement.includes("table_name IN")
          ? harness.tables.has("notes") || harness.tables.has("entity_notes")
          : harness.tables.has(String(params[0]));
        return { rows: [{ exists }] };
      }
      if (statement.includes("SELECT 1 FROM notes")) {
        return { rows: [{ has_rows: harness.legacyHasRows }] };
      }
      if (statement.includes("CREATE TABLE notes")) harness.tables.add("notes");
      if (statement.includes("ALTER TABLE notes RENAME TO entity_notes")) {
        harness.tables.delete("notes");
        harness.tables.add("entity_notes");
      }
      return { rows: [] };
    },
  },
}));

import "../../scripts/migrate/core/1058_create_notes";
import "../../scripts/migrate/core/1072_rename_notes_to_entity_notes";

describe("notes migrations after Publish installs the final schema", () => {
  beforeEach(() => {
    harness.tables = new Set();
    harness.legacyHasRows = false;
    harness.statements = [];
  });

  it("does not recreate the retired table when Publish already created entity_notes", async () => {
    harness.tables.add("entity_notes");
    await harness.migrations.get(1058)!();
    expect(harness.tables.has("notes")).toBe(false);
    expect(harness.statements.join("\n")).not.toMatch(/CREATE TABLE|CREATE INDEX/);
  });

  it("resumes a previously failed boot with an empty recreated predecessor, without deleting it", async () => {
    harness.tables = new Set(["notes", "entity_notes"]);
    await harness.migrations.get(1072)!();
    expect(harness.tables).toEqual(new Set(["notes", "entity_notes"]));
    expect(harness.statements.join("\n")).not.toMatch(/DROP|DELETE|ALTER TABLE notes RENAME/);
  });

  it.each([true, undefined])("refuses ambiguous or unreadable legacy records (%s)", async hasRows => {
    harness.tables = new Set(["notes", "entity_notes"]);
    harness.legacyHasRows = hasRows;
    await expect(harness.migrations.get(1072)!()).rejects.toThrow("not confirmed empty");
    expect(harness.statements.join("\n")).not.toMatch(/DO \$\$|DROP|DELETE/);
  });

  it("still creates and renames the original table on an older schema", async () => {
    await harness.migrations.get(1058)!();
    expect(harness.tables.has("notes")).toBe(true);
    await harness.migrations.get(1072)!();
    expect(harness.tables).toEqual(new Set(["entity_notes"]));
  });
});
