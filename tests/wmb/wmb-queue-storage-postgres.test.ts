import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const context = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: context.getClient }));
import { createWmbScanQueueStorage } from "../../server/storage/wmb-scan-queue";

// The application storage methods execute real SQL. Only connection selection
// is replaced; no application/production database configuration is consulted.
describe.skipIf(process.env.WMB_QUEUE_STORAGE_PG !== "1")("WMB storage real PostgreSQL", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const storage = createWmbScanQueueStorage();
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "wmb-storage-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 4, statement_timeout: 3000 });
    context.getClient.mockReturnValue(drizzle(pool));
    await pool.query(`
      CREATE TABLE trust_wmb_scan_status (
        id varchar PRIMARY KEY, month int NOT NULL, year int NOT NULL,
        scope_type varchar DEFAULT 'all', scope_employer_id varchar, status varchar DEFAULT 'queued',
        total_queued int DEFAULT 0, processed_success int DEFAULT 0, processed_failed int DEFAULT 0,
        benefits_started int DEFAULT 0, benefits_continued int DEFAULT 0, benefits_terminated int DEFAULT 0,
        queued_at timestamp DEFAULT now(), started_at timestamp, completed_at timestamp, last_error text);
      CREATE TABLE trust_wmb_scan_queue (
        id varchar PRIMARY KEY, status_id varchar REFERENCES trust_wmb_scan_status(id),
        worker_id varchar NOT NULL, month int NOT NULL, year int NOT NULL, status varchar NOT NULL,
        trigger_source varchar NOT NULL DEFAULT 'monthly_batch', result_summary jsonb,
        scheduled_for timestamp, picked_at timestamp, completed_at timestamp,
        attempts int NOT NULL DEFAULT 0, last_error text, UNIQUE(status_id,worker_id));
      CREATE INDEX trust_wmb_scan_queue_worker_idx ON trust_wmb_scan_queue(worker_id);
      CREATE INDEX trust_wmb_scan_queue_pending_claim_idx ON trust_wmb_scan_queue(scheduled_for,id) WHERE status='pending';
      CREATE INDEX trust_wmb_scan_queue_active_run_idx ON trust_wmb_scan_queue(status_id) WHERE status IN ('pending','processing')`);
  });
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE trust_wmb_scan_queue,trust_wmb_scan_status");
    await pool.query(`INSERT INTO trust_wmb_scan_status(id,month,year) VALUES ('a',1,2026),('b',2,2026),('c',3,2026)`);
  });
  it("returns the latest terminal result and correctly ordered queued months without other workers", async () => {
    await pool.query(`INSERT INTO trust_wmb_scan_queue(id,status_id,worker_id,month,year,status,completed_at)
      VALUES ('old','a','worker',12,2025,'success','2026-01-01'),
      ('latest','b','worker',1,2026,'failed','2026-02-01'),
      ('next','c','worker',3,2026,'pending',NULL),
      ('foreign','a','other',3,2026,'success','2026-04-01'),
      ('processing','a','queued-only',2,2027,'processing',NULL),
      ('pending','b','queued-only',12,2026,'pending',NULL),
      ('pending2','c','queued-only',1,2027,'pending',NULL)`);
    const result = await storage.getWorkerScanState("worker");
    expect(result.lastScan).toMatchObject({ id: "latest", status: "failed", completedAt: new Date("2026-02-01T00:00:00") });
    expect(result.queued.map(r => r.id)).toEqual(["next"]);
    expect((await storage.getWorkerScanState("queued-only")).queued.map(r => r.id)).toEqual(["processing", "pending2", "pending"]);
    expect(await storage.getWorkerScanState("missing")).toEqual({ lastScan: undefined, queued: [] });
  });
  it("claims by timestamp then id, NULLS LAST; filters sources and SKIP LOCKED skips a held row", async () => {
    await pool.query(`INSERT INTO trust_wmb_scan_queue(id,status_id,worker_id,month,year,status,scheduled_for,trigger_source)
      VALUES ('01','a','w1',1,2026,'pending','2026-01-01','monthly_batch'),
      ('02','b','w2',1,2026,'pending','2026-01-01','worker_update'),
      ('00-null','c','w3',1,2026,'pending',NULL,'worker_update'),
      ('already','a','w4',1,2026,'processing','2025-01-01','worker_update')`);
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM trust_wmb_scan_queue WHERE id='01' FOR UPDATE");
      const skipped = await storage.claimNextJob();
      expect(skipped).toMatchObject({ id: "02", status: "processing", attempts: 1 });
      expect(skipped?.pickedAt).toBeInstanceOf(Date);
      await locker.query("ROLLBACK");
      expect(await storage.claimNextJob(["worker_update"])).toMatchObject({ id: "00-null" });
      expect(await storage.claimNextJob()).toMatchObject({ id: "01" });
      expect(await storage.claimNextJob()).toBeUndefined();
      expect(await storage.claimJobById("01")).toBeUndefined();
    } finally { await locker.query("ROLLBACK"); locker.release(); }
  });
  it("only completes a run after both pending and processing jobs finish", async () => {
    await pool.query(`INSERT INTO trust_wmb_scan_queue(id,status_id,worker_id,month,year,status)
      VALUES ('1','a','w1',1,2026,'processing'),('2','a','w2',1,2026,'pending'),
      ('3','a','w3',1,2026,'processing'),('unrelated','b','w4',2,2026,'pending')`);
    expect(await storage.recordJobResult("1", true, { actions: [{ scanType: "start", eligible: true }] })).toEqual({ scanCompleted: false });
    expect(await storage.recordJobResult("2", false, null, "expected failure")).toEqual({ scanCompleted: false });
    const finished = await storage.recordJobResult("3", true, { actions: [{ scanType: "continue", action: "delete" }] });
    expect(finished.scanCompleted).toBe(true);
    expect(finished.completedStatus).toMatchObject({
      id: "a", status: "completed", processedSuccess: 2, processedFailed: 1,
      benefitsStarted: 1, benefitsContinued: 0, benefitsTerminated: 1,
    });
    const failed = (await pool.query("SELECT status,last_error FROM trust_wmb_scan_queue WHERE id='2'")).rows[0];
    expect(failed).toEqual({ status: "failed", last_error: "expected failure" });
    expect(await storage.recordJobResult("missing", true, {})).toEqual({ scanCompleted: false });
  });
});