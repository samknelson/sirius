import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  metadataColumns: ["table_name"] as string[],
  queries: [] as string[],
}));

vi.mock("../server/storage/transaction-context", () => ({
  getClient: () => ({
    execute: async (query: { queryChunks: unknown[] }) => {
      const sql = new PgDialect().sqlToQuery(query as never).sql;
      state.queries.push(sql);
      const queryNumber = state.queries.length;

      if (queryNumber === 1) {
        return {
          rows: [
            { column_name: "id" },
            { column_name: "created_at" },
            { column_name: "updated_at" },
          ],
        };
      }
      if (queryNumber === 2) {
        return {
          rows: state.metadataColumns.map((column_name) => ({ column_name })),
        };
      }
      if (sql.includes("count(*)")) {
        return {
          rows: [
            {
              records: "1",
              not_record_id: "0",
              without_date: "0",
              held_elsewhere: "0",
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  }),
  runInTransaction: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../server/storage/entity-metadata-record-tables", () => ({
  getMetadataContextForTable: () => ({ contextId: "plugin_configs" }),
}));

vi.mock("../server/logger", () => ({
  storageLogger: {
    warn: vi.fn(),
  },
}));

const { createEntityMetadataSeedStorage } = await import(
  "../server/storage/system/entity-metadata-seed"
);

describe("entity metadata provenance seeding across the discriminator rename", () => {
  beforeEach(() => {
    state.metadataColumns = ["table_name"];
    state.queries = [];
  });

  it.each([
    ["table_name", "table_name"],
    ["context_id", "context_id"],
  ])("uses the %s discriminator throughout the seed SQL", async (columns, expected) => {
    state.metadataColumns = [columns];

    await createEntityMetadataSeedStorage().seedFromColumns({
      table: "plugin_configs",
      createdDateColumn: "created_at",
      modifiedDateColumn: "updated_at",
    });

    const seedQueries = state.queries.filter(
      (query) => query.includes("FROM entity_metadata") || query.includes("INSERT INTO entity_metadata"),
    );
    expect(seedQueries).toHaveLength(2);
    expect(seedQueries[0]).toContain(`m."${expected}" <>`);
    expect(seedQueries[1]).toContain(`"${expected}", entity_id`);
    expect(seedQueries[1]).toContain(
      `entity_metadata."${expected}" = EXCLUDED."${expected}"`,
    );
  });

  it("refuses an entity_metadata table with both discriminator columns", async () => {
    state.metadataColumns = ["table_name", "context_id"];

    await expect(
      createEntityMetadataSeedStorage().seedFromColumns({
        table: "plugin_configs",
        createdDateColumn: "created_at",
        modifiedDateColumn: "updated_at",
      }),
    ).rejects.toThrow("both table_name and context_id");

    expect(state.queries).toHaveLength(2);
  });
});