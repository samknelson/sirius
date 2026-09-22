import { describe, expect, it, vi } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { trustWmbScanQueue } from "../../shared/schema";

vi.mock("../../server/storage/db", () => ({ pool: {} }));
vi.mock("../../server/services/migration-runner", () => ({ registerMigration: vi.fn() }));
import migration, { installQueueReadIndexes, queueReadIndexes } from "../../scripts/migrate/core/1198_index_wmb_worker_queue";

function fixture(existing?: Record<string, unknown>, exists = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT current_setting")) return { rows: [{ lock_timeout: "0", statement_timeout: "0" }] };
    if (sql.startsWith("SELECT to_regclass")) return { rows: [{ oid: exists ? "trust_wmb_scan_queue" : null }] };
    if (sql.includes("FROM pg_class")) return { rows: existing ? [existing] : [] };
    return { rows: [] };
  });
  const release = vi.fn();
  return { pool: { connect: vi.fn(async () => ({ query, release })) } as any, query, release };
}

describe("WMB queue index migration", () => {
  it("builds concurrently with bounded session settings and restores the session", async () => {
    const f = fixture();
    await installQueueReadIndexes(f.pool);
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements.filter(s => s.startsWith("CREATE INDEX CONCURRENTLY"))).toHaveLength(3);
    expect(statements.some(s => /\bBEGIN\b/.test(s))).toBe(false);
    expect(statements[1]).toContain("'5s'");
    expect(statements[1]).toContain("'60s'");
    expect(f.query.mock.calls.at(-1)?.[0]).toContain("set_config");
    expect(f.release).toHaveBeenCalledWith(false);
    expect(migration.version).toBe(1198);
  });

  it("skips optional tables but restores settings", async () => {
    const f = fixture(undefined, false);
    await installQueueReadIndexes(f.pool);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("CREATE INDEX"))).toBe(false);
    expect(f.release).toHaveBeenCalledWith(false);
  });

  it("refuses a conflicting valid definition without dropping it", async () => {
    const f = fixture({ indisvalid: true, correct_table: false });
    await expect(installQueueReadIndexes(f.pool)).rejects.toThrow("definition drift");
    expect(f.query.mock.calls.some(([sql]) => sql.includes("DROP INDEX"))).toBe(false);
    expect(f.release).toHaveBeenCalledWith(false);
  });

  it("surfaces build failures and discards a session whose restoration fails", async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql) => {
      if (sql.startsWith("CREATE INDEX")) throw new Error("statement timeout");
      if (sql.includes("$1, false")) throw new Error("connection closed");
      return original(sql);
    });
    await expect(installQueueReadIndexes(f.pool)).rejects.toThrow("statement timeout");
    expect(f.release).toHaveBeenCalledWith(true);
  });

  it("declares matching schema indexes and PostgreSQL-cast predicates", () => {
    const indexes = getTableConfig(trustWmbScanQueue).indexes;
    const dialect = new PgDialect();
    for (const spec of queueReadIndexes) {
      const index = indexes.find(i => i.config.name === spec.name)!;
      expect(index).toBeDefined();
      expect(index.config.columns.map(c => "name" in c ? c.name : undefined)).toEqual(spec.columns);
      expect(index.config.where ? dialect.sqlToQuery(index.config.where).sql : null).toBe(spec.predicate);
    }
  });
});