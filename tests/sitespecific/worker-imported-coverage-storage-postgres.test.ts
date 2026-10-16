import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const context = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../../server/storage/db", () => ({ db: { transaction: context.transaction } }));
import { readWorkerImportedCoverageEvidence } from "../../server/storage/worker-imported-coverage";
import { importedMonthAuthority } from "../../server/services/sitespecific/bao/imported-coverage-authority";

// Isolated database only: never creates staging or runs imports against app data.
describe.skipIf(process.env.WORKER_DEPENDENT_HISTORY_PG !== "1")("import provenance storage SQL", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const months = [{ year: 2024, month: 1 }, { year: 2024, month: 2 }, { year: 2024, month: 3 }];
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "import-history-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 2 });
    const db = drizzle(pool);
    context.transaction.mockImplementation(db.transaction.bind(db));
    await pool.query(`
      CREATE SCHEMA s1_staging;
      CREATE TABLE workers(id varchar PRIMARY KEY);
      CREATE TABLE s1_staging.id_map(entity text, s1_id bigint, s2_id varchar, stub boolean,
        s1_deleted_at timestamptz, loader text, consumed_fingerprint text);
      CREATE TABLE s1_staging.records(bundle text, nid bigint, content_hash text, extracted_at timestamptz);
      CREATE TABLE s1_staging.runs(id serial PRIMARY KEY, args jsonb, report jsonb,
        started_at timestamptz, finished_at timestamptz);
      CREATE TABLE s1_staging.t17_desired_spans(nid bigint, worker_id varchar, start_idx int,
        end_idx int, consumed_fingerprint text, last_synced_at timestamptz, logic_version int);
    `);
  });
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    const report = {
      loader: "t17-benefit-history", logicVersion: 3, dryRun: false,
      verify: { status: "pass", failures: 0 }, rejectGate: { status: "pass", counts: {} }, blockingFindings: [],
      detail: { staged: 1, openEndThrough: "2024-03", historicalEventEvidence: {
        complete: true, inclusiveCutoff: "2024-03", stagedSpans: 1, processedSpans: 1, rejectedSpans: 0, verifyFailures: 0,
      } },
    };
    await pool.query(`
      TRUNCATE workers, s1_staging.id_map, s1_staging.records, s1_staging.runs, s1_staging.t17_desired_spans;
      INSERT INTO workers VALUES ('worker');
      INSERT INTO s1_staging.id_map VALUES ('worker',10,'worker',false,null,'t3t1-contacts-workers','worker-hash');
      INSERT INTO s1_staging.records VALUES
        ('sirius_worker',10,'worker-hash','2024-04-01'),
        ('sirius_trust_worker_benefit',20,'span-hash','2024-04-01');
      INSERT INTO s1_staging.t17_desired_spans VALUES (20,'worker',24288,24288,'span-hash','2024-04-02',3);
    `);
    await pool.query(`INSERT INTO s1_staging.runs(args,report,started_at,finished_at)
      VALUES ('{"loader":"t17-benefit-history"}',$1,'2024-04-02','2024-04-03')`, [JSON.stringify(report)]);
  });

  it("reads exact worker provenance and desired months, refusing missing positive rows", async () => {
    const evidence = await readWorkerImportedCoverageEvidence("worker", months);
    expect(evidence).toMatchObject({
      identityVerified: true, snapshotVerified: true, firstMonthIndex: 24288, desiredMonthIndexes: [24288],
    });
    expect(importedMonthAuthority(evidence, 2024, 1).state).toBe("unavailable");
    expect(importedMonthAuthority(evidence, 2024, 2).state).toBe("verified");
    const other = await readWorkerImportedCoverageEvidence("other-worker", months);
    expect(other?.identityVerified).toBe(false);
    expect(importedMonthAuthority(other, 2024, 2).state).toBe("unavailable");
  });

  it.each([
      `UPDATE s1_staging.records SET extracted_at = '2024-04-04' WHERE nid=20`,
      `DELETE FROM s1_staging.records WHERE nid=20`,
      `UPDATE s1_staging.t17_desired_spans SET consumed_fingerprint='changed'`,
      `UPDATE s1_staging.t17_desired_spans SET last_synced_at='2024-04-04'`,
      `UPDATE s1_staging.id_map SET stub=true`,
  ])("refuses changed evidence: %s", async (change) => {
      await pool.query(change);
      expect(importedMonthAuthority(await readWorkerImportedCoverageEvidence("worker", months), 2024, 2).state).toBe("unavailable");
  });

  it("uses the latest run rather than finding an earlier success and does not create absent staging", async () => {
    await pool.query(`INSERT INTO s1_staging.runs(args,report,started_at,finished_at)
      VALUES ('{"loader":"t17-benefit-history"}','{"dryRun":false,"verify":{"status":"fail"}}','2024-04-04','2024-04-05')`);
    expect(importedMonthAuthority(await readWorkerImportedCoverageEvidence("worker", months), 2024, 2).state).toBe("unavailable");
    await pool.query(`ALTER SCHEMA s1_staging RENAME TO absent_staging`);
    try {
      await expect(readWorkerImportedCoverageEvidence("worker", months)).rejects.toThrow();
      expect((await pool.query(`SELECT to_regnamespace('s1_staging') AS schema`)).rows[0].schema).toBeNull();
    } finally {
      await pool.query(`ALTER SCHEMA absent_staging RENAME TO s1_staging`);
    }
  });
});
