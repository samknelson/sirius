import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const harness = vi.hoisted(() => ({
  up: undefined as undefined | (() => Promise<void>),
  columns: ["context_id"] as string[],
  statements: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("../../server/services/migration-runner", () => ({
  registerMigration: (migration: { up: () => Promise<void> }) => { harness.up = migration.up; },
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../../server/storage/system/entity-metadata-policy", () => ({
  EXCLUDED_METADATA_TABLES: ["snapshots", "auth_identities"],
}));
vi.mock("../../server/db", () => ({
  db: {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const statement = new PgDialect().sqlToQuery(query);
      harness.statements.push(statement);
      if (statement.sql.includes("SELECT column_name")) {
        return { rows: harness.columns.map(column_name => ({ column_name })) };
      }
      return { rows: [], rowCount: 0 };
    },
  },
}));
import "../../scripts/migrate/core/1103_remove_process_entity_metadata";

describe("process metadata repair on pre-renamed Publish schemas", () => {
  beforeEach(() => { harness.statements = []; });

  it.each(["context_id", "table_name"])("uses the live %s column for repair AND cleanup", async column => {
    harness.columns = [column];
    await harness.up!();
    const repair = harness.statements[1];
    const cleanup = harness.statements[2];
    // The DO block must contain literal identifiers, not bound placeholders:
    // parameters inside its dollar-quoted body aren't PostgreSQL parameters.
    expect(repair.params).toEqual([]);
    expect(repair.sql.match(new RegExp(`m\\."${column}"`, "g"))).toHaveLength(8);
    expect(cleanup.sql.match(new RegExp(`"${column}"`, "g"))).toHaveLength(3);
    const retired = column === "context_id" ? "table_name" : "context_id";
    expect(repair.sql).not.toContain(`m.${retired}`);
    expect(repair.sql).not.toContain(`m."${retired}"`);
    expect(cleanup.sql).not.toContain(retired);
    expect(repair.sql).toContain("COALESCE(s.created_at, m.created_date)");
    expect(cleanup.params).toEqual(["snapshots", "auth_identities"]);
  });

  it.each([{ columns: [] }, { columns: ["table_name", "context_id"] }])("refuses missing or ambiguous columns ($columns) before writing", async ({ columns }) => {
    harness.columns = columns;
    await expect(harness.up!()).rejects.toThrow("exactly one");
    expect(harness.statements).toHaveLength(1);
  });
});
