/**
 * Sync smoke — member statuses (T6) + call logs (N21) (Task 293).
 *
 * Proves full reconcile semantics against the dev DB:
 *   T6 member statuses (worker-ms anchor per worker nid):
 *     1. create — staged worker with one status tid → one owned msh row
 *        dated from the worker node's changed date
 *     2. update — tid swap converges (owned set reconciles to the new tid)
 *     3. empty  — S1 clears all statuses → owned msh rows removed, anchor
 *        mapping kept (empty owned set is a valid synced state)
 *     4. sweep  — staged worker row deleted → anchor mapping removed
 *   N21 call logs (call_log anchor per log nid):
 *     1. create — staged MSR log → comm + interaction (channel, reason,
 *        notes)
 *     2. update — type/category/notes edits converge through the
 *        transactional comm+interaction update
 *     3. incomplete-pair guard — updateInteractionWithCommForMigration on a
 *        comm missing its interaction child reports false WITHOUT mutating
 *        the comm (regression: the parent update used to commit first)
 *     3b. dependency repoint — a second log's handler targets a WORKER nid;
 *        remapping that worker (log node untouched) must retarget the comm:
 *        the consumed fingerprint embeds the RESOLVED handler outcome, so a
 *        changed resolution reprocesses the row even though staged bytes
 *        didn't move
 *     4. sweep  — staged log deleted → comm (and interaction) deleted; the
 *        other log's comm survives
 *
 * DEV-ONLY. Fake nids 99901200–99901299; fake status tids 99901290/91 map
 * to real worker-ms options. Borrows TWO real dev workers (no member-status
 * history, distinct contacts; worker 2 only ever receives an id_map row)
 * and a REAL mapped contact as log 1's handler — none are mutated beyond
 * loader-owned msh rows, which are cleaned up.
 * NEVER prints notes/summary content (HIPAA bar).
 *
 * Run: npx tsx scripts/oneoffs/s1-sync-comms-statuses-smoke.ts
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../../server/storage/db";
// IMPORTANT: initialize the storage barrel BEFORE importing ./comm directly —
// importing comm.ts first creates a partial-init cycle (TDZ at module load).
import "../../server/storage/database";
import { createCommInteractionStorage } from "../../server/storage/comm";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords } from "../s1-migration/lib/staging";
import { ensureIdMap, putMapping } from "../s1-migration/lib/idmap";
import { getRawProcessEnv } from "../../server/config/env-registry";

const N = {
  smw: 99901201, // staged sirius_worker carrying member-status tids
  log1: 99901211, // staged sirius_log MSR row (contact handler)
  log2: 99901212, // staged sirius_log MSR row (WORKER handler — repoint phase)
  tid1: 99901290, // fake status tid → real worker-ms option 1
  tid2: 99901291, // fake status tid → real worker-ms option 2
};
const NID_LO = 99901200;
const NID_HI = 99901299;
const SMOKE_LOADER = "s1-sync-comms-statuses-smoke";

const T6_ALLOW_REJECTS: string[] = [];
// Dev-population allowances. Stable real synthetic gaps (1 each as of
// 2026-08-19, after orphaned 999009xx probe fixtures were removed):
// handler_missing / category_missing / category_unmapped. The two handler_*
// resolution classes are kept as tolerance for parked reject fixtures in the
// fake-nid range. Rejected rows never advance their fingerprint, so they
// recur every run; our fixture nid is asserted explicitly below.
const N21_ALLOW_REJECTS = [
  "handler_missing",
  "category_missing",
  "category_unmapped",
  "handler_unresolved",
  "handler_dangling",
];

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(script: string, args: string[] = [], timeoutMs = 900_000): { status: number; result: any } {
  const tmp = path.join(os.tmpdir(), `s1-smoke-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: tmp },
  });
  let result: any = {};
  try {
    result = JSON.parse(fs.readFileSync(tmp, "utf8"));
  } catch {}
  try {
    fs.unlinkSync(tmp);
  } catch {}
  if ((res.status ?? -1) !== 0) {
    const tail = (res.stderr ?? "").split("\n").filter(Boolean).slice(-8).join("\n    ");
    console.error(`  [${script} exit ${res.status}] stderr tail:\n    ${tail}`);
  }
  return { status: res.status ?? -1, result };
}

const allowArgs = (rejects: string[]) => (rejects.length > 0 ? ["--allow-rejects", rejects.join(",")] : []);
const runT6 = () => runLoader("load-member-statuses.ts", allowArgs(T6_ALLOW_REJECTS), 600_000);
const runN21 = () => runLoader("load-call-logs.ts", allowArgs(N21_ALLOW_REJECTS), 600_000);

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}
async function mappingOf(entity: string, s1Id: number): Promise<{ s2Id: string; stub: boolean } | null> {
  const r = await rows<{ s2_id: string; stub: boolean }>(
    sql`SELECT s2_id, stub FROM s1_staging.id_map WHERE entity = ${entity} AND s1_id = ${s1Id}`,
  );
  return r.length > 0 ? { s2Id: r[0].s2_id, stub: r[0].stub } : null;
}

// ---------------------------------------------------------------------------
// staged fixtures
// ---------------------------------------------------------------------------
const CHANGED_EPOCH = Math.floor(Date.UTC(2026, 2, 1) / 1000); // 2026-03-01
const LOG_CREATED_EPOCH = Math.floor(Date.UTC(2026, 2, 2) / 1000); // 2026-03-02

const statusWorkerRec = (tids: number[]) => ({
  bundle: "sirius_worker",
  nid: N.smw,
  vid: N.smw,
  title: `Status Worker ${N.smw}`,
  uid: 1,
  status: 1,
  created: CHANGED_EPOCH,
  changed: CHANGED_EPOCH,
  fields: {
    // no field_sirius_contact on purpose: T6 only reads member-status tids;
    // T3/T1 is not run by this smoke and cleanup removes the staged row.
    field_sirius_member_status: tids.map((tid) => ({ tid })),
  },
});

const logRec = (type: string, category: string, notes: string, handlerNid: number, nid: number = N.log1) => ({
  bundle: "sirius_log",
  nid,
  vid: nid,
  title: `Log ${nid}`,
  uid: 1,
  status: 1,
  created: LOG_CREATED_EPOCH,
  changed: LOG_CREATED_EPOCH,
  fields: {
    field_sirius_type: { value: type },
    field_sirius_category: { value: category },
    field_sirius_log_handler: [{ target_id: handlerNid }],
    field_sirius_notes: { value: notes },
    field_sirius_summary: { value: "smoke summary" },
  },
});

// ---------------------------------------------------------------------------
// cleanup (idempotent; run before seeding AND in finally)
// ---------------------------------------------------------------------------
let borrowedWorkerId: string | null = null;

async function cleanup() {
  const ms = await mappingOf("worker-ms", N.smw);
  const wk = ms?.s2Id ?? borrowedWorkerId;
  if (wk) {
    await db.execute(sql`DELETE FROM worker_msh WHERE worker_id = ${wk} AND data->>'source' = 's1-migration'`);
  }
  for (const nid of [N.log1, N.log2]) {
    const cl = await mappingOf("call_log", nid);
    if (cl) {
      await db.execute(sql`DELETE FROM comm WHERE id = ${cl.s2Id}`); // interaction cascades
    }
  }
  // incomplete-pair fixture (crash-safe: also deleted inline in its phase)
  await db.execute(sql`DELETE FROM comm WHERE data->>'s1Loader' = ${SMOKE_LOADER}`);
  await db.execute(
    sql`DELETE FROM s1_staging.records
        WHERE nid BETWEEN ${NID_LO} AND ${NID_HI} AND bundle IN ('sirius_worker','sirius_log')`,
  );
  await db.execute(
    sql`DELETE FROM s1_staging.id_map
        WHERE (entity IN ('worker','worker-ms','call_log') AND s1_id BETWEEN ${NID_LO} AND ${NID_HI})
           OR (entity = 'term' AND s1_id IN (${N.tid1}, ${N.tid2}))`,
  );
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  await cleanup();

  // ---- real dev prerequisites ---------------------------------------------
  const msOptions = await rows<{ id: string; industry_id: string }>(
    sql`SELECT id, industry_id FROM options_worker_ms ORDER BY id LIMIT 2`,
  );
  const reasonSeeds = await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM options_call_reason WHERE sirius_id IS NOT NULL`);
  const cleanWorkers = await rows<{ id: string; contact_id: string }>(
    sql`SELECT w.id, w.contact_id FROM workers w
        WHERE w.contact_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM worker_msh m WHERE m.worker_id = w.id)
          AND NOT EXISTS (SELECT 1 FROM s1_staging.id_map im WHERE im.entity IN ('worker','worker-ms') AND im.s2_id = w.id)
        ORDER BY w.id LIMIT 2`,
  );
  const handler = await rows<{ s1_id: string; s2_id: string }>(
    sql`SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m JOIN contacts c ON c.id = m.s2_id
        WHERE m.entity = 'contact' AND NOT m.stub ORDER BY m.s1_id LIMIT 1`,
  );
  if (
    msOptions.length < 2 ||
    Number(reasonSeeds[0]?.n ?? 0) === 0 ||
    cleanWorkers.length < 2 ||
    cleanWorkers[0].contact_id === cleanWorkers[1].contact_id ||
    handler.length < 1
  ) {
    console.error(
      "SETUP FAIL: need ≥2 worker-ms options, seeded options_call_reason sirius_ids, " +
        "two workers (distinct contacts) without msh history/mappings, and one mapped contact in the dev DB.",
    );
    process.exit(1);
  }
  const [ms1, ms2] = msOptions;
  borrowedWorkerId = cleanWorkers[0].id;
  const worker1ContactId = cleanWorkers[0].contact_id;
  const worker2Id = cleanWorkers[1].id;
  const worker2ContactId = cleanWorkers[1].contact_id;
  const handlerNid = Number(handler[0].s1_id);
  const handlerContactId = handler[0].s2_id;

  await putMapping("term", N.tid1, ms1.id, { stub: false, loader: SMOKE_LOADER });
  await putMapping("term", N.tid2, ms2.id, { stub: false, loader: SMOKE_LOADER });
  await putMapping("worker", N.smw, borrowedWorkerId, { stub: false, loader: SMOKE_LOADER });

  try {
    // =========================================================== T6 phases
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

    // =========================================================== N21 phases
    console.log("n21 phase 1: create — MSR log → comm + interaction");
    await upsertRecords([logRec("Enrollment", "Call From Member", "smoke note", handlerNid)]);
    let n21 = runN21();
    check("n21 run 1 exits 0", n21.status === 0, n21.result?.rejectGate);
    const clMap = await mappingOf("call_log", N.log1);
    check("call_log mapped", !!clMap && !clMap.stub);
    if (!clMap) throw new Error("cannot continue without the call_log mapping");
    const comm1 = (await rows<any>(sql`SELECT contact_id, medium FROM comm WHERE id = ${clMap.s2Id}`))[0];
    check("comm created for handler contact", comm1?.contact_id === handlerContactId && comm1?.medium === "interaction", comm1?.medium);
    const int1 = (await rows<any>(
      sql`SELECT ci.channel, ci.notes, ocr.sirius_id AS reason FROM comm_interaction ci
          JOIN options_call_reason ocr ON ocr.id = ci.call_reason_id WHERE ci.comm_id = ${clMap.s2Id}`,
    ))[0];
    check("interaction channel call_from_member", int1?.channel === "call_from_member", int1?.channel);
    check("interaction reason enrollment", int1?.reason === "enrollment", int1?.reason);
    // loader contract: notes = field_sirius_summary + field_sirius_notes
    // concatenated with a blank line (value compared, never printed)
    check("interaction notes loaded", int1?.notes === "smoke summary\n\nsmoke note");

    console.log("n21 phase 2: update — type/category/notes edits converge");
    await upsertRecords([logRec("Other", "Office Visit", "smoke note v2", handlerNid)]);
    n21 = runN21();
    check("n21 run 2 exits 0 with update", n21.status === 0 && (n21.result?.summary?.updated ?? 0) >= 1, n21.result?.summary);
    const int2 = (await rows<any>(
      sql`SELECT ci.channel, ci.notes, ocr.sirius_id AS reason FROM comm_interaction ci
          JOIN options_call_reason ocr ON ocr.id = ci.call_reason_id WHERE ci.comm_id = ${clMap.s2Id}`,
    ))[0];
    check("interaction channel updated", int2?.channel === "office_visit", int2?.channel);
    check("interaction reason updated", int2?.reason === "other", int2?.reason);
    check("interaction notes updated", int2?.notes === "smoke summary\n\nsmoke note v2");

    console.log("n21 phase 3: dependency repoint — worker's resolved contact changes, log untouched");
    // log2's handler targets the WORKER nid → resolves via the worker
    // fallback to worker 1's contact.
    await upsertRecords([logRec("Enrollment", "Call From Member", "smoke note w", N.smw, N.log2)]);
    n21 = runN21();
    check("n21 log2 run exits 0", n21.status === 0, n21.result?.rejectGate);
    const cl2Map = await mappingOf("call_log", N.log2);
    check("log2 mapped", !!cl2Map && !cl2Map.stub);
    if (!cl2Map) throw new Error("cannot continue without the log2 mapping");
    let comm2 = (await rows<any>(sql`SELECT contact_id FROM comm WHERE id = ${cl2Map.s2Id}`))[0];
    check("log2 comm resolved via worker fallback to worker 1's contact", comm2?.contact_id === worker1ContactId);
    // Repoint the worker mapping (S1 repair/remap case) WITHOUT editing the
    // log node: the resolved handler outcome is part of the consumed
    // fingerprint, so the loader must reprocess and retarget the comm even
    // though the staged log bytes are identical. (putMapping ON CONFLICT
    // never updates s2_id — rekey is DELETE + putMapping.)
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'worker' AND s1_id = ${N.smw}`);
    await putMapping("worker", N.smw, worker2Id, { stub: false, loader: SMOKE_LOADER });
    n21 = runN21();
    check("repoint run exits 0 with an update", n21.status === 0 && (n21.result?.summary?.updated ?? 0) >= 1, n21.result?.summary);
    comm2 = (await rows<any>(sql`SELECT contact_id FROM comm WHERE id = ${cl2Map.s2Id}`))[0];
    check("comm retargeted to worker 2's contact", comm2?.contact_id === worker2ContactId);

    console.log("n21 phase 3b: incomplete-pair guard — update must not touch a comm whose interaction is missing");
    // Regression: updateInteractionWithCommForMigration used to update the
    // parent comm BEFORE discovering the child interaction row was missing,
    // and `return false` still committed — a "failed" row came out mutated.
    // Seed an interaction-medium comm WITHOUT its comm_interaction child and
    // assert the call reports false with the comm byte-identical.
    const orphanIns = await rows<{ id: string }>(sql`
      INSERT INTO comm (medium, contact_id, status, sent, data)
      VALUES ('interaction', ${worker1ContactId}, 'logged', '2026-01-05T00:00:00Z', ${JSON.stringify({ s1Loader: SMOKE_LOADER, kind: "incomplete-pair-fixture" })}::jsonb)
      RETURNING id
    `);
    const orphanId = orphanIns[0]?.id;
    check("incomplete-pair fixture seeded", Boolean(orphanId));
    if (orphanId) {
      const before = (await rows<any>(sql`SELECT contact_id, sent::text AS sent, data FROM comm WHERE id = ${orphanId}`))[0];
      const ok = await createCommInteractionStorage().updateInteractionWithCommForMigration(orphanId, {
        contactId: worker2ContactId,
        occurredAt: new Date("2026-03-03T00:00:00Z"),
        channel: "phone_in",
        notes: "must never land",
      });
      const after = (await rows<any>(sql`SELECT contact_id, sent::text AS sent, data FROM comm WHERE id = ${orphanId}`))[0];
      check("incomplete pair reports false", ok === false);
      check(
        "comm untouched by failed update",
        after?.contact_id === before?.contact_id && after?.sent === before?.sent && JSON.stringify(after?.data) === JSON.stringify(before?.data),
        { before, after },
      );
      await db.execute(sql`DELETE FROM comm WHERE id = ${orphanId}`);
    }

    console.log("n21 phase 4: sweep — staged log deleted → comm removed");
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_log' AND nid = ${N.log1}`);
    n21 = runN21();
    check("n21 sweep run exits 0", n21.status === 0, n21.result?.rejectGate);
    check("n21 sweep counted a deletion", (n21.result?.summary?.deleted ?? 0) >= 1, n21.result?.summary);
    check("comm row gone", (await rows<any>(sql`SELECT id FROM comm WHERE id = ${clMap.s2Id}`)).length === 0);
    check("call_log mapping gone", (await mappingOf("call_log", N.log1)) === null);
    check("unswept log2 comm survives", (await rows<any>(sql`SELECT id FROM comm WHERE id = ${cl2Map.s2Id}`)).length === 1);
  } finally {
    console.log("cleanup: removing seeded rows + S2 artifacts");
    await cleanup();
  }

  console.log(failures === 0 ? "\nCOMMS/STATUSES SYNC SMOKE PASS" : `\nCOMMS/STATUSES SYNC SMOKE FAIL (${failures} failures)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
