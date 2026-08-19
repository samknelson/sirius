/**
 * Dev-only smoke for the converted cardchecks loader (Task 348 —
 * RUNBOOK §10): mapped-row reconciliation via versioned consumed
 * fingerprints (records AND definitions), in-place S1 status transitions
 * (unsigned → signed → revoked → wiped-back-to-unsigned) converging on the
 * next sync and immediately affecting eligibility reads, payload-only
 * edits, logic-version-only refresh, changed definition inputs
 * (disclaimer node edits), duplicate-signed conflicts on update, and the
 * report-only pending_retention deletion sweep — proven end-to-end against
 * the dev database.
 *
 * Scenario map (delta-based — tolerant of prior dev runs):
 *   R1  baseline converted run (fingerprint backfill)
 *   R2  all-unchanged: records + definitions fully fast-skip
 *   R3  synthetic staged record S → created (pending)
 *   R4  S unsigned→signed → mapped row UPDATED; eligibility read flips on
 *   R5  S signed→revoked → status converges; eligibility read flips off
 *   R6  S wiped back to unsigned (payload nulled) + synthetic T created
 *   R7  T unsigned→signed while S signed — wait, S is pending: T signs
 *       against a definition+worker that ALREADY has a signed record (R6
 *       re-signs S first) → DUPLICATE_SIGNED reject blocks (exit 1)
 *   R8  same run with --allow-rejects +duplicate_signed → exit 0, T stays
 *       pending in S2, its fingerprint does NOT advance (retries next run)
 *   R9  staged T deleted → blocking pending_retention finding (exit 1);
 *       S2 row + mapping PRESERVED
 *   R10 --allow-findings pending_retention → exit 0, still reported
 *   R10b/c signed S relocated onto an OCCUPIED pair → duplicate_signed
 *       blocks (validator fires on pair CHANGE, not just sign), row +
 *       fingerprint frozen; restore fast-skips
 *   R10d/e signed S relocated to a FREE pair → clean update (and back);
 *       then a storage-level probe asserts CARDCHECK_SAVED fires for BOTH
 *       affected workers on a signed→signed relocation
 *   R11 payload-only edit (seeded signed record) + record logic_version=0
 *       (different seeded record) + disclaimer-node edit → exactly one
 *       record updated, one adopted, definition updated; records of the
 *       edited definition do NOT reprocess (identity, not content, is in
 *       record fingerprints)
 *   R12 restores → converge back
 *   R13 --force-reconcile → everything reprocesses as adopts, no writes
 *   R14 final clean run — full fast path, no findings
 *
 * NEVER restages dev. Staged edits go through upsertRecords (recomputes
 * content_hash) with saved-row restores in a finally block; synthetic rows
 * live in a reserved 9992xxxx nid range and are removed (staging + S2 +
 * id_map) on the way out.
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-sync-cardchecks.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage/database";
import { eventBus, EventType } from "../../../server/services/event-bus";
import { ensureStagingSchema, upsertRecords, type StagedRecord } from "../lib/staging";
import { ensureIdMap, deleteMapping, getMappings } from "../lib/idmap";
import { type LoaderResult } from "../lib/sync";

const REC_ENTITY = "cardcheck";
const DEF_ENTITY = "cardcheck-definition";
const ALLOW = "disclaimer_missing,handler_dangling,bad_json,handler_unresolved";
const DEF_A = 99910001; // seeded: full definition (disclaimer 99910003 + customfield 99910004)
const DEF_B = 99910002; // seeded: disclaimer pointer 99910005 deliberately missing
const DISC_A = 99910003;
const SEED_LO = 99910101;
const SEED_HI = 99910110;
const S_NID = 99920001; // synthetic transition record (this smoke's)
const T_NID = 99920002; // synthetic duplicate-signed record (this smoke's)
const ACCEPT_TS = 1717300001;
const REVOKE_TS = 1717400001;

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, any>> }).rows;

let runSeq = 0;
function runLoader(args: string[]): { code: number; result: LoaderResult | null } {
  const resultPath = `/tmp/t348-cc-smoke-${process.pid}-${++runSeq}.json`;
  const t0 = Date.now();
  const proc = spawnSync("npx", ["tsx", "scripts/s1-migration/load-cardchecks.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, S1_RESULT_JSON_PATH: resultPath },
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
  console.log(`  · load-cardchecks ${args.join(" ")} → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (result == null) {
    console.log(`  · NO RESULT ENVELOPE — stdout tail:\n${(proc.stdout ?? "").slice(-2000)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-2000)}`);
  } else if (proc.status !== 0) {
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-800)}`);
  }
  return { code: proc.status ?? -1, result };
}
const detailOf = (r: { result: LoaderResult | null }): Record<string, any> =>
  ((r.result?.detail ?? {}) as Record<string, any>);
const statsOf = (r: { result: LoaderResult | null }): Record<string, number> =>
  (detailOf(r).stats ?? {}) as Record<string, number>;
const defStatsOf = (r: { result: LoaderResult | null }): Record<string, number> =>
  (detailOf(r).definitions ?? {}) as Record<string, number>;

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

function readJsonBlob(fields: Record<string, unknown>): unknown {
  let v: unknown = fields["field_sirius_json"];
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    v = (v as Record<string, unknown>).value;
  }
  if (v == null) return null;
  return typeof v === "string" ? JSON.parse(v) : v;
}

function writeJsonBlob(fields: Record<string, unknown>, obj: unknown): void {
  const serialized = obj == null ? null : JSON.stringify(obj);
  const cur = fields["field_sirius_json"];
  if (Array.isArray(cur)) {
    const first = cur[0];
    if (first && typeof first === "object" && "value" in (first as Record<string, unknown>)) {
      fields["field_sirius_json"] = [{ ...(first as Record<string, unknown>), value: serialized }, ...cur.slice(1)];
    } else {
      fields["field_sirius_json"] = serialized == null ? [null, ...cur.slice(1)] : [serialized, ...cur.slice(1)];
    }
  } else if (cur && typeof cur === "object" && "value" in (cur as Record<string, unknown>)) {
    fields["field_sirius_json"] = { ...(cur as Record<string, unknown>), value: serialized };
  } else {
    fields["field_sirius_json"] = serialized;
  }
}

async function s2Cardcheck(nid: number): Promise<{ id: string; workerId: string; definitionId: string; status: string; signedEpoch: number | null; s1: any } | null> {
  const m = (await getMappings(REC_ENTITY, [nid])).get(nid);
  if (!m) return null;
  const row = rowsOf(await db.execute(sql`
    SELECT id, worker_id, cardcheck_definition_id, status, signed_date, data
      FROM cardchecks WHERE id = ${m.s2Id}
  `))[0];
  if (!row) return null;
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    definitionId: String(row.cardcheck_definition_id),
    status: String(row.status),
    signedEpoch: row.signed_date == null ? null : new Date(row.signed_date).getTime(),
    s1: (data ?? {}).s1 ?? null,
  };
}

/** Dev prep: drop cardcheck/cardcheck-definition mappings whose staged
 * source vanished in a synthetic regen (historic garbage — would surface as
 * findings), and record mappings whose S2 row was deleted out-of-band (dev
 * churn — would fail the existence verify forever). */
