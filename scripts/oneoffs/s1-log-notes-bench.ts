/**
 * Log-notes loader bench (Task 410) — WET, production-shaped benchmark of the
 * optimized scripts/s1-migration/load-log-notes.ts batch path.
 *
 * The production-scale rehearsal measured the per-row path at ~22 rows/s over
 * a ~500k staged sirius_log corpus dominated by the immutable `smf:notes` /
 * `raw` ("Legacy Notes") population. This bench seeds a mixed corpus (default
 * 20k rows: 90% immutable smf:notes/raw, 10% mutable classified rows) with
 * resolvable handlers, then runs the REAL loader as a CLI child under a hard
 * 512 MB heap cap:
 *   run1 — insert-heavy first import (everything new)
 *   mutate — simulate a failed initial import for K immutable rows (NULL
 *            consumed_fingerprint), edit one mutable row (content_hash bump),
 *            delete one mutable staged row (source deletion)
 *   run2 — rerun: completed immutable rows are excluded at the query
 *            boundary (never fetched), failed initial imports retry, the
 *            edited row updates, the deleted row sweeps.
 *
 * Gates (all must hold for exit 0):
 *   - both runs exit 0, verify pass, bulk write path used
 *   - run1 created == N; run2 created == 0, updated == K + 1, deleted == 1
 *   - run2 conservation: fetched + immutableSkipped == run1 total − 1
 *   - run2 immutableSkipped ≥ smfCount − K (completed immutables never read)
 *   - no duplicate notes per staged nid; note count == N − 1 after run2
 *   - every mutable bench note carries its medium tag; bodies non-empty
 *   - run1 fetched ≥ RATE_GATE rows/s (10× the observed 22/s) and the
 *     projected 500k full run ≤ PROJECTION_GATE_S
 *   - bounded memory: both runs complete under the 512 MB heap cap
 *
 * Seeds nids at 97,000,000+ (trackc owns 90M+, t20 bench 96M+; disjoint) and
 * removes everything it created — cleanup runs first (stale rows from an
 * aborted run), in a `finally`, and via --cleanup-only. Aggregates only — no
 * PII (synthetic bodies).
 *
 * Usage: npx tsx scripts/oneoffs/s1-log-notes-bench.ts [--cleanup-only]
 *        npx tsx scripts/oneoffs/s1-log-notes-bench.ts --n=5000
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { db, pool as pgPool } from "../../server/storage/db";
import { getRawProcessEnv } from "../../server/config/env-registry";
import { sql } from "drizzle-orm";

const N = (() => {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  const n = Number(arg?.slice(4) ?? "");
  return Number.isInteger(n) && n > 0 ? n : 20_000;
})();
const HANDLERS = 200;
const K_FAILED = 50; // simulated failed initial imports retried on run2
const BASE = 97_000_000;
const LOG_BASE = BASE;
const HANDLER_BASE = BASE + 5_000_000;
const LOG_END = HANDLER_BASE;
const BENCH_LOADER = "log-notes-bench";
const MARK_W = "__t410-bench-w-";
const NOTES_LOADER = "s1-log-notes";

const PROD_STAGED = 500_000;
const RATE_GATE = 220; // fetched rows/s — 10× the observed 22/s baseline
const PROJECTION_GATE_S = 3600; // full 500k first import within an hour

const q = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface LoaderEnvelope {
  summary: { created: number; updated: number; deleted: number; unchanged: number };
  verify: { status: string };
  detail: Record<string, any>;
}

let runSeq = 0;
function runLoader(): { code: number; seconds: number; result: LoaderEnvelope | null; tail: string } {
  const resultPath = `/tmp/t410-bench-${process.pid}-${++runSeq}.json`;
  const t0 = Date.now();
  const res = spawnSync("npx", ["tsx", "scripts/s1-migration/load-log-notes.ts", "--migration-mode"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...getRawProcessEnv(), // sanctioned whole-env passthrough to the child CLI
      S1_RESULT_JSON_PATH: resultPath,
      NODE_OPTIONS: "--max-old-space-size=512", // completing under the cap proves bounded memory
      S1_PROGRESS_INTERVAL_MS: "20000",
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 45 * 60 * 1000,
  });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  let result: LoaderEnvelope | null = null;
  if (existsSync(resultPath)) {
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8")) as LoaderEnvelope;
    } catch { /* leave null */ }
    try { unlinkSync(resultPath); } catch { /* ignore */ }
  }
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  console.log(`  · load-log-notes.ts --migration-mode → exit ${res.status} (${seconds}s)`);
  return { code: res.status ?? -1, seconds, result, tail: out.slice(-2500) };
}

