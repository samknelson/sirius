/**
 * DEV-ONLY failure-path smoke — prove load-beneficiaries surfaces a failed
 * clear-sweep WRITE as a sanitized `write_failed` (phase "clear") reject that
 * gates the run, instead of crashing or silently skipping, and that the
 * stale list survives the failed clear intact.
 *
 * A clear-write failure cannot be seeded with data alone (storage.set only
 * fails on infrastructure errors), so this script induces a REAL one:
 *   1. Picks a mapped staged worker outside the seed-beneficiary-fakes trap
 *      set, strips any staged beneficiaries JSON, writes a stale list
 *      through storage, and records loader authorship — the exact state
 *      whose staged side "went to zero", so the loader will attempt set([]).
 *   2. Installs a TEMPORARY trigger on workers that raises only when THIS
 *      worker's beneficiaries list is updated to [].
 *   3. Runs the real loader as a subprocess (every failure class allowed,
 *      matching the seeded-fakes rehearsal + write_failed) and asserts:
 *      write_failed=1 with phase "clear" in the report, exit 0 (allowed),
 *      and the stale list still present afterwards.
 *   4. Always drops the trigger/function (finally) and removes its trap
 *      state (list + authorship row) so subsequent rehearsal runs see the
 *      standard seeded-fakes counts.
 *
 * PRODUCTION: NEVER run this (temporary trigger on workers).
 *
 * Usage (after dev/seed-beneficiary-fakes.ts):
 *   npx tsx scripts/s1-migration/dev/smoke-beneficiary-clear-write-failure.ts
 */
import { spawnSync } from "node:child_process";
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage/database";
import { withNotificationsSuppressed } from "../../../server/middleware/request-context";
import { ensureStagingSchema } from "../lib/staging";
import { ensureIdMap, putMapping } from "../lib/idmap";

const ALLOW =
  "worker_unmapped,percent_sum_mismatch,pct_unusable,bad_json,unexpected_tier,list_exists_foreign,worker_map_broken,write_failed";

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  // 12th mapped staged worker — indexes 0-10 belong to seed-beneficiary-fakes.
  const res = await db.execute(sql`
    SELECT r.nid, m.s2_id FROM s1_staging.records r
      JOIN s1_staging.id_map m ON m.entity = 'worker' AND m.s1_id = r.nid AND m.stub = false
     WHERE r.bundle = 'sirius_worker' ORDER BY r.nid LIMIT 12
  `);
  const rows = (res as unknown as { rows: Array<{ nid: string | number; s2_id: string }> }).rows;
  if (rows.length < 12) fail(`need 12 mapped staged workers, found ${rows.length}`);
  const target = { nid: Number(rows[11].nid), workerId: rows[11].s2_id };

  // Arrange: staged side has no designations; S2 side has a loader-owned
  // stale list → the loader's clear sweep will attempt set([]).
  await db.execute(sql`
    UPDATE s1_staging.records SET fields = fields - 'field_sirius_json'
     WHERE bundle = 'sirius_worker' AND nid = ${target.nid}
  `);
  await withNotificationsSuppressed(() =>
    storage.baoBeneficiaries.set(target.workerId, [{ name: "SMOKE STALE", percent: 100 }]),
  );
  await putMapping("bao-beneficiaries", target.nid, target.workerId, {
    stub: false,
    loader: "dev/smoke-clear-write-failure",
  });

  // Temporary trigger: fail ONLY this worker's update to an empty list.
  // (workerId is a uuid read from our own DB — safe to embed in DDL, which
  // cannot take bind parameters.)
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION public.smoke_beneficiary_clear_fail() RETURNS trigger AS $fn$
    BEGIN
      IF NEW.id = '${sql.raw(target.workerId)}'
         AND COALESCE(NEW.data->'sitespecific'->'bao'->'beneficiaries', 'null'::jsonb) = '[]'::jsonb THEN
        RAISE EXCEPTION 'SMOKE_CLEAR_FAILURE';
      END IF;
      RETURN NEW;
    END $fn$ LANGUAGE plpgsql
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS smoke_beneficiary_clear_fail ON workers`);
  await db.execute(sql`
    CREATE TRIGGER smoke_beneficiary_clear_fail BEFORE UPDATE ON workers
    FOR EACH ROW EXECUTE FUNCTION public.smoke_beneficiary_clear_fail()
  `);

  let stdout = "";
  let status: number | null = null;
  try {
    const run = spawnSync(
      "npx",
      ["tsx", "scripts/s1-migration/load-beneficiaries.ts", "--allow-rejects", ALLOW],
      { encoding: "utf8", timeout: 280_000 },
    );
    stdout = run.stdout ?? "";
    status = run.status;
  } finally {
    await db.execute(sql`DROP TRIGGER IF EXISTS smoke_beneficiary_clear_fail ON workers`);
    await db.execute(sql`DROP FUNCTION IF EXISTS public.smoke_beneficiary_clear_fail()`);
  }

  // Assert: sanitized write_failed on the clear phase, run gated cleanly.
  const checks: Array<[string, boolean]> = [
    ["loader exited 0 with write_failed allowed", status === 0],
    [`report counts write_failed`, /"write_failed":\s*1/.test(stdout)],
    [`write_failed sample carries phase "clear"`, /"phase":\s*"clear"/.test(stdout)],
    [`write_failed sample names the trap nid`, stdout.includes(String(target.nid))],
    ["raw trigger message never leaks into the report", !stdout.includes("SMOKE_CLEAR_FAILURE")],
    ["verify stayed green", /"verifyFailures":\s*0/.test(stdout)],
  ];
  const stale = await storage.baoBeneficiaries.get(target.workerId);
  checks.push(["stale list survived the failed clear", stale.length === 1 && stale[0]?.name === "SMOKE STALE"]);

  // Cleanup trap state so normal rehearsal counts are unaffected.
  await withNotificationsSuppressed(() => storage.baoBeneficiaries.set(target.workerId, []));
  await db.execute(sql`
    DELETE FROM s1_staging.id_map WHERE entity = 'bao-beneficiaries' AND s1_id = ${target.nid}
  `);

  let failures = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (!ok) failures++;
  }
  if (failures > 0) {
    console.error(`--- loader stdout (aggregates only) ---\n${stdout.slice(-4000)}`);
    fail(`${failures} assertion(s) failed`);
  }
  console.log("SMOKE PASS: clear-write failure surfaces as sanitized write_failed(phase=clear); list preserved; gate respected");
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
