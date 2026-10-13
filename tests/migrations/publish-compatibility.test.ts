import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { insertFileSchema, insertPluginConfigDashboardSchema } from "../../shared/schema";

const harness = vi.hoisted(() => ({
  up: undefined as undefined | (() => Promise<void>),
  hasRoles: true,
  hasLegacyRole: true,
  rows: [] as { role: string | null; roles: string[] | null }[],
  statements: [] as string[],
}));

vi.mock("../../server/services/migration-runner", () => ({
  registerMigration: (migration: { up: () => Promise<void> }) => {
    harness.up = migration.up;
  },
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../../server/db", () => ({
  db: {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const statement = new PgDialect().sqlToQuery(query).sql;
      harness.statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ exists: statement.includes("column_name = 'roles'") ? harness.hasRoles : harness.hasLegacyRole }] };
      }
      if (/ADD COLUMN roles/.test(statement)) {
        harness.hasRoles = true;
        return { rows: [] };
      }
      if (/UPDATE plugin_configs_dashboard/.test(statement)) {
        expect(harness.hasLegacyRole).toBe(true);
        expect(statement).toContain("role IS NOT NULL");
        expect(statement).toContain("cardinality(roles) = 0");
        for (const row of harness.rows) {
          if (row.role !== null && (row.roles === null || row.roles.length === 0)) {
            row.roles = [row.role];
          }
        }
        return { rows: [] };
      }
      if (/ALTER COLUMN roles SET NOT NULL/.test(statement)) {
        expect(harness.rows.every(row => row.roles !== null)).toBe(true);
        return { rows: [] };
      }
      throw new Error(`Unexpected migration statement: ${statement}`);
    },
  },
}));

import "../../scripts/migrate/core/1051_dashboard_roles_array";

describe("Publish compatibility", () => {
  beforeEach(() => {
    harness.hasRoles = true;
    harness.hasLegacyRole = true;
    harness.rows = [];
    harness.statements = [];
  });

  it("copies retained production roles after Publish has added the new column", async () => {
    harness.rows = [
      { role: "role-a", roles: [] },
      { role: "role-b", roles: [] },
      { role: "old-role", roles: ["new-role", "other-role"] },
      { role: null, roles: [] },
    ];
    await harness.up!();
    expect(harness.rows.map(row => row.roles)).toEqual([
      ["role-a"], ["role-b"], ["new-role", "other-role"], [],
    ]);
    expect(harness.rows[0].role).toBe("role-a");
    expect(harness.statements.join("\n")).not.toMatch(/ALTER TABLE|DROP COLUMN/);
  });

  it("still converts the original single-role schema", async () => {
    harness.hasRoles = false;
    harness.rows = [{ role: "role-a", roles: null }];
    await harness.up!();
    expect(harness.rows[0].roles).toEqual(["role-a"]);
  });

  it("does not query a removed legacy column on a final-shape database", async () => {
    harness.hasLegacyRole = false;
    harness.rows = [{ role: null, roles: ["role-a"] }];
    await harness.up!();
    expect(harness.statements.join("\n")).not.toMatch(/UPDATE plugin_configs_dashboard|DROP COLUMN/);
  });

  it("keeps an explicit filesystem mandatory despite the compatibility DB default", () => {
    const input = { fileName: "test.pdf", storagePath: "test.pdf", size: 1, uploadedBy: "user-id" };
    expect(insertFileSchema.safeParse(input).success).toBe(false);
    expect(insertFileSchema.safeParse({ ...input, fileSystemId: "" }).success).toBe(false);
    expect(insertFileSchema.safeParse({ ...input, fileSystemId: "private" }).success).toBe(true);
  });

  it("requires explicit dashboard roles and excludes the retired field from inputs", () => {
    expect(insertPluginConfigDashboardSchema.safeParse({ id: "config-id" }).success).toBe(false);
    expect(insertPluginConfigDashboardSchema.parse({
      id: "config-id", roles: ["role-a"], legacyRole: "old-role",
    })).toEqual({ id: "config-id", roles: ["role-a"] });
  });
});
