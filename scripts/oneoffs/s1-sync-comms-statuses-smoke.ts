/**
 * Sync smoke — member statuses (T6).
 *
 * Retains the status create, update, empty-set and deletion-sweep checks.
 * Call-log-to-comms phases were retired; approved logs use load-log-notes.ts.
 * DEV ONLY: borrows one worker without status history or migration mappings.
 * Fake nids/tids 99901200–99901299 and loader-owned status rows are cleaned up.
 *
 * Run: npx tsx scripts/oneoffs/s1-sync-comms-statuses-smoke.ts
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../../server/storage/db";
import "../../server/storage/database";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords } from "../s1-migration/lib/staging";
import { ensureIdMap, putMapping } from "../s1-migration/lib/idmap";
import { getRawProcessEnv } from "../../server/config/env-registry";

const N = { smw: 99901201, tid1: 99901290, tid2: 99901291 };
const NID_LO = 99901200;
const NID_HI = 99901299;
const SMOKE_LOADER = "s1-sync-comms-statuses-smoke";
const CHANGED_EPOCH = Math.floor(Date.UTC(2026, 2, 1) / 1000);
let failures = 0;
let borrowedWorkerId: string | null = null;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runT6(): { status: number; result: any } {
  const tmp = path.join(os.tmpdir(), `s1-smoke-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync("npx", ["tsx", "scripts/s1-migration/load-member-statuses.ts"], {
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: tmp },
  });
  let result: any = {};
  try { result = JSON.parse(fs.readFileSync(tmp, "utf8")); } catch {}
  try { fs.unlinkSync(tmp); } catch {}
  if ((res.status ?? -1) !== 0) {
    const tail = (res.stderr ?? "").split("\n").filter(Boolean).slice(-8).join("\n    ");
    console.error(`  [load-member-statuses.ts exit ${res.status}] stderr tail:\n    ${tail}`);
  }
  return { status: res.status ?? -1, result };
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

async function mappingOf(entity: string, s1Id: number): Promise<{ s2Id: string; stub: boolean } | null> {
  const r = await rows<{ s2_id: string; stub: boolean }>(
    sql`SELECT s2_id, stub FROM s1_staging.id_map WHERE entity = ${entity} AND s1_id = ${s1Id}`,
  );
  return r.length > 0 ? { s2Id: r[0].s2_id, stub: r[0].stub } : null;
}

const statusWorkerRec = (tids: number[]) => ({
  bundle: "sirius_worker",
  nid: N.smw,
  vid: N.smw,
  title: `Status Worker ${N.smw}`,
  uid: 1,
  status: 1,
  created: CHANGED_EPOCH,
  changed: CHANGED_EPOCH,
  fields: { field_sirius_member_status: tids.map((tid) => ({ tid })) },
});

async function cleanup() {
  const ms = await mappingOf("worker-ms", N.smw);
  const wk = ms?.s2Id ?? borrowedWorkerId;
  if (wk) {
    await db.execute(sql`DELETE FROM worker_msh WHERE worker_id = ${wk} AND data->>'source' = 's1-migration'`);
  }
  await db.execute(sql`DELETE FROM s1_staging.records
    WHERE nid BETWEEN ${NID_LO} AND ${NID_HI} AND bundle = 'sirius_worker'`);
  await db.execute(sql`DELETE FROM s1_staging.id_map
    WHERE (entity IN ('worker','worker-ms') AND s1_id BETWEEN ${NID_LO} AND ${NID_HI})
       OR (entity = 'term' AND s1_id IN (${N.tid1}, ${N.tid2}))`);
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  await cleanup();
  const msOptions = await rows<{ id: string; industry_id: string }>(
    sql`SELECT id, industry_id FROM options_worker_ms ORDER BY id LIMIT 2`,
  );
  const cleanWorkers = await rows<{ id: string }>(
    sql`SELECT w.id FROM workers w
      WHERE w.contact_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM worker_msh m WHERE m.worker_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM s1_staging.id_map im WHERE im.entity IN ('worker','worker-ms') AND im.s2_id = w.id)
      ORDER BY w.id LIMIT 1`,
  );
  if (msOptions.length < 2 || cleanWorkers.length < 1) {
    throw new Error("SETUP FAIL: need ≥2 worker-ms options and one worker without msh history/mappings.");
  }
  const [ms1, ms2] = msOptions;
  borrowedWorkerId = cleanWorkers[0].id;

  try {
    await putMapping("term", N.tid1, ms1.id, { stub: false, loader: SMOKE_LOADER });
    await putMapping("term", N.tid2, ms2.id, { stub: false, loader: SMOKE_LOADER });
    await putMapping("worker", N.smw, borrowedWorkerId, { stub: false, loader: SMOKE_LOADER });

    console.log("t6 phase 1: create — one status tid → one owned msh row");
    await upsertRecords([statusWorkerRec([N.tid1])]);
    let t6 = runT6();
    check("t6 run 1 exits 0", t6.status === 0, t6.result?.rejectGate);
    let msh = await rows<any>(sql`SELECT ms_id, industry_id, date, data FROM worker_msh WHERE worker_id = ${borrowedWorkerId}`);
    check("msh row created for option 1", msh.length === 1 && msh[0].ms_id === ms1.id, msh.map((m) => m.ms_id));
    check("msh row migration-owned", msh[0]?.data?.source === "s1-migration", msh[0]?.data);
    check("msh dated from node.changed", String(msh[0]?.date).startsWith("2026-03-01"), msh[0]?.date);
    check("worker-ms anchor mapped", !!(await mappingOf("worker-ms", N.smw)));

    console.log("t6 phase 2: update — tid swap converges");
    await upsertRecords([statusWorkerRec([N.tid2])]);
    t6 = runT6();
    check("t6 run 2 exits 0 with update", t6.status === 0 && (t6.result?.summary?.updated ?? 0) >= 1, t6.result?.summary);
    msh = await rows<any>(sql`SELECT ms_id FROM worker_msh WHERE worker_id = ${borrowedWorkerId}`);
    check("owned set reconciled to option 2", msh.length === 1 && msh[0].ms_id === ms2.id, msh.map((m) => m.ms_id));

    console.log("t6 phase 3: empty set — statuses cleared in S1");
    await upsertRecords([statusWorkerRec([])]);
    t6 = runT6();
    check("t6 run 3 exits 0", t6.status === 0, t6.result?.rejectGate);
    msh = await rows<any>(sql`SELECT id FROM worker_msh WHERE worker_id = ${borrowedWorkerId}`);
    check("owned msh rows removed", msh.length === 0);
    check("anchor mapping kept for empty set", !!(await mappingOf("worker-ms", N.smw)));

    console.log("t6 phase 4: sweep — staged worker deleted");
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${N.smw}`);
    t6 = runT6();
    check("t6 sweep run exits 0", t6.status === 0, t6.result?.rejectGate);
    check("t6 sweep counted a deletion", (t6.result?.summary?.deleted ?? 0) >= 1, t6.result?.summary);
    check("worker-ms anchor removed", (await mappingOf("worker-ms", N.smw)) === null);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "PASS: member-status sync smoke" : `FAIL: ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
