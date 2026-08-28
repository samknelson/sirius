/**
 * Dev-only smoke for the converted beneficiaries loader (Task 348 —
 * RUNBOOK §10): versioned consumed fingerprints, --force-reconcile,
 * logic-version reprocessing, owned clear sweep under the fast path, the
 * vanished-source-worker report-only policy, and the standard result
 * envelope — proven end-to-end against the dev database.
 *
 * Scenarios (delta-based — tolerant of whatever the seeded trap state is):
 *   R1  baseline: converted loader run backfills fingerprints (adopt/write)
 *   R2  all-unchanged: no writes/adopts/clears; owned rows fast-skip
 *   R3  manual S2 drift stays untouched behind an unchanged fingerprint
 *   R4  --force-reconcile heals the drift (S1 wins)
 *   R5  logic_version=0 downgrade reprocesses exactly that worker (adopt)
 *   R6  staged list emptied → owned clear sweep clears the S2 list
 *   R7  staged list restored → owned rewrite converges back
 *   R8  staged worker DELETED entirely → blocking source_worker_missing
 *       finding (exit 1), S2 list + mapping PRESERVED
 *   R9  --allow-findings source_worker_missing acknowledges (exit 0)
 *   R10 staged worker restored → clean run, no findings, fast path resumes
 *
 * NEVER restages dev (staging regen invalidates id_map — see memory). All
 * staged edits go through upsertRecords with saved-row restores in a
 * finally block. Beneficiary fingerprints derive from DECODED state, not
 * content_hash, so no hash backfill is needed here.
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-sync-beneficiaries.ts
 */
import { spawnSync } from "node:child_process";
import { getRawProcessEnv } from "../lib/script-env";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage/database";
import { withNotificationsSuppressed } from "../../../server/middleware/request-context";
import { ensureStagingSchema, upsertRecords, type StagedRecord } from "../lib/staging";
import { ensureIdMap, deleteMapping, getMappings } from "../lib/idmap";
import { type LoaderResult } from "../lib/sync";
import { type BaoBeneficiaryList } from "../../../shared/schema/sitespecific/bao/schema";

const ENTITY = "bao-beneficiaries";
const ALLOW =
  "worker_unmapped,percent_sum_mismatch,pct_unusable,bad_json,unexpected_tier,list_exists_foreign,worker_map_broken";

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, any>> }).rows;

let runSeq = 0;
function runLoader(args: string[]): { code: number; result: LoaderResult | null } {
  const resultPath = `/tmp/t348-ben-smoke-${process.pid}-${++runSeq}.json`;
  const t0 = Date.now();
  const proc = spawnSync("npx", ["tsx", "scripts/s1-migration/load-beneficiaries.ts", ...args], {
    cwd: process.cwd(),
    env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: resultPath },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  let result: LoaderResult | null = null;
  if (existsSync(resultPath)) {
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8")) as LoaderResult;
    } catch { /* leave null */ }
    try { unlinkSync(resultPath); } catch { /* ignore */ }
  }
  console.log(`  · load-beneficiaries ${args.join(" ")} → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (result == null) {
    console.log(`  · NO RESULT ENVELOPE — stdout tail:\n${(proc.stdout ?? "").slice(-2000)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-2000)}`);
  } else if (proc.status !== 0) {
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-800)}`);
  }
  return { code: proc.status ?? -1, result };
}
const detailOf = (r: { result: LoaderResult | null }): Record<string, any> =>
  ((r.result?.detail ?? {}) as Record<string, any>);

async function readRecord(bundle: string, nid: number): Promise<StagedRecord> {
  const r = rowsOf(await db.execute(sql`
    SELECT bundle, nid, vid, title, uid, status, created, changed, fields
      FROM s1_staging.records WHERE bundle = ${bundle} AND nid = ${nid}
  `))[0];
  if (!r) throw new Error(`record ${bundle}/${nid} not staged`);
  return {
    bundle: String(r.bundle),
    nid: Number(r.nid),
    vid: r.vid == null ? null : Number(r.vid),
    title: r.title == null ? null : String(r.title),
    uid: r.uid == null ? null : Number(r.uid),
    status: r.status == null ? null : Number(r.status),
    created: r.created == null ? null : Number(r.created),
    changed: r.changed == null ? null : Number(r.changed),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
  };
}

/** Parse the worker's field_sirius_json regardless of staged wrapper shape. */
function readJsonBlob(fields: Record<string, unknown>): unknown {
  let v: unknown = fields["field_sirius_json"];
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    v = (v as Record<string, unknown>).value;
  }
  if (v == null) return null;
  return typeof v === "string" ? JSON.parse(v) : v;
}

/** Serialize `obj` back into field_sirius_json PRESERVING the wrapper shape
 * (bare string / {value} / first array delta). */