async function prepMappings(): Promise<void> {
  const staleRecs = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = ${REC_ENTITY} AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_log' AND r.nid = m.s1_id)
  `));
  for (const r of staleRecs) await deleteMapping(REC_ENTITY, Number(r.s1_id));
  if (staleRecs.length > 0) console.log(`  · prep: dropped ${staleRecs.length} stale ${REC_ENTITY} mapping(s): ${staleRecs.map((r) => r.s1_id).join(",")}`);
  const staleDefs = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = ${DEF_ENTITY} AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_json_definition' AND r.nid = m.s1_id)
  `));
  for (const r of staleDefs) await deleteMapping(DEF_ENTITY, Number(r.s1_id));
  if (staleDefs.length > 0) console.log(`  · prep: dropped ${staleDefs.length} stale ${DEF_ENTITY} mapping(s): ${staleDefs.map((r) => r.s1_id).join(",")}`);
  const dangling = rowsOf(await db.execute(sql`
    SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m
     WHERE m.entity = ${REC_ENTITY} AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM cardchecks c WHERE c.id = m.s2_id)
  `));
  for (const r of dangling) await deleteMapping(REC_ENTITY, Number(r.s1_id));
  if (dangling.length > 0) console.log(`  · prep: dropped ${dangling.length} dangling ${REC_ENTITY} mapping(s) (S2 row gone): ${dangling.map((r) => r.s1_id).join(",")}`);
  const danglingDefs = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = ${DEF_ENTITY} AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM cardcheck_definitions d WHERE d.id = m.s2_id)
  `));
  for (const r of danglingDefs) await deleteMapping(DEF_ENTITY, Number(r.s1_id));
  if (danglingDefs.length > 0) console.log(`  · prep: dropped ${danglingDefs.length} dangling ${DEF_ENTITY} mapping(s)`);
}

/** Dev prep: seeded fake rows were raw-INSERTed without content_hash; any
 * NULL-hash staged record never fast-skips. Re-upsert exactly those rows so
 * hashes populate (idempotent; never restages). */
async function backfillNullHashes(): Promise<void> {
  const rows = rowsOf(await db.execute(sql`
    SELECT bundle, nid FROM s1_staging.records WHERE content_hash IS NULL ORDER BY bundle, nid
  `));
  if (rows.length === 0) return;
  const recs: StagedRecord[] = [];
  for (const r of rows) recs.push(await readRecord(String(r.bundle), Number(r.nid)));
  await upsertRecords(recs);
  console.log(`  · prep: backfilled content_hash on ${recs.length} staged record(s)`);
}

function syntheticRecord(nid: number, defNid: number, workerNid: number): StagedRecord {
  return {
    bundle: "sirius_log",
    nid,
    vid: nid,
    title: `smoke cardcheck ${nid}`,
    uid: 1,
    status: 1,
    created: 1717200002,
    changed: 1717200002,
    fields: {
      field_sirius_category: "cardcheck",
      field_sirius_type: "unsigned",
      field_sirius_log_handler: [String(defNid), String(workerNid)],
      field_sirius_json: null,
    },
  };
}

async function setStatusAndPayload(nid: number, status: "unsigned" | "signed" | "revoked", payload: unknown): Promise<void> {
  const rec = await readRecord("sirius_log", nid);
  rec.fields["field_sirius_type"] = status;
  writeJsonBlob(rec.fields, payload);
  rec.changed = (rec.changed ?? 1717200002) + 1;
  await upsertRecords([rec]);
}

async function cleanupSynthetic(nid: number): Promise<void> {
  const m = (await getMappings(REC_ENTITY, [nid])).get(nid);
  if (m) {
    try { await storage.cardchecks.deleteCardcheck(m.s2Id); } catch { /* already gone */ }
    await deleteMapping(REC_ENTITY, nid);
  }
  await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_log' AND nid = ${nid}`);
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  console.log("=== smoke-sync-cardchecks (Task 348) ===");

  // Seed the fakes if this dev DB has never had them.
  const seeded = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM s1_staging.records WHERE bundle = 'sirius_json_definition' AND nid = ${DEF_A}
  `))[0];
  if (Number(seeded.c) === 0) {
    console.log("  · prep: seeding cardcheck fakes (seed-cardcheck-fakes.ts)");
    const p = spawnSync("npx", ["tsx", "scripts/s1-migration/dev/seed-cardcheck-fakes.ts"], {
      cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    if (p.status !== 0) throw new Error(`seed failed:\n${(p.stderr ?? "").slice(-2000)}`);
  }
  await backfillNullHashes();
  await prepMappings();

  const baseArgs = ["--allow-rejects", ALLOW, "--migration-mode"];

  // R1 — baseline converted run (fingerprint backfill for pre-conversion mappings).
  const r1 = runLoader(baseArgs);
  check("R1 baseline exits 0", r1.code === 0);
  check("R1 emits the standard envelope", r1.result != null && r1.result.loader === "cardchecks");
  check("R1 logicVersion is 1", r1.result?.logicVersion === 1);
  const fpRecs = Number(rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM s1_staging.id_map
     WHERE entity = ${REC_ENTITY} AND consumed_fingerprint IS NOT NULL AND logic_version = 1
  `))[0]?.c ?? 0);
  const fpDefs = Number(rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM s1_staging.id_map
     WHERE entity = ${DEF_ENTITY} AND consumed_fingerprint IS NOT NULL AND logic_version = 1
  `))[0]?.c ?? 0);
  check("R1 stamped record fingerprints", fpRecs > 0, `records=${fpRecs}`);
  check("R1 stamped definition fingerprints", fpDefs >= 2, `definitions=${fpDefs}`);

  // R2 — all-unchanged: full fast path on records AND definitions.
  const r2 = runLoader(baseArgs);
  const s2 = statsOf(r2), ds2 = defStatsOf(r2);
  check("R2 exits 0", r2.code === 0);
  check("R2 records fully fast-skip", s2.created === 0 && s2.updated === 0 && s2.adopted === 0 && s2.fastPathSkips > 0,
    `created=${s2.created} updated=${s2.updated} adopted=${s2.adopted} fastPathSkips=${s2.fastPathSkips}`);
  check("R2 definitions fully fast-skip", ds2.created === 0 && ds2.updated === 0 && ds2.adopted === 0 && ds2.fastPathSkips === ds2.staged,
    `staged=${ds2.staged} fastPathSkips=${ds2.fastPathSkips}`);
  check("R2 unchanged-def reject classes stop re-firing (disclaimer_missing absent)",
    (r2.result?.rejectGate.counts ?? {})["disclaimer_missing"] == null,
    JSON.stringify(r2.result?.rejectGate.counts ?? {}));

  // Resolve seeded worker nids + definition S2 ids for the synthetic rows.
  const defAS2 = String(rowsOf(await db.execute(sql`SELECT id FROM cardcheck_definitions WHERE sirius_id = ${String(DEF_A)}`))[0]?.id ?? "");
  const defBS2 = String(rowsOf(await db.execute(sql`SELECT id FROM cardcheck_definitions WHERE sirius_id = ${String(DEF_B)}`))[0]?.id ?? "");
  check("both seeded definitions exist in S2", defAS2 !== "" && defBS2 !== "");
  const workerNids: number[] = [];
  for (let nid = SEED_LO; nid <= SEED_HI; nid++) {
    const rec = await readRecord("sirius_log", nid).catch(() => null);
    if (!rec) continue;
    const handlers = (Array.isArray(rec.fields["field_sirius_log_handler"]) ? rec.fields["field_sirius_log_handler"] : []) as unknown[];
    for (const h of handlers) {
      const n = typeof h === "number" ? h : typeof h === "string" && /^\d+$/.test(h) ? Number(h) : null;
      if (n == null || n === DEF_A || n === DEF_B) continue;
      const staged = rowsOf(await db.execute(sql`
        SELECT 1 FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${n}
      `));
      if (staged.length > 0 && !workerNids.includes(n)) workerNids.push(n);
    }
  }
  check("found seeded worker nids", workerNids.length > 0, `workers=${workerNids.join(",")}`);
  // Pick a (worker, definition) pair with NO signed cardcheck right now, so
  // the synthetic transition cycle owns its duplicate-signed semantics.
  // Seeded workers are preferred, but the fixtures may already sign every
  // (seeded worker × seeded def) pair — fall back to any mapped staged worker
  // with no cardchecks at all on the seeded definitions.
  const workerMapAll = await getMappings("worker", workerNids);
  const candidates: Array<{ nid: number; s2: string }> = [];
  for (const cand of workerNids) {
    const wm = workerMapAll.get(cand);
    if (wm && !wm.stub) candidates.push({ nid: cand, s2: wm.s2Id });
  }
  for (const row of rowsOf(await db.execute(sql`
    SELECT r.nid, m.s2_id
    FROM s1_staging.records r
    JOIN s1_staging.id_map m ON m.entity = 'worker' AND m.s1_id = r.nid AND m.stub = false
    WHERE r.bundle = 'sirius_worker'
      AND NOT EXISTS (
        SELECT 1 FROM cardchecks c
        WHERE c.worker_id = m.s2_id
          AND c.cardcheck_definition_id IN (${defAS2}, ${defBS2})
      )
    ORDER BY r.nid
    LIMIT 5
  `))) {
    const nid = Number(row.nid);
    if (!candidates.some((c) => c.nid === nid)) candidates.push({ nid, s2: String(row.s2_id) });
  }
  let wNid = 0, wS2 = "", pairDefNid = 0, pairDefS2 = "";
  outer: for (const cand of candidates) {
    for (const [dNid, dS2] of [[DEF_B, defBS2], [DEF_A, defAS2]] as Array<[number, string]>) {
      if (!dS2) continue;
      const signed = rowsOf(await db.execute(sql`
        SELECT 1 FROM cardchecks WHERE worker_id = ${cand.s2} AND cardcheck_definition_id = ${dS2} AND status = 'signed' LIMIT 1
      `));
      if (signed.length === 0) {
        wNid = cand.nid; wS2 = cand.s2; pairDefNid = dNid; pairDefS2 = dS2;
        break outer;
      }
    }
  }
  check("found an unsigned (worker, definition) pair for transitions", wNid > 0,
    `worker=${wNid} def=${pairDefNid}`);
  if (wNid === 0) throw new Error("no transition pair available — cannot continue");

  const saved101 = await readRecord("sirius_log", SEED_LO); // seeded signed record (payload-edit target)
  const savedDisc = await readRecord("sirius_json_definition", DISC_A);
  let discEdited = false;

  try {
    // R3 — synthetic record S staged unsigned → created as pending.
    await upsertRecords([syntheticRecord(S_NID, pairDefNid, wNid)]);
    const r3 = runLoader(baseArgs);
    check("R3 exits 0", r3.code === 0);
    check("R3 created exactly one record", statsOf(r3).created === 1, `created=${statsOf(r3).created}`);
    const s3 = await s2Cardcheck(S_NID);
    check("R3 S is pending with the picked worker+definition",
      s3 != null && s3.status === "pending" && s3.workerId === wS2 && s3.definitionId === pairDefS2 && s3.signedEpoch == null,
      JSON.stringify({ status: s3?.status }));

    // R4 — unsigned → signed: mapped row must UPDATE (the old loader skipped
    // mapped rows unconditionally — this is the correctness-critical fix).
    await setStatusAndPayload(S_NID, "signed", {
      cardcheck: { acceptance: { ts: ACCEPT_TS, uid: 1 } },
      esig: { blob: "smoke-esig" },
    });
    const r4 = runLoader(baseArgs);
    check("R4 exits 0", r4.code === 0);
    check("R4 updated exactly one record", statsOf(r4).updated === 1, `updated=${statsOf(r4).updated}`);
    const s4 = await s2Cardcheck(S_NID);
    check("R4 S converged to signed with acceptance date",
      s4?.status === "signed" && s4.signedEpoch === ACCEPT_TS * 1000,
      JSON.stringify({ status: s4?.status, signedEpoch: s4?.signedEpoch }));
    const elig4 = await storage.cardchecks.getSignedWorkerIds([wS2], [pairDefS2]);
    check("R4 eligibility read sees the signature immediately", elig4.includes(wS2));

    // R5 — signed → revoked.
    await setStatusAndPayload(S_NID, "revoked", {
      cardcheck: { acceptance: { ts: ACCEPT_TS, uid: 1 }, revocation: { ts: REVOKE_TS, uid: 1 } },
      esig: { blob: "smoke-esig" },
    });
    const r5 = runLoader(baseArgs);
    check("R5 exits 0", r5.code === 0);
    const s5 = await s2Cardcheck(S_NID);
    check("R5 S converged to revoked", s5?.status === "revoked", `status=${s5?.status}`);
    const elig5 = await storage.cardchecks.getSignedWorkerIds([wS2], [pairDefS2]);
    check("R5 eligibility read no longer sees the signature", !elig5.includes(wS2));

    // R6 — wiped back to unsigned (payload nulled, S1 clear() semantics) and
    // re-sign it in the SAME run set; then stage T for the duplicate test.
    await setStatusAndPayload(S_NID, "signed", {
      cardcheck: { acceptance: { ts: ACCEPT_TS, uid: 1 } },
      esig: { blob: "smoke-esig" },
    });
    await upsertRecords([syntheticRecord(T_NID, pairDefNid, wNid)]);
    const r6 = runLoader(baseArgs);
    check("R6 exits 0", r6.code === 0);
    check("R6 updated S back to signed AND created T pending",
      statsOf(r6).updated === 1 && statsOf(r6).created === 1,
      `updated=${statsOf(r6).updated} created=${statsOf(r6).created}`);
    const t6 = await s2Cardcheck(T_NID);
    check("R6 T is pending", t6?.status === "pending", `status=${t6?.status}`);

    // R7 — T flips to signed while S is signed for the same worker+definition
    // → storage DUPLICATE_SIGNED validation → duplicate_signed reject, exit 1.
    await setStatusAndPayload(T_NID, "signed", {
      cardcheck: { acceptance: { ts: ACCEPT_TS + 60, uid: 1 } },
      esig: { blob: "smoke-esig-2" },
    });
    const r7 = runLoader(baseArgs);
    check("R7 duplicate-signed transition blocks (exit 1)", r7.code === 1);
    check("R7 duplicate_signed rejected exactly once",
      (r7.result?.rejectGate.counts ?? {})["duplicate_signed"] === 1,
      JSON.stringify(r7.result?.rejectGate.counts ?? {}));
    check("R7 T stayed pending in S2", (await s2Cardcheck(T_NID))?.status === "pending");

    // R8 — acknowledged via --allow-rejects; T still pending, fingerprint
    // NOT advanced (the reject re-fires until the S1 conflict is resolved).
    const r8 = runLoader(["--allow-rejects", `${ALLOW},duplicate_signed`, "--migration-mode"]);
    check("R8 --allow-rejects duplicate_signed exits 0", r8.code === 0);
    check("R8 duplicate_signed still counted", (r8.result?.rejectGate.counts ?? {})["duplicate_signed"] === 1);
    check("R8 T still pending", (await s2Cardcheck(T_NID))?.status === "pending");

    // R9 — staged T deleted → report-only pending_retention finding, exit 1;
    // the S2 row and mapping are PRESERVED (signed-authorization retention).
    const tS2 = (await s2Cardcheck(T_NID))!;
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_log' AND nid = ${T_NID}`);
    const r9 = runLoader(baseArgs);
    check("R9 deleted source blocks with pending_retention (exit 1)", r9.code === 1);
    const f9 = (r9.result?.findings ?? []).filter((f) => f.kind === "pending_retention");
    check("R9 finding names T with its current status",
      f9.some((f) => Number(f.s1Id) === T_NID && (f.detail as any)?.status === "pending"),
      JSON.stringify(f9.map((f) => ({ s1Id: f.s1Id, status: (f.detail as any)?.status }))));
    check("R9 S2 row preserved", (await s2Cardcheck(T_NID))?.status === "pending");
    check("R9 sweep aggregate counts by status",
      (detailOf(r9).sweep?.records?.pendingRetentionByStatus ?? {})["pending"] >= 1,
      JSON.stringify(detailOf(r9).sweep?.records ?? {}));

    // R10 — acknowledged via --allow-findings (still reported, exit 0).
    const r10 = runLoader([...baseArgs, "--allow-findings", "pending_retention"]);
    check("R10 --allow-findings pending_retention exits 0", r10.code === 0);
    check("R10 finding still reported", (r10.result?.findings ?? []).some((f) => f.kind === "pending_retention" && Number(f.s1Id) === T_NID));
    check("R10 reportOnly counted", (r10.result?.summary.reportOnly ?? 0) >= 1);
    check("R10 row STILL preserved (never deleted/revoked)", (await s2Cardcheck(T_NID))?.status === "pending", `s2=${tS2.id}`);

    // T's job is done — remove it entirely (S2 + mapping + staging).
    await cleanupSynthetic(T_NID);

    // R10b — RELOCATION duplicate: S is already signed; point its staged
    // handler at a (worker, definition) pair that ALREADY has a signed
    // cardcheck (the seeded signed record's own pair). The storage validator
    // must fire DUPLICATE_SIGNED on the pair CHANGE (not just on a
    // transition to signed), the loader must surface duplicate_signed, the
    // S2 row must stay signed on its ORIGINAL pair, and the fingerprint must
    // NOT advance (the reject re-fires until the S1 side is fixed).
    const cc101 = await s2Cardcheck(SEED_LO);
    check("R10b seeded conflict row is signed", cc101?.status === "signed", `status=${cc101?.status}`);
    const conflictDefNid = cc101!.definitionId === defAS2 ? DEF_A : DEF_B;
    const conflictWorkerRow = rowsOf(await db.execute(sql`
      SELECT s1_id FROM s1_staging.id_map WHERE entity = 'worker' AND s2_id = ${cc101!.workerId} AND stub = false LIMIT 1
    `))[0];
    const conflictWorkerNid = Number(conflictWorkerRow?.s1_id ?? 0);
    check("R10b resolved the conflict pair's worker nid", conflictWorkerNid > 0, `workerNid=${conflictWorkerNid}`);
    const fpBeforeReloc = (await getMappings(REC_ENTITY, [S_NID])).get(S_NID)?.consumedFingerprint ?? null;
    {
      const rec = await readRecord("sirius_log", S_NID);
      rec.fields["field_sirius_log_handler"] = [String(conflictDefNid), String(conflictWorkerNid)];
      await upsertRecords([rec]);
    }
    const r10b = runLoader(baseArgs);
    check("R10b relocating a signed row onto an occupied pair blocks (exit 1)", r10b.code === 1);
    check("R10b duplicate_signed rejected exactly once (mapped relocation)",
      (r10b.result?.rejectGate.counts ?? {})["duplicate_signed"] === 1,
      JSON.stringify(r10b.result?.rejectGate.counts ?? {}));
    const sAfterReloc = await s2Cardcheck(S_NID);
    check("R10b S2 row untouched — still signed on the ORIGINAL pair",
      sAfterReloc?.status === "signed" && sAfterReloc.workerId === wS2 && sAfterReloc.definitionId === pairDefS2,
      JSON.stringify({ status: sAfterReloc?.status, moved: sAfterReloc?.workerId !== wS2 }));
    const fpAfterReloc = (await getMappings(REC_ENTITY, [S_NID])).get(S_NID)?.consumedFingerprint ?? null;
    check("R10b fingerprint did NOT advance on the rejected relocation",
      fpBeforeReloc != null && fpAfterReloc === fpBeforeReloc,
      JSON.stringify({ before: fpBeforeReloc, after: fpAfterReloc }));
    check("R10b conflict row untouched", (await s2Cardcheck(SEED_LO))?.status === "signed");

    // R10c — restore S's handler: content returns to the last VERIFIED
    // state, so the surviving fingerprint fast-skips it — no write, no
    // adopt, no duplicate_signed.
    {
      const rec = await readRecord("sirius_log", S_NID);
      rec.fields["field_sirius_log_handler"] = [String(pairDefNid), String(wNid)];
      await upsertRecords([rec]);
    }
    const r10c = runLoader(baseArgs);
    check("R10c exits 0 after restoring the handler", r10c.code === 0);
    check("R10c restored S fast-skips on the surviving fingerprint",
      statsOf(r10c).updated === 0 && statsOf(r10c).adopted === 0 &&
        (r10c.result?.rejectGate.counts ?? {})["duplicate_signed"] == null,
      JSON.stringify({ updated: statsOf(r10c).updated, adopted: statsOf(r10c).adopted }));
    check("R10c S still signed on its own pair", (await s2Cardcheck(S_NID))?.workerId === wS2);

    // R10d — NON-conflicting relocation: move S to a FREE pair (another
    // mapped worker with no signed cardcheck on this definition). A
    // legitimate S1 correction ("signed under the wrong worker") must
    // update the mapped row cleanly and advance the fingerprint.
    let w2Nid = 0, w2S2 = "";
    for (const cand of candidates) {
      if (cand.nid === wNid) continue;
      const signed = rowsOf(await db.execute(sql`
        SELECT 1 FROM cardchecks WHERE worker_id = ${cand.s2} AND cardcheck_definition_id = ${pairDefS2} AND status = 'signed' LIMIT 1
      `));
      if (signed.length === 0) { w2Nid = cand.nid; w2S2 = cand.s2; break; }
    }
    check("R10d found a second free worker for the non-conflicting relocation", w2Nid > 0, `w2=${w2Nid}`);
    {
      const rec = await readRecord("sirius_log", S_NID);
      rec.fields["field_sirius_log_handler"] = [String(pairDefNid), String(w2Nid)];
      await upsertRecords([rec]);
    }
    const r10d = runLoader(baseArgs);
    check("R10d exits 0 (no conflict on the free pair)", r10d.code === 0);
    check("R10d relocation updated exactly one record", statsOf(r10d).updated === 1, `updated=${statsOf(r10d).updated}`);
    const s10d = await s2Cardcheck(S_NID);
    check("R10d S moved to the new worker, still signed on the same definition",
      s10d?.status === "signed" && s10d.workerId === w2S2 && s10d.definitionId === pairDefS2,
      JSON.stringify({ status: s10d?.status, moved: s10d?.workerId === w2S2 }));
    const fpAfterFree = (await getMappings(REC_ENTITY, [S_NID])).get(S_NID)?.consumedFingerprint ?? null;
    check("R10d fingerprint advanced on the successful relocation",
      fpAfterFree != null && fpAfterFree !== fpAfterReloc);

    // R10e — restore S to its own pair (also a relocation; converges back).
    {
      const rec = await readRecord("sirius_log", S_NID);
      rec.fields["field_sirius_log_handler"] = [String(pairDefNid), String(wNid)];
      await upsertRecords([rec]);
    }
    const r10e = runLoader(baseArgs);
    check("R10e exits 0", r10e.code === 0);
    check("R10e restore updated exactly one record", statsOf(r10e).updated === 1, `updated=${statsOf(r10e).updated}`);
    check("R10e S back on its own worker", (await s2Cardcheck(S_NID))?.workerId === wS2);

    // Storage-level probe — a signed→signed relocation IS a signed-cardcheck
    // situation change: CARDCHECK_SAVED must fire for BOTH the pre-update
    // and post-update rows (the old worker loses an effective signature,
    // the new one gains it), exactly as sign/revoke does. Loader child
    // processes can't be observed from here, so this asserts the emit
    // contract at the storage choke point every writer goes through — in
    // the running app these emits drive the WMB auto-rescan for each
    // affected worker.
    const sRowId = (await s2Cardcheck(S_NID))!.id;
    const emits: Array<{ workerId: string; status: string }> = [];
    const probeId = eventBus.on({
      name: "smoke-cardcheck-saved-probe",
      description: "smoke: captures CARDCHECK_SAVED emits for relocation assertions",
      event: EventType.CARDCHECK_SAVED,
      handler: async (p) => { emits.push({ workerId: p.workerId, status: p.status }); },
    });
    try {
      await storage.cardchecks.updateCardcheck(sRowId, { workerId: w2S2 });
      await new Promise((r) => setTimeout(r, 250));
      check("signed relocation emits CARDCHECK_SAVED for BOTH affected workers",
        emits.length === 2 && emits.some((e) => e.workerId === wS2) && emits.some((e) => e.workerId === w2S2),
        JSON.stringify(emits));
      check("both relocation emits carry signed status",
        emits.length > 0 && emits.every((e) => e.status === "signed"), JSON.stringify(emits));
      emits.length = 0;
      // Revert through storage too — S2 again matches the R10e fingerprint
      // state, and the reverse relocation must emit for both workers as well.
      await storage.cardchecks.updateCardcheck(sRowId, { workerId: wS2 });
      await new Promise((r) => setTimeout(r, 250));
      check("reverse relocation also emits for both workers",
        emits.length === 2 && emits.some((e) => e.workerId === wS2) && emits.some((e) => e.workerId === w2S2),
        JSON.stringify(emits));
    } finally {
      eventBus.off(probeId);
    }

    // R11 — combined reconcile-precision run:
    //   · payload-only edit on seeded signed record 99910101 → updated
    //   · logic_version=0 on another MAPPED seeded record → adopted (version-only;
    //     picked from id_map — some seeded nids are unmapped reject fixtures)
    //   · disclaimer node body edit → definition A updated; records of
    //     definition A do NOT reprocess (identity-only in record fingerprints)
    {
      const rec = await readRecord("sirius_log", SEED_LO);
      const blob = readJsonBlob(rec.fields);
      const obj = blob && typeof blob === "object" && !Array.isArray(blob) ? (blob as Record<string, unknown>) : {};
      const cc = (obj["cardcheck"] ?? {}) as Record<string, unknown>;
      cc["bu"] = "smoke-bu-edit";
      obj["cardcheck"] = cc;
      writeJsonBlob(rec.fields, obj);
      await upsertRecords([rec]);
    }
    const verRow = rowsOf(await db.execute(sql`
      SELECT s1_id FROM s1_staging.id_map
      WHERE entity = ${REC_ENTITY} AND stub = false
        AND s1_id BETWEEN ${SEED_LO} AND ${SEED_HI} AND s1_id <> ${SEED_LO}
      ORDER BY s1_id LIMIT 1
    `))[0];
    const verNid = Number(verRow?.s1_id ?? 0);
    check("R11 found a second mapped seeded record for the version-only probe", verNid > 0, `verNid=${verNid}`);
    await db.execute(sql`
      UPDATE s1_staging.id_map SET logic_version = 0 WHERE entity = ${REC_ENTITY} AND s1_id = ${verNid}
    `);
    {
      const disc = await readRecord("sirius_json_definition", DISC_A);
      writeJsonBlob(disc.fields, { disclaimer: { text: "SMOKE DISCLAIMER v2" } });
      await upsertRecords([disc]);
      discEdited = true;
    }
    const r11 = runLoader(baseArgs);
    const s11 = statsOf(r11), ds11 = defStatsOf(r11);
    check("R11 exits 0", r11.code === 0);
    check("R11 payload-only edit updated exactly one record", s11.updated === 1, `updated=${s11.updated}`);
    check("R11 version-only mapping adopted (no rewrite)", s11.adopted === 1, `adopted=${s11.adopted}`);
    check("R11 changed disclaimer updated exactly definition A", ds11.updated === 1 && ds11.fastPathSkips === ds11.staged - 1,
      `defUpdated=${ds11.updated} defFastPath=${ds11.fastPathSkips}`);
    const s2_101 = await s2Cardcheck(SEED_LO);
    check("R11 payload edit landed in migration-owned data", s2_101?.s1?.bu === "smoke-bu-edit", `bu=${s2_101?.s1?.bu}`);
    const defBody = rowsOf(await db.execute(sql`SELECT body FROM cardcheck_definitions WHERE sirius_id = ${String(DEF_A)}`))[0];
    check("R11 definition body reflects the edited disclaimer", String(defBody?.body ?? "") === "SMOKE DISCLAIMER v2");
    const mVer = (await getMappings(REC_ENTITY, [verNid])).get(verNid);
    check("R11 version-refreshed mapping back at logic_version 1", mVer?.logicVersion === 1);

    // R12 — restores converge back (S also removed before this run).
    await upsertRecords([saved101, savedDisc]);
    discEdited = false;
    await cleanupSynthetic(S_NID);
    const r12 = runLoader(baseArgs);
    check("R12 exits 0", r12.code === 0);
    check("R12 restored record + definition converge (one update each)",
      statsOf(r12).updated === 1 && defStatsOf(r12).updated === 1,
      `recUpdated=${statsOf(r12).updated} defUpdated=${defStatsOf(r12).updated}`);

    // R13 — --force-reconcile: everything reprocesses, nothing rewrites.
    const r13 = runLoader([...baseArgs, "--force-reconcile"]);
    const s13 = statsOf(r13), ds13 = defStatsOf(r13);
    check("R13 force-reconcile exits 0", r13.code === 0);
    check("R13 records all adopt (no writes)", s13.created === 0 && s13.updated === 0 && s13.adopted > 0 && s13.fastPathSkips === 0,
      `adopted=${s13.adopted} fastPathSkips=${s13.fastPathSkips}`);
    check("R13 definitions all adopt", ds13.adopted === ds13.staged, `adopted=${ds13.adopted}/${ds13.staged}`);

    // R14 — final clean run: full fast path, no findings.
    const r14 = runLoader(baseArgs);
    const s14 = statsOf(r14), ds14 = defStatsOf(r14);
    check("R14 final run exits 0", r14.code === 0);
    check("R14 records fully fast-skip", s14.created === 0 && s14.updated === 0 && s14.adopted === 0 && s14.fastPathSkips > 0);
    check("R14 definitions fully fast-skip", ds14.fastPathSkips === ds14.staged);
    check("R14 no findings", (r14.result?.findings ?? []).length === 0,
      JSON.stringify((r14.result?.findings ?? []).map((f) => ({ kind: f.kind, s1Id: f.s1Id }))));
  } finally {
    try { await upsertRecords([saved101]); } catch (e) { console.error("RESTORE FAILED (101)", e); }
    if (discEdited) {
      try { await upsertRecords([savedDisc]); } catch (e) { console.error("RESTORE FAILED (disclaimer)", e); }
    }
    try { await cleanupSynthetic(S_NID); } catch (e) { console.error("CLEANUP FAILED (S)", e); }
    try { await cleanupSynthetic(T_NID); } catch (e) { console.error("CLEANUP FAILED (T)", e); }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