const BENCH_NOTE_IDS = sql`
  SELECT id FROM entity_notes
   WHERE data->>'s1Loader' = ${NOTES_LOADER}
     AND (data->'s1'->>'nid')::bigint >= ${LOG_BASE} AND (data->'s1'->>'nid')::bigint < ${LOG_END}
`;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM sitespecific_bao_notes_tags WHERE note_id IN (${BENCH_NOTE_IDS})`);
  await db.execute(sql`DELETE FROM entity_notes WHERE id IN (${BENCH_NOTE_IDS})`);
  await db.execute(sql`
    DELETE FROM s1_staging.id_map WHERE entity = 's1_log_note' AND s1_id >= ${LOG_BASE} AND s1_id < ${LOG_END}
  `);
  await db.execute(sql`
    DELETE FROM s1_staging.records WHERE bundle = 'sirius_log' AND nid >= ${LOG_BASE} AND nid < ${LOG_END}
  `);
  await db.execute(sql`
    DELETE FROM workers WHERE id IN (SELECT s2_id FROM s1_staging.id_map WHERE entity = 'worker' AND loader = ${BENCH_LOADER})
  `);
  await db.execute(sql`DELETE FROM contacts WHERE display_name LIKE ${MARK_W + "%"}`);
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE loader = ${BENCH_LOADER}`);
}