function writeJsonBlob(fields: Record<string, unknown>, obj: unknown): void {
  const serialized = JSON.stringify(obj);
  const cur = fields["field_sirius_json"];
  if (Array.isArray(cur)) {
    const first = cur[0];
    if (first && typeof first === "object" && "value" in (first as Record<string, unknown>)) {
      fields["field_sirius_json"] = [{ ...(first as Record<string, unknown>), value: serialized }, ...cur.slice(1)];
    } else {
      fields["field_sirius_json"] = [serialized, ...cur.slice(1)];
    }
  } else if (cur && typeof cur === "object" && "value" in (cur as Record<string, unknown>)) {
    fields["field_sirius_json"] = { ...(cur as Record<string, unknown>), value: serialized };
  } else {
    fields["field_sirius_json"] = serialized;
  }
}

const normList = (list: BaoBeneficiaryList) =>
  JSON.stringify(
    list.map((r) => ({
      name: r.name,
      percent: r.percent,
      ssn: r.ssn ?? null,
      phone: r.phone ?? null,
      address: r.address ?? null,
      relationship: r.relationship ?? null,
    })),
  );

/** Dev prep: drop bao-beneficiaries authorship rows whose staged worker
 * vanished in a synthetic regen (memory: s1-regen-idmap-staleness) — historic
 * garbage that would otherwise surface as source_worker_missing findings. */
