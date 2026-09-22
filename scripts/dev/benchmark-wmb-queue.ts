/**
 * Local-only, synthetic queue benchmark. Never imports the application pool.
 * See docs/wmb-queue-performance.md for isolated-cluster reproduction.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveDatabaseUrl } from "../../shared/database-url";

const { values: options } = parseArgs({
  options: {
    "allow-scratch-write": { type: "boolean", default: false },
    rows: { type: "string", default: "500000" },
    output: { type: "string", default: "docs/wmb-queue-performance-evidence.json" },
  },
});
assert(options["allow-scratch-write"], "Explicit --allow-scratch-write benchmark opt-in required");
const url = resolveDatabaseUrl().url;
const parsed = new URL(url);
assert(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname), "Local loopback DB required");
assert.equal(parsed.pathname, "/wmb_queue_bench", "Dedicated scratch database required");
const rowCount = Number(options.rows);
assert(Number.isInteger(rowCount) && rowCount >= 20_000 && rowCount <= 5_000_000 && rowCount % 10_000 === 0,
  "--rows must be a multiple of 10,000 between 20,000 and 5,000,000");
const schema = `wmb_bench_${process.pid}`;
const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema},pg_catalog` });
const admin = await pool.connect();
let adminReleased = false;
assert.equal((await admin.query("select current_database() as db")).rows[0].db, "wmb_queue_bench");
const table = "trust_wmb_scan_queue";
const last = `SELECT * FROM ${table} WHERE worker_id=$1 AND status IN ('success','failed') ORDER BY completed_at DESC LIMIT 1`;
const queued = `SELECT * FROM ${table} WHERE worker_id=$1 AND status IN ('pending','processing') ORDER BY year DESC, month DESC`;
const remaining = `SELECT count(*) FROM ${table} WHERE status_id=$1 AND (status='pending' OR status='processing')`;
const claim = (filtered = false) => `UPDATE ${table} SET status='processing', picked_at=now(), attempts=attempts+1
 WHERE status='pending' AND id=(SELECT id FROM ${table} WHERE status='pending'
 ${filtered ? "AND trigger_source IN ('worker_update','employment_saved')" : ""}
 ORDER BY scheduled_for ASC NULLS LAST, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
const queries = [
  { name: "worker-last", sql: last, args: ["worker-1"] },
  { name: "worker-queued", sql: queued, args: ["worker-1"] },
  { name: "claim", sql: claim(), args: [] },
  { name: "claim-filtered", sql: claim(true), args: [] },
  { name: "remaining", sql: remaining, args: [`run-${Math.floor((rowCount - 1) / 10_000)}`] },
  { name: "remaining-exists", sql: `SELECT id FROM ${table} WHERE status_id=$1 AND (status='pending' OR status='processing') LIMIT 1`, args: [`run-${Math.floor((rowCount - 1) / 10_000)}`] },
  { name: "remaining-empty", sql: remaining, args: ["run-0"] },
  { name: "remaining-exists-empty", sql: `SELECT id FROM ${table} WHERE status_id=$1 AND (status='pending' OR status='processing') LIMIT 1`, args: ["run-0"] },
];
const output: Record<string, unknown> = { rowCount, synthetic: true, poolSize: 4 };
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];

try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${table} (
    id varchar PRIMARY KEY, status_id varchar NOT NULL, worker_id varchar NOT NULL,
    month integer NOT NULL, year integer NOT NULL, status varchar NOT NULL,
    trigger_source varchar NOT NULL, result_summary jsonb, scheduled_for timestamp,
    picked_at timestamp, completed_at timestamp, attempts integer NOT NULL DEFAULT 0,
    last_error text, UNIQUE(status_id,worker_id))`);
  await admin.query(`INSERT INTO ${table}
    SELECT lpad(i::text,12,'0'), 'run-'||((i-1)/10000), 'worker-'||(((i-1)%10000)+1),
    ((i-1)/10000)%12+1, 2022+((i-1)/120000),
    CASE WHEN i>$1::int-10000 THEN CASE WHEN i%10=0 THEN 'processing' ELSE 'pending' END
      WHEN i%19=0 THEN 'failed' ELSE 'success' END,
    CASE WHEN i>$1::int-1000 THEN 'worker_update' ELSE 'monthly_batch' END,
    jsonb_build_object('actions',jsonb_build_array(jsonb_build_object('benefitId','benefit-1','scanType','continue','eligible',true,'action','keep'))),
    CASE WHEN i%17=0 THEN NULL ELSE timestamp '2026-01-01'+i*interval '1 second' END,
    NULL, CASE WHEN i<=$1::int-10000 THEN timestamp '2026-01-01'+i*interval '1 second' ELSE NULL END,
    0, NULL FROM generate_series(1,$1::int) i`, [rowCount]);
  await admin.query(`VACUUM ANALYZE ${table}`);
  output.serverVersion = (await admin.query("SHOW server_version")).rows[0].server_version;
  admin.release();
  adminReleased = true;

  async function plans() {
    const results: Record<string, unknown> = {};
    const client = await pool.connect();
    try {
      for (const q of queries) {
        await client.query("BEGIN");
        const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, q.args);
        await client.query("ROLLBACK");
        results[q.name] = result.rows[0]["QUERY PLAN"];
      }
    } finally { client.release(); }
    return results;
  }
  async function workload() {
    const samples: Record<string, Array<{ checkoutMs: number; sqlMs: number }>> = {};
    // Four background claim/count clients and four foreground readers contend
    // for a four-connection pool. Claim transactions roll back, preserving data.
    await Promise.all(Array.from({ length: 8 }, async (_, lane) => {
      for (let i = 0; i < 15; i++) {
        const q = lane < 4 ? queries[lane % 2] : queries[2 + (i % 4)];
        const start = performance.now();
        const client = await pool.connect();
        const checkedOut = performance.now();
        try {
          await client.query("BEGIN");
          const sqlStart = performance.now();
          await client.query(q.sql, q.args);
          const sqlMs = performance.now() - sqlStart;
          await client.query("ROLLBACK");
          (samples[q.name] ??= []).push({ checkoutMs: checkedOut - start, sqlMs });
        } finally { client.release(); }
      }
    }));
    return Object.fromEntries(Object.entries(samples).map(([name, rows]) => [name, {
      count: rows.length,
      checkoutP50Ms: percentile(rows.map(r => r.checkoutMs), .5),
      checkoutP95Ms: percentile(rows.map(r => r.checkoutMs), .95),
      sqlP50Ms: percentile(rows.map(r => r.sqlMs), .5),
      sqlP95Ms: percentile(rows.map(r => r.sqlMs), .95),
    }]));
  }
  async function correctness() {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const expected = (await a.query(`SELECT * FROM ${table} WHERE worker_id='worker-1' AND status IN ('success','failed') ORDER BY completed_at DESC LIMIT 1`)).rows[0];
      assert.deepEqual((await a.query(last, ["worker-1"])).rows[0], expected);
      const pendingRows = (await a.query(queued, ["worker-1"])).rows;
      assert(pendingRows.every(r => r.worker_id === "worker-1" && ["pending", "processing"].includes(r.status)));
      assert.equal((await a.query(last, ["missing-worker"])).rows.length, 0);
      assert.equal((await a.query(queued, ["missing-worker"])).rows.length, 0);
      const firstTwo = (await a.query(`SELECT id FROM ${table} WHERE status='pending' ORDER BY scheduled_for ASC NULLS LAST,id ASC LIMIT 2`)).rows;
      const eligible = (await a.query(`SELECT id FROM ${table} WHERE status='pending' AND trigger_source IN ('worker_update','employment_saved') ORDER BY scheduled_for ASC NULLS LAST,id ASC LIMIT 1`)).rows[0];
      await a.query("BEGIN");
      await b.query("BEGIN");
      await b.query("SET LOCAL statement_timeout='3s'");
      const one = (await a.query(claim())).rows[0];
      const two = (await b.query(claim())).rows[0];
      assert.equal(one.id, firstTwo[0].id);
      assert.equal(two.id, firstTwo[1].id);
      assert.notEqual(one.id, two.id); // b skips the row locked by a, without waiting
      assert.equal(one.status, "processing");
      assert.equal(one.attempts, 1);
      assert(one.picked_at instanceof Date);
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      await a.query("BEGIN");
      const filtered = (await a.query(claim(true))).rows[0];
      assert.equal(filtered.id, eligible.id);
      assert.equal(filtered.trigger_source, "worker_update");
      await a.query("ROLLBACK");
      const actualCount = Number((await a.query(remaining, queries[4].args)).rows[0].count);
      assert.equal(actualCount, 10000);
    } finally {
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      a.release(); b.release();
    }
  }
  await correctness();
  output.before = { plans: await plans(), concurrent: await workload() };
  await pool.query(`CREATE INDEX trust_wmb_scan_queue_worker_idx ON ${table}(worker_id)`);
  await pool.query(`CREATE INDEX trust_wmb_scan_queue_pending_claim_idx ON ${table}(scheduled_for ASC NULLS LAST,id ASC) WHERE (status)::text='pending'::text`);
  await pool.query(`CREATE INDEX trust_wmb_scan_queue_active_run_idx ON ${table}(status_id) WHERE (status)::text = ANY(ARRAY['pending'::text,'processing'::text])`);
  await pool.query(`ANALYZE ${table}`);
  await correctness();
  output.after = { plans: await plans(), concurrent: await workload() };
  output.indexSizes = (await pool.query(`SELECT indexrelname,pg_relation_size(indexrelid) AS bytes FROM pg_stat_user_indexes WHERE schemaname=$1`, [schema])).rows;
  output.correctness = "passed before and after";
  const path = options.output;
  await writeFile(path, JSON.stringify(output, null, 2));
  console.log(`Wrote ${path}; correctness passed before and after; ${rowCount} synthetic rows.`);
} finally {
  // Only this process's schema is removed. The dedicated database is retained.
  if (!adminReleased) admin.release();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
}