async function main() {
  if (process.argv.includes("--cleanup-only")) {
    await cleanup();
    console.log("cleanup complete");
    await pgPool.end();
    return;
  }

  await cleanup(); // stale rows from an aborted run

  // ---- baseline: converge the dev corpus first, so bench deltas are exact ----
  console.log("== baseline run (dev corpus only) ==");
  const base = runLoader();
  check("baseline: exit 0", base.code === 0, base.tail);
  check("baseline: verify pass", base.result?.verify.status === "pass", JSON.stringify(base.result?.verify));
  if (base.code !== 0 || !base.result) throw new Error("baseline run failed — dev DB not in a runnable state");

  // ---- seed: handler contacts/workers + staged logs (90% immutable) ----
  const smfCount = N - Math.ceil(N / 10);
  console.log(`== seeding ${N} staged logs (${smfCount} smf:notes/raw immutable, ${N - smfCount} mutable, ${HANDLERS} handlers) ==`);
  const seed0 = Date.now();
  await db.execute(sql`
    INSERT INTO contacts (display_name)
    SELECT ${MARK_W} || g FROM generate_series(0, ${HANDLERS - 1}) g
  `);
  await db.execute(sql`
    INSERT INTO workers (contact_id)
    SELECT c.id FROM contacts c WHERE c.display_name LIKE ${MARK_W + "%"}
  `);
  await db.execute(sql`
    INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader)
    SELECT 'worker', ${HANDLER_BASE} + split_part(c.display_name, '-w-', 2)::bigint, w.id, false, ${BENCH_LOADER}
      FROM workers w JOIN contacts c ON c.id = w.contact_id
     WHERE c.display_name LIKE ${MARK_W + "%"}
    ON CONFLICT (entity, s1_id) DO NOTHING
  `);
  // Every 10th row is a mutable classified row; the rest are the immutable
  // Legacy Notes population (with realistic whitespace/case variation).
  await db.execute(sql`
    INSERT INTO s1_staging.records (bundle, nid, vid, title, uid, status, created, changed, fields, content_hash)
    SELECT 'sirius_log', ${LOG_BASE} + g, ${LOG_BASE} + g,
           'bench log ' || g, 1, 1, 1700000000 + g, 1700000000 + g,
           jsonb_build_object(
             'field_sirius_category', jsonb_build_object('value',
               CASE WHEN g % 10 = 0 THEN 'Call from Member'
                    WHEN g % 20 = 1 THEN '  SMF:Notes ' ELSE 'smf:notes' END),
             'field_sirius_type', jsonb_build_object('value',
               CASE WHEN g % 10 = 0 THEN 'Enrrolment'
                    WHEN g % 20 = 1 THEN ' Raw  ' ELSE 'raw' END),
             'field_sirius_summary', jsonb_build_object('value', 'bench summary ' || g),
             'field_sirius_notes', jsonb_build_object('value', 'synthetic bench body ' || g),
             'field_sirius_log_handler', jsonb_build_array(${HANDLER_BASE} + (g % ${HANDLERS}))),
           md5('bench-' || g)
      FROM generate_series(0, ${N - 1}) g
  `);
  console.log(`seeded in ${Math.round((Date.now() - seed0) / 1000)}s`);

  const measurements: Record<string, unknown> = { N, smfCount, K_FAILED };
  try {
    // ---- run1: insert-heavy first import ----
    console.log("== run1: first import (insert-heavy) ==");
    const run1 = runLoader();
    check("run1: exit 0", run1.code === 0, run1.tail);
    check("run1: verify pass", run1.result?.verify.status === "pass", JSON.stringify(run1.result?.verify));
    if (!run1.result) throw new Error("run1 envelope missing");
    const d1 = run1.result.detail;
    const s1 = run1.result.summary;
    check("run1: bulk write path used", d1.batching?.bulkWritePath === true);
    check("run1: created == N (baseline was converged)", s1.created === N, `created=${s1.created}`);
    const fetched1 = Number(d1.stagedFetched);
    const rate1 = Number(d1.performance?.fetchedRowsPerSecond ?? 0);
    check(`run1: fetched ≥ ${RATE_GATE} rows/s (10× the 22/s baseline)`, rate1 >= RATE_GATE, `rate=${rate1}`);
    const projected = rate1 > 0 ? PROD_STAGED / rate1 : Infinity;
    check(`run1: projected 500k first import ≤ ${PROJECTION_GATE_S}s`, projected <= PROJECTION_GATE_S, `projected=${Math.round(projected)}s`);
    check(
      "run1: round trips bounded by pages/chunks, not rows",
      Number(d1.batching?.pages) * 3 + Number(d1.batching?.bulkWriteChunks) + Number(d1.batching?.verifyChunks) < fetched1 / 10,
      JSON.stringify(d1.batching),
    );
    measurements.run1 = { seconds: run1.seconds, summary: s1, batching: d1.batching, performance: d1.performance, immutableSkipped: d1.immutableSkipped };

    // ---- mutate: failed initial imports, one edit, one source deletion ----
    console.log(`== mutate: ${K_FAILED} failed initial imports, 1 mutable edit, 1 source deletion ==`);
    await db.execute(sql`
      UPDATE s1_staging.id_map SET consumed_fingerprint = NULL
       WHERE entity = 's1_log_note' AND s1_id IN (
         SELECT s1_id FROM s1_staging.id_map
          WHERE entity = 's1_log_note' AND s1_id >= ${LOG_BASE + 2} AND s1_id < ${LOG_END}
            AND s1_id % 10 <> 0 ORDER BY s1_id LIMIT ${K_FAILED})
    `);
    const editedNid = LOG_BASE + 10; // mutable (g % 10 == 0)
    const deletedNid = LOG_BASE + 20; // mutable
    await db.execute(sql`
      UPDATE s1_staging.records SET content_hash = md5('bench-edited'),
             fields = jsonb_set(fields, '{field_sirius_notes,value}', to_jsonb('edited bench body'::text))
       WHERE bundle = 'sirius_log' AND nid = ${editedNid}
    `);
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_log' AND nid = ${deletedNid}`);

    // ---- run2: rerun — completed immutables never read ----
    console.log("== run2: rerun (immutable skip + retry + edit + sweep) ==");
    const run2 = runLoader();
    check("run2: exit 0", run2.code === 0, run2.tail);
    check("run2: verify pass", run2.result?.verify.status === "pass", JSON.stringify(run2.result?.verify));
    if (!run2.result) throw new Error("run2 envelope missing");
    const d2 = run2.result.detail;
    const s2 = run2.result.summary;
    check("run2: created == 0", s2.created === 0, `created=${s2.created}`);
    check(`run2: updated == K + 1 (retries + edit)`, s2.updated === K_FAILED + 1, `updated=${s2.updated}`);
    check("run2: deleted == 1 (source deletion swept)", s2.deleted === 1, `deleted=${s2.deleted}`);
    check(
      `run2: immutableSkipped ≥ ${smfCount - K_FAILED} (completed immutables excluded at the query)`,
      Number(d2.immutableSkipped) >= smfCount - K_FAILED,
      `immutableSkipped=${d2.immutableSkipped}`,
    );
    check(
      "run2: conservation — fetched + skipped == run1 total − 1 deleted",
      Number(d2.stagedFetched) + Number(d2.immutableSkipped) === fetched1 + Number(d1.immutableSkipped) - 1,
      `fetched=${d2.stagedFetched} skipped=${d2.immutableSkipped} run1=${fetched1}+${d1.immutableSkipped}`,
    );
    measurements.run2 = { seconds: run2.seconds, summary: s2, batching: d2.batching, performance: d2.performance, immutableSkipped: d2.immutableSkipped };

    // ---- S2 parity: no duplicates, bodies, tags ----
    const parity = (await q<{ n: number; dup: number; empty_body: number; bad_subject: number }>(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE cnt > 1)::int AS dup,
             count(*) FILTER (WHERE body IS NULL OR body = '')::int AS empty_body,
             count(*) FILTER (WHERE subject NOT LIKE 'Imported Note%')::int AS bad_subject
        FROM (SELECT n.body, n.subject,
                     count(*) OVER (PARTITION BY n.data->'s1'->>'nid') AS cnt
                FROM entity_notes n
               WHERE n.data->>'s1Loader' = ${NOTES_LOADER}
                 AND (n.data->'s1'->>'nid')::bigint >= ${LOG_BASE} AND (n.data->'s1'->>'nid')::bigint < ${LOG_END}) t
    `))[0];
    check("parity: note count == N − 1", Number(parity.n) === N - 1, `n=${parity.n}`);
    check("parity: zero duplicate provenance", Number(parity.dup) === 0, `dup=${parity.dup}`);
    check("parity: zero empty bodies", Number(parity.empty_body) === 0, `empty=${parity.empty_body}`);
    check("parity: subjects carry creator provenance", Number(parity.bad_subject) === 0, `bad=${parity.bad_subject}`);
    const tagless = (await q<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM entity_notes n
       WHERE n.data->>'s1Loader' = ${NOTES_LOADER}
         AND (n.data->'s1'->>'nid')::bigint >= ${LOG_BASE} AND (n.data->'s1'->>'nid')::bigint < ${LOG_END}
         AND n.data->'s1'->>'normalizedCategory' = 'call from member'
         AND NOT EXISTS (SELECT 1 FROM sitespecific_bao_notes_tags t WHERE t.note_id = n.id)
    `))[0];
    check("parity: every mutable note carries tags", Number(tagless.n) === 0, `tagless=${tagless.n}`);
    const incomplete = (await q<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM s1_staging.id_map
       WHERE entity = 's1_log_note' AND s1_id >= ${LOG_BASE} AND s1_id < ${LOG_END}
         AND consumed_fingerprint IS NULL
    `))[0];
    check("parity: all bench mappings completed after run2", Number(incomplete.n) === 0, `incomplete=${incomplete.n}`);
  } finally {
    await cleanup();
    console.log("cleanup: bench rows removed");
  }

  console.log(JSON.stringify({ heapCapMB: 512, gates: { RATE_GATE, PROJECTION_GATE_S, PROD_STAGED }, measurements, failures }, null, 2));
  await pgPool.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  try {
    await cleanup();
  } catch (cleanupErr) {
    console.error("cleanup after failure also failed:", cleanupErr);
  }
  try { await pgPool.end(); } catch { /* ignore */ }
  process.exit(1);
});