async function dropStaleOwnershipMappings(): Promise<void> {
  const stale = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = ${ENTITY} AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_worker' AND r.nid = m.s1_id)
  `));
  for (const r of stale) await deleteMapping(ENTITY, Number(r.s1_id));
  if (stale.length > 0) {
    console.log(`  · prep: dropped ${stale.length} stale dev ${ENTITY} mapping(s): ${stale.map((r) => r.s1_id).join(",")}`);
  }
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  console.log("=== smoke-sync-beneficiaries (Task 348) ===");
  await dropStaleOwnershipMappings();

  const baseArgs = ["--allow-rejects", ALLOW];

  // R1 — baseline: first converted run backfills fingerprints.
  const r1 = runLoader(baseArgs);
  check("R1 baseline exits 0", r1.code === 0);
  check("R1 emits the standard envelope", r1.result != null && r1.result.loader === "t-bao-beneficiaries");
  check("R1 logicVersion is 1", r1.result?.logicVersion === 1);
  const fpCount = Number(rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM s1_staging.id_map
     WHERE entity = ${ENTITY} AND consumed_fingerprint IS NOT NULL AND logic_version = 1
  `))[0]?.c ?? 0);
  check("R1 stamped versioned fingerprints", fpCount > 0, `stamped=${fpCount}`);

  // R2 — all-unchanged: owned rows fast-skip; no writes/adopts/clears left.
  const r2 = runLoader(baseArgs);
  const d2 = detailOf(r2);
  check("R2 exits 0", r2.code === 0);
  check("R2 no writes", d2.workersWritten === 0, `written=${d2.workersWritten}`);
  check("R2 no adopts", d2.workersAdopted === 0, `adopted=${d2.workersAdopted}`);
  check("R2 no clears", d2.workersCleared === 0 && d2.workersAlreadyEmpty === 0,
    `cleared=${d2.workersCleared} alreadyEmpty=${d2.workersAlreadyEmpty}`);
  check("R2 fast path engaged", Number(d2.fastPathSkips) > 0, `fastPathSkips=${d2.fastPathSkips}`);
  check("R2 summary.unchanged == fast-path skips", r2.result?.summary.unchanged === d2.fastPathSkips,
    `unchanged=${r2.result?.summary.unchanged}`);

  // Pick an owned, verified worker with a populated S2 list as the guinea pig.
  let nid = 0;
  let workerId = "";
  let savedList: BaoBeneficiaryList = [];
  for (const m of rowsOf(await db.execute(sql`
    SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m
     WHERE m.entity = ${ENTITY} AND m.stub = false AND m.consumed_fingerprint IS NOT NULL
       AND EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_worker' AND r.nid = m.s1_id)
     ORDER BY m.s1_id
  `))) {
    try {
      const list = await storage.baoBeneficiaries.get(String(m.s2_id));
      if (list.length > 0) {
        nid = Number(m.s1_id);
        workerId = String(m.s2_id);
        savedList = list;
        break;
      }
    } catch { /* dead target (w11 trap) — keep scanning */ }
  }
  check("found an owned populated worker to probe", nid > 0, `nid=${nid}`);
  if (nid === 0) throw new Error("no probe-able owned worker — cannot continue");
  const savedRecord = await readRecord("sirius_worker", nid);

  try {
    // R3 — manual S2 drift behind an unchanged fingerprint stays untouched.
    await withNotificationsSuppressed(() =>
      storage.baoBeneficiaries.set(workerId, [{ name: "SMOKE DRIFT", percent: 100 }]),
    );
    const r3 = runLoader(baseArgs);
    check("R3 exits 0", r3.code === 0);
    const drifted = await storage.baoBeneficiaries.get(workerId);
    check("R3 drifted S2 list untouched (row truly skipped)",
      drifted.length === 1 && drifted[0].name === "SMOKE DRIFT");

    // R4 — --force-reconcile heals the drift (S1 wins).
    const r4 = runLoader([...baseArgs, "--force-reconcile"]);
    const d4 = detailOf(r4);
    check("R4 force-reconcile exits 0", r4.code === 0);
    check("R4 loader reports forceReconcile", r4.result?.forceReconcile === true);
    check("R4 drift healed back to staged list",
      normList(await storage.baoBeneficiaries.get(workerId)) === normList(savedList));
    check("R4 rewrote the drifted worker", Number(d4.workersRewritten) >= 1, `rewritten=${d4.workersRewritten}`);

    // R5 — logic-version-only downgrade reprocesses exactly that worker.
    await db.execute(sql`
      UPDATE s1_staging.id_map SET logic_version = 0 WHERE entity = ${ENTITY} AND s1_id = ${nid}
    `);
    const r5 = runLoader(baseArgs);
    const d5 = detailOf(r5);
    check("R5 exits 0", r5.code === 0);
    check("R5 downgraded worker reprocessed as adopt", d5.workersAdopted === 1 && d5.workersWritten === 0,
      `adopted=${d5.workersAdopted} written=${d5.workersWritten}`);
    const m5 = (await getMappings(ENTITY, [nid])).get(nid);
    check("R5 logic_version restored to 1", m5?.logicVersion === 1 && m5?.consumedFingerprint != null);

    // R6 — staged list emptied → owned clear sweep clears S2.
    {
      const rec = await readRecord("sirius_worker", nid);
      const blob = readJsonBlob(rec.fields);
      const obj = blob && typeof blob === "object" && !Array.isArray(blob) ? (blob as Record<string, unknown>) : {};
      obj["beneficiaries"] = { primary: [] };
      writeJsonBlob(rec.fields, obj);
      await upsertRecords([rec]);
    }
    const r6 = runLoader(baseArgs);
    const d6 = detailOf(r6);
    check("R6 exits 0", r6.code === 0);
    check("R6 cleared the owned list", Number(d6.workersCleared) === 1, `cleared=${d6.workersCleared}`);
    check("R6 S2 list is now empty", (await storage.baoBeneficiaries.get(workerId)).length === 0);

    // R7 — staged list restored → owned rewrite converges back.
    await upsertRecords([savedRecord]);
    const r7 = runLoader(baseArgs);
    const d7 = detailOf(r7);
    check("R7 exits 0", r7.code === 0);
    check("R7 rewrote the restored worker", Number(d7.workersRewritten) === 1, `rewritten=${d7.workersRewritten}`);
    check("R7 S2 list converged back to staged",
      normList(await storage.baoBeneficiaries.get(workerId)) === normList(savedList));

    // R8 — staged worker DELETED entirely → blocking source_worker_missing.
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${nid}`);
    const r8 = runLoader(baseArgs);
    check("R8 vanished source worker blocks (exit 1)", r8.code === 1);
    const f8 = (r8.result?.findings ?? []).filter((f) => f.kind === "source_worker_missing");
    check("R8 emits source_worker_missing finding for the nid",
      f8.some((f) => Number(f.s1Id) === nid), `findings=${f8.map((f) => f.s1Id).join(",")}`);
    check("R8 S2 list PRESERVED", normList(await storage.baoBeneficiaries.get(workerId)) === normList(savedList));
    check("R8 authorship mapping PRESERVED", (await getMappings(ENTITY, [nid])).has(nid));

    // R9 — acknowledged via --allow-findings (report-only; still emitted).
    const r9 = runLoader([...baseArgs, "--allow-findings", "source_worker_missing"]);
    check("R9 --allow-findings exits 0", r9.code === 0);
    check("R9 finding still reported", (r9.result?.findings ?? []).some((f) => f.kind === "source_worker_missing"));
    check("R9 summary.reportOnly counted", (r9.result?.summary.reportOnly ?? 0) >= 1,
      `reportOnly=${r9.result?.summary.reportOnly}`);

    // R10 — staged worker restored → clean, no findings, fast path resumes.
    await upsertRecords([savedRecord]);
    const r10 = runLoader(baseArgs);
    const d10 = detailOf(r10);
    check("R10 exits 0 after restore", r10.code === 0);
    check("R10 no findings", (r10.result?.findings ?? []).length === 0);
    check("R10 restored worker fast-skips (fingerprint survived the outage)",
      d10.workersWritten === 0 && d10.workersAdopted === 0, `written=${d10.workersWritten} adopted=${d10.workersAdopted}`);
  } finally {
    // Restore staged truth + S2 list no matter what failed above.
    try { await upsertRecords([savedRecord]); } catch (e) { console.error("RESTORE FAILED (staged row)", e); }
    try {
      if (normList(await storage.baoBeneficiaries.get(workerId)) !== normList(savedList)) {
        await withNotificationsSuppressed(() => storage.baoBeneficiaries.set(workerId, savedList));
        console.log("  · restore: S2 list put back from saved copy");
      }
    } catch (e) { console.error("RESTORE FAILED (S2 list)", e); }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
