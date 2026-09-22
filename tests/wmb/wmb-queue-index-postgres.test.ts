import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

vi.mock("../../server/storage/db", () => ({ pool: {} }));
vi.mock("../../server/services/migration-runner", () => ({ registerMigration: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));
const catalog = vi.hoisted(() => ({ indexes: vi.fn() }));
vi.mock("../../server/storage/utils", () => ({
  tableExists: async () => false,
  getTableColumnInfo: async () => [],
  getTableConstraintInfo: async () => [],
  getTableIndexInfo: catalog.indexes,
}));
import { detectSchemaDrift, generateCreateStatements } from "../../server/services/component-schema-push";
import { trustWmbScanQueue } from "../../shared/schema";
import { installQueueReadIndexes, queueReadIndexes } from "../../scripts/migrate/core/1198_index_wmb_worker_queue";

// Explicit opt-in; starts an isolated local cluster with no TCP listener and
// never reads DATABASE_URL. Requires PostgreSQL initdb/pg_ctl on PATH.
describe.skipIf(process.env.WMB_QUEUE_INDEX_PG !== "1")("queue index real PostgreSQL migration", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "wmb-index-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 3 });
    await pool.query(`CREATE TABLE trust_wmb_scan_queue
      (id varchar PRIMARY KEY, worker_id varchar NOT NULL, status_id varchar NOT NULL,
       status varchar NOT NULL, scheduled_for timestamp);
      INSERT INTO trust_wmb_scan_queue VALUES ('1','worker','run','pending',NULL)`);
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const snapshot = async () => (await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'trust_wmb_scan_queue' AND indexname <> 'trust_wmb_scan_queue_pkey'
    ORDER BY indexname`)).rows;

  it("reruns safely, repairs a genuinely interrupted build, and matches schema-push DDL", async () => {
    await installQueueReadIndexes(pool);
    const migrated = await snapshot();
    catalog.indexes.mockImplementation(async () => (await pool.query(`
      SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
        i.indisunique AS "isUnique", am.amname AS method,
        ARRAY(SELECT pg_get_indexdef(i.indexrelid,n,true)
              FROM generate_series(1,i.indnkeyatts) n) AS columns,
        pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_am am ON am.oid=c.relam
      WHERE i.indrelid='trust_wmb_scan_queue'::regclass`)).rows);
    // Exercise the actual drift gate's normalization against real catalog data,
    // not only the generated SQL. Other table columns/FKs are out of this test.
    expect((await detectSchemaDrift(trustWmbScanQueue, "trust_wmb_scan_queue")).missingIndexes).toEqual([]);
    await installQueueReadIndexes(pool);
    expect(await snapshot()).toEqual(migrated);
    const settings = (await pool.query("SHOW statement_timeout")).rows[0];
    expect(settings.statement_timeout).toBe("0");

    const name = queueReadIndexes[0].name;
    await pool.query(`DROP INDEX ${name}`);
    const writer = await pool.connect();
    const builder = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE trust_wmb_scan_queue SET status='processing' WHERE id='1'");
      await builder.query("SET statement_timeout='250ms'");
      await expect(builder.query(`CREATE INDEX CONCURRENTLY ${name} ON trust_wmb_scan_queue (worker_id)`)).rejects.toMatchObject({ code: "57014" });
      expect((await pool.query("SELECT indisvalid FROM pg_index WHERE indexrelid=$1::regclass", [name])).rows[0].indisvalid).toBe(false);
    } finally {
      await writer.query("ROLLBACK");
      await builder.query("SET statement_timeout=0");
      writer.release();
      builder.release();
    }
    await installQueueReadIndexes(pool);
    expect(await snapshot()).toEqual(migrated);
    expect((await pool.query("SELECT bool_and(indisvalid) AS valid FROM pg_index WHERE indrelid='trust_wmb_scan_queue'::regclass")).rows[0].valid).toBe(true);

    for (const spec of queueReadIndexes) await pool.query(`DROP INDEX ${spec.name}`);
    const statements = generateCreateStatements(trustWmbScanQueue, "trust_wmb_scan_queue", new Map());
    for (const statement of statements.filter(s => s.kind === "create_index")) await pool.query(statement.sql);
    expect(await snapshot()).toEqual(migrated);
    await installQueueReadIndexes(pool);
    expect(await snapshot()).toEqual(migrated);

    await pool.query(`DROP INDEX ${name}; CREATE INDEX ${name} ON trust_wmb_scan_queue (status_id)`);
    await expect(installQueueReadIndexes(pool)).rejects.toThrow("definition drift");
    expect((await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname=$1", [name])).rows[0].indexdef).toContain("(status_id)");
  });
});