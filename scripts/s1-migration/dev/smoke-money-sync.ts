/**
 * Dev-only smoke for the money-loader sync conversion (Task 295 — RUNBOOK
 * §10): t19-payments / t18-ledger reconcile under S1-wins (update changed,
 * sweep deleted), t20-hours stale-key cleanup via the s1_staging.hours_keys
 * sidecar, and a 0-drift verify-balance-parity run at the end.
 *
 * Phase order mirrors the production sync order: PAYMENTS before LEDGER so
 * AR payment references resolve against a converged id_map (t19 → t18), then
 * HOURS, then PARITY.
 *
 * Dev-regen fallout this smoke deliberately heals on first run (see
 * memory: s1-regen-idmap-staleness): id_map `payment` rows carry RETIRED
 * nids while staged records carry the new numbering — run1 creates the 30
 * staged payments fresh and the sweep deletes the 30 retired-nid rows
 * (cascading their referencing ledger rows; the ledger phase then rebuilds
 * every staged-Cleared AR row).
 *
 * NEVER restages dev. All staged edits go through upsertRecords /
 * upsertRawLedger with saved-row restores in finally blocks; hash backfill =
 * re-upsert of rows read back from staging.
 *
 * The `cascade` phase (after payments+ledger have converged) covers the
 * cross-loader hole: deleting an S1 payment cascades its referencing AR
 * ledger rows via payments.delete — t19's sweep must drop those rows'
 * `ledger-ar` mappings so the NEXT standard t18 run recreates the
 * still-staged AR rows instead of fast-skipping them as unchanged.
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-money-sync.ts \
 *          [--phase payments|ledger|cascade|hours|parity]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import {
  ensureStagingSchema,
  ensureRawLedgerTable,
  loadRawLedger,
  upsertRawLedger,
  upsertRecords,
  ensureHoursKeysTable,
  type RawLedgerRow,
  type StagedRecord,
} from "../lib/staging";
import { ensureIdMap, getMappings } from "../lib/idmap";
import type { LoaderResult } from "../lib/sync";

const PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "all";
})();

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, any>> }).rows;

// ---------------------------------------------------------------------------
// Loader spawn harness (loaders call process.exit) — envelope via
// S1_RESULT_JSON_PATH, same pattern as smoke-sync-foundation.
// ---------------------------------------------------------------------------
let runSeq = 0;
function runLoader(script: string, args: string[]): { code: number; result: LoaderResult | null; stdout: string; stderr: string } {
  const resultPath = `/tmp/t295-smoke-result-${process.pid}-${++runSeq}.json`;
  const t0 = Date.now();
  const proc = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
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
  console.log(`  · ${script} ${args.join(" ")} → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (result == null) {
    console.log(`  · NO RESULT ENVELOPE — stdout tail:\n${(proc.stdout ?? "").slice(-2000)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-2000)}`);
  } else if (proc.status !== 0) {
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-800)}`);
  }
  return { code: proc.status ?? -1, result, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

// ---------------------------------------------------------------------------
// Staged-row save/restore helpers (never restage dev)
// ---------------------------------------------------------------------------
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

async function readArRow(ledgerId: number): Promise<RawLedgerRow> {
  const row = (await loadRawLedger()).find((r) => r.ledgerId === ledgerId);
  if (!row) throw new Error(`AR row ${ledgerId} not staged`);
  return row;
}

async function s2LedgerByKey(key: string): Promise<{ id: string; amount: string; memo: string | null } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT id, amount::text AS amount, memo FROM ledger
     WHERE charge_plugin = 's1-import' AND charge_plugin_key = ${key}
  `))[0];
  return r ? { id: String(r.id), amount: String(r.amount), memo: r.memo == null ? null : String(r.memo) } : null;
}

async function s2PaymentByNid(nid: number): Promise<{ id: string; status: string; allocated: boolean; amount: string; dateCleared: string | null } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT p.id, p.status, p.allocated, p.amount::text AS amount, p.date_cleared
      FROM ledger_payments p JOIN s1_staging.id_map m ON m.s2_id = p.id
     WHERE m.entity = 'payment' AND m.s1_id = ${nid}
  `))[0];
  return r
    ? { id: String(r.id), status: String(r.status), allocated: Boolean(r.allocated), amount: String(r.amount), dateCleared: r.date_cleared == null ? null : String(r.date_cleared) }
    : null;
}

// ---------------------------------------------------------------------------
// Phase: payments (t19) — runs FIRST (production order: t19 before t18)
// ---------------------------------------------------------------------------
const T19 = "load-payments.ts";
const T18 = "load-ledger.ts";
const T18_FLAGS = ["--allow-rejects", "non_cleared_status"]; // dev staging holds 2 non-Cleared AR rows (prod is 100% Cleared)

async function phasePayments(): Promise<void> {
  console.log("== phase: payments (t19 reconcile) ==");
  const nullHash = rowsOf(await db.execute(sql`
    SELECT count(*) FILTER (WHERE content_hash IS NULL)::int AS n FROM s1_staging.records WHERE bundle = 'sirius_payment'
  `))[0];
  check("pay prep: staged payment hashes present", Number(nullHash.n) === 0, `nullHashes=${nullHash.n}`);

  // run1: baseline. Heals dev regen fallout — staged (new) nids all create;
  // retired-nid mappings sweep (payment delete cascades referencing ledger
  // rows; the ledger phase rebuilds them).
  const r1 = runLoader(T19, []);
  check("pay run1: exit 0", r1.code === 0);
  check("pay run1: envelope present", r1.result != null);
  if (!r1.result) return;
  const s1 = r1.result.summary;
  check("pay run1: converged (created+updated+unchanged == staged)", s1.created + s1.updated + s1.unchanged === Number(r1.result.detail.staged), JSON.stringify(s1));
  check("pay run1: verify pass", r1.result.verify.status === "pass", JSON.stringify(r1.result.verify));
  const aligned = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS mapped,
           (SELECT count(*)::int FROM s1_staging.records r WHERE r.bundle = 'sirius_payment') AS staged,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_payment' AND r.nid = m.s1_id))::int AS stale
      FROM s1_staging.id_map m WHERE m.entity = 'payment' AND m.stub = false
  `))[0];
  check("pay run1: id_map aligned to staged nids", Number(aligned.mapped) === Number(aligned.staged) && Number(aligned.stale) === 0, JSON.stringify(aligned));

  // run2: all-unchanged fast path
  const r2 = runLoader(T19, []);
  check("pay run2: exit 0", r2.code === 0);
  const s2 = r2.result!.summary;
  check("pay run2: created=0 updated=0 deleted=0", s2.created === 0 && s2.updated === 0 && s2.deleted === 0, JSON.stringify(s2));
  check("pay run2: all unchanged", s2.unchanged > 0 && s2.unchanged === s1.created + s1.updated + s1.unchanged, JSON.stringify(s2));

  // pick a mapped Cleared payment for the status-flip edit
  const pick = rowsOf(await db.execute(sql`
    SELECT m.s1_id AS nid FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.bundle = 'sirius_payment' AND r.nid = m.s1_id
     WHERE m.entity = 'payment' AND m.stub = false
       AND lower(trim(r.fields->>'field_sirius_payment_status')) = 'cleared'
     ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!pick) { check("pay edit: found a mapped Cleared payment", false); return; }
  const nid = Number(pick.nid);
  const saved = await readRecord("sirius_payment", nid);
  try {
    // status flip Cleared → Canceled: S2 row must follow (status, allocated, dateCleared)
    await upsertRecords([{ ...saved, fields: { ...saved.fields, field_sirius_payment_status: "Canceled" } }]);
    const r3 = runLoader(T19, []);
    check("pay run3 (status flip): exit 0", r3.code === 0);
    check("pay run3: updated=1", r3.result!.summary.updated === 1, JSON.stringify(r3.result!.summary));
    const p3 = await s2PaymentByNid(nid);
    check("pay run3: S2 status canceled, allocated=false, dateCleared null",
      p3 != null && p3.status === "canceled" && p3.allocated === false && p3.dateCleared === null,
      JSON.stringify(p3));

    // amount edit on the same (still-Canceled) payment
    const amt = String(saved.fields["field_sirius_dollar_amt"] ?? "0");
    const newAmt = amt === "123.45" ? "123.46" : "123.45";
    await upsertRecords([{ ...saved, fields: { ...saved.fields, field_sirius_payment_status: "Canceled", field_sirius_dollar_amt: newAmt } }]);
    const r4 = runLoader(T19, []);
    check("pay run4 (amount edit): exit 0", r4.code === 0);
    check("pay run4: updated=1", r4.result!.summary.updated === 1, JSON.stringify(r4.result!.summary));
    const p4 = await s2PaymentByNid(nid);
    check("pay run4: S2 amount follows S1", p4 != null && Number(p4.amount) === Number(newAmt), `amount=${p4?.amount} want=${newAmt}`);
  } finally {
    await upsertRecords([saved]);
  }
  const r5 = runLoader(T19, []);
  check("pay run5 (restore): exit 0", r5.code === 0);
  check("pay run5: updated=1 (healed back)", r5.result!.summary.updated === 1, JSON.stringify(r5.result!.summary));
  const p5 = await s2PaymentByNid(nid);
  check("pay run5: S2 back to cleared/allocated", p5 != null && p5.status === "cleared" && p5.allocated === true && p5.dateCleared != null, JSON.stringify(p5));

  // S1-deletion coverage (payment + mapping removed, recreate under a new
  // id, cascade fallout convergence) lives in the `cascade` phase — on a
  // converged target every payment has referencing AR rows, so a
  // "reference-free delete" scenario has no valid pick here.
}

// ---------------------------------------------------------------------------
// Phase: ledger (t18)
// ---------------------------------------------------------------------------
async function phaseLedger(): Promise<void> {
  console.log("== phase: ledger (t18 reconcile) ==");
  // hash backfill: dev raw AR rows were staged before the sync upgrade
  await upsertRawLedger(await loadRawLedger());
  const nulls = rowsOf(await db.execute(sql`SELECT count(*) FILTER (WHERE content_hash IS NULL)::int AS n FROM s1_staging.raw_ledger_ar`))[0];
  check("ldg prep: AR content hashes backfilled", Number(nulls.n) === 0, `nullHashes=${nulls.n}`);

  // run1: baseline — mass-adopts pre-sync rows into id_map `ledger-ar`,
  // rebuilds rows the payments-phase sweep cascaded away, sweeps AR keys no
  // longer staged-Cleared. Per-account verify (post-sweep) must pass.
  const r1 = runLoader(T18, T18_FLAGS);
  check("ldg run1: exit 0", r1.code === 0);
  check("ldg run1: envelope present", r1.result != null);
  if (!r1.result) return;
  check("ldg run1: verify pass", r1.result.verify.status === "pass", JSON.stringify(r1.result.detail.perAccount ?? {}));
  const mapped = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM s1_staging.id_map WHERE entity = 'ledger-ar' AND stub = false`))[0];
  const cleared = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n FROM s1_staging.raw_ledger_ar WHERE lower(trim(coalesce(ledger_status,''))) = 'cleared'
  `))[0];
  check("ldg run1: every staged-Cleared row mapped", Number(mapped.n) === Number(cleared.n), `mapped=${mapped.n} cleared=${cleared.n}`);
  // t19-before-t18 ordering proof: allocation rows resolve payment references
  const refTypes = (r1.result.detail.referenceTypes ?? {}) as Record<string, number>;
  check("ldg run1: payment references resolved", Number(refTypes.payment ?? 0) > 0, JSON.stringify(refTypes));

  // run2: all-unchanged fast path
  const r2 = runLoader(T18, T18_FLAGS);
  check("ldg run2: exit 0", r2.code === 0);
  const s2 = r2.result!.summary;
  check("ldg run2: created=0 updated=0 deleted=0", s2.created === 0 && s2.updated === 0 && s2.deleted === 0, JSON.stringify(s2));
  check("ldg run2: all unchanged", s2.unchanged === Number(mapped.n), JSON.stringify(s2));

  // pick a mapped Cleared row and edit amount + memo (S1 wins)
  const pick = rowsOf(await db.execute(sql`
    SELECT m.s1_id AS lid FROM s1_staging.id_map m
      JOIN s1_staging.raw_ledger_ar s ON s.ledger_id = m.s1_id
     WHERE m.entity = 'ledger-ar' AND m.stub = false
       AND lower(trim(coalesce(s.ledger_status,''))) = 'cleared'
     ORDER BY m.s1_id LIMIT 3
  `));
  if (pick.length < 3) { check("ldg edits: found 3 mapped Cleared AR rows", false, `found=${pick.length}`); return; }
  const editId = Number(pick[0].lid);
  const flipId = Number(pick[1].lid);
  const delId = Number(pick[2].lid);

  const editSaved = await readArRow(editId);
  try {
    const newAmt = editSaved.amount === "77.77" ? "77.78" : "77.77";
    await upsertRawLedger([{ ...editSaved, amount: newAmt, memo: `${editSaved.memo ?? ""} EDIT295`.trim() }]);
    const r3 = runLoader(T18, T18_FLAGS);
    check("ldg run3 (amount+memo edit): exit 0", r3.code === 0);
    check("ldg run3: updated=1", r3.result!.summary.updated === 1, JSON.stringify(r3.result!.summary));
    const row3 = await s2LedgerByKey(`ar-${editId}`);
    check("ldg run3: S2 amount+memo follow S1", row3 != null && Number(row3.amount) === Number(newAmt) && (row3.memo ?? "").includes("EDIT295"), JSON.stringify(row3));
    const fp3 = (await getMappings("ledger-ar", [editId])).get(editId);
    const stagedHash3 = rowsOf(await db.execute(sql`SELECT content_hash FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${editId}`))[0].content_hash;
    check("ldg run3: fingerprint advanced post-verify", fp3?.consumedFingerprint === String(stagedHash3));
  } finally {
    await upsertRawLedger([editSaved]);
  }
  const r4 = runLoader(T18, T18_FLAGS);
  check("ldg run4 (restore): exit 0", r4.code === 0);
  check("ldg run4: updated=1 (healed back)", r4.result!.summary.updated === 1, JSON.stringify(r4.result!.summary));

  // status flip Cleared → Pending: row must SWEEP (plus one more allowed
  // non_cleared_status reject); restore recreates it.
  const flipSaved = await readArRow(flipId);
  try {
    await upsertRawLedger([{ ...flipSaved, status: "Pending" }]);
    const r5 = runLoader(T18, T18_FLAGS);
    check("ldg run5 (status flip): exit 0", r5.code === 0);
    check("ldg run5: deleted=1", r5.result!.summary.deleted === 1, JSON.stringify(r5.result!.summary));
    check("ldg run5: verify pass post-sweep", r5.result!.verify.status === "pass");
    check("ldg run5: S2 row gone", (await s2LedgerByKey(`ar-${flipId}`)) === null);
    check("ldg run5: mapping gone", !(await getMappings("ledger-ar", [flipId])).has(flipId));
  } finally {
    await upsertRawLedger([flipSaved]);
  }
  const r6 = runLoader(T18, T18_FLAGS);
  check("ldg run6 (restore): exit 0", r6.code === 0);
  check("ldg run6: created=1", r6.result!.summary.created === 1, JSON.stringify(r6.result!.summary));
  check("ldg run6: S2 row recreated", (await s2LedgerByKey(`ar-${flipId}`)) !== null);

  // hard delete the staged row: sweep removes S2 row + mapping; restore recreates.
  const delSaved = await readArRow(delId);
  try {
    await db.execute(sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${delId}`);
    const r7 = runLoader(T18, T18_FLAGS);
    check("ldg run7 (S1 delete): exit 0", r7.code === 0);
    check("ldg run7: deleted=1", r7.result!.summary.deleted === 1, JSON.stringify(r7.result!.summary));
    check("ldg run7: S2 row gone", (await s2LedgerByKey(`ar-${delId}`)) === null);
  } finally {
    await upsertRawLedger([delSaved]);
  }
  const r8 = runLoader(T18, T18_FLAGS);
  check("ldg run8 (restore): exit 0", r8.code === 0);
  check("ldg run8: created=1", r8.result!.summary.created === 1, JSON.stringify(r8.result!.summary));

  // final: all-unchanged again
  const r9 = runLoader(T18, T18_FLAGS);
  check("ldg run9: back to all-unchanged", r9.code === 0 && r9.result!.summary.updated === 0 && r9.result!.summary.created === 0 && r9.result!.summary.deleted === 0, JSON.stringify(r9.result?.summary));
}

// ---------------------------------------------------------------------------
// Phase: cascade (t19 delete → t18 recreate, cross-loader convergence)
// Requires payments+ledger phases to have converged first (full-run order).
// ---------------------------------------------------------------------------
async function phaseCascade(): Promise<void> {
  console.log("== phase: cascade (payment delete → AR recreate without force) ==");
  // Pick a payment with ≥1 referencing s1-import ar-* row whose AR source is
  // still staged-Cleared and ledger-ar-mapped (fast-path eligible — the
  // exact shape that used to leave a permanent hole).
  const pick = rowsOf(await db.execute(sql`
    SELECT m.s1_id AS nid, m.s2_id AS s2_id,
           array_agg(substring(l.charge_plugin_key FROM 4)::bigint) AS ar_ids
      FROM s1_staging.id_map m
      JOIN ledger l ON l.reference_type = 'payment' AND l.reference_id = m.s2_id
       AND l.charge_plugin = 's1-import' AND l.charge_plugin_key ~ '^ar-[0-9]+$'
     WHERE m.entity = 'payment' AND m.stub = false
       AND EXISTS (SELECT 1 FROM s1_staging.raw_ledger_ar s
                    WHERE s.ledger_id = substring(l.charge_plugin_key FROM 4)::bigint
                      AND lower(trim(coalesce(s.ledger_status,''))) = 'cleared')
       AND EXISTS (SELECT 1 FROM s1_staging.id_map ma
                    WHERE ma.entity = 'ledger-ar'
                      AND ma.s1_id = substring(l.charge_plugin_key FROM 4)::bigint)
     GROUP BY m.s1_id, m.s2_id ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!pick) { check("csc: found a payment with mapped staged-Cleared referencing AR rows", false); return; }
  const nid = Number(pick.nid);
  const oldPayId = String(pick.s2_id);
  const arIds = (pick.ar_ids as unknown[]).map(Number);
  console.log(`  · payment nid=${nid} referenced by ${arIds.length} staged-Cleared mapped AR row(s)`);
  const saved = await readRecord("sirius_payment", nid);
  try {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_payment' AND nid = ${nid}`);
    const r1 = runLoader(T19, []);
    check("csc run1 (t19 after S1 payment delete): exit 0", r1.code === 0);
    check("csc run1: deleted=1", r1.result!.summary.deleted === 1, JSON.stringify(r1.result!.summary));
    const sweepDetail = (r1.result!.detail as Record<string, any>).sweep ?? {};
    check("csc run1: cascaded ar mappings dropped", Number(sweepDetail.cascadedArMappingsDropped ?? 0) >= arIds.length, JSON.stringify(sweepDetail));
    const payRowGone = rowsOf(await db.execute(sql`SELECT 1 FROM ledger_payments WHERE id = ${oldPayId}`)).length === 0;
    const payMapGone = (await getMappings("payment", [nid])).size === 0;
    check("csc run1: payment row and mapping gone", payRowGone && payMapGone, `rowGone=${payRowGone} mapGone=${payMapGone}`);
    let cascadedGone = true;
    let mappingsGone = true;
    for (const id of arIds) {
      if (await s2LedgerByKey(`ar-${id}`)) cascadedGone = false;
      if ((await getMappings("ledger-ar", [id])).has(id)) mappingsGone = false;
    }
    check("csc run1: cascaded AR rows gone", cascadedGone);
    check("csc run1: their ledger-ar mappings gone", mappingsGone);

    // THE regression: a standard t18 run (no --force-reconcile) must
    // recreate the still-staged AR rows.
    const r2 = runLoader(T18, T18_FLAGS);
    check("csc run2 (standard t18): exit 0", r2.code === 0);
    check("csc run2: created >= cascaded rows", r2.result!.summary.created >= arIds.length, JSON.stringify(r2.result!.summary));
    check("csc run2: verify pass", r2.result!.verify.status === "pass");
    let recreated = true;
    let remapped = true;
    for (const id of arIds) {
      if (!(await s2LedgerByKey(`ar-${id}`))) recreated = false;
      if (!(await getMappings("ledger-ar", [id])).has(id)) remapped = false;
    }
    check("csc run2: AR rows recreated WITHOUT force", recreated);
    check("csc run2: ledger-ar mappings restored", remapped);
  } finally {
    await upsertRecords([saved]);
  }
  // restore: t19 recreates the payment under a new id; the recreated AR rows
  // were resolved while the payment was gone (referenceType='s1-unknown').
  // The ORDINARY next t18 run must re-point them: its degraded-reference
  // heal pre-pass sees the nid now resolves, clears those fingerprints, and
  // the standard update path rewrites the reference — no --force-reconcile.
  const r3 = runLoader(T19, []);
  check("csc run3 (restore payment): exit 0", r3.code === 0);
  check("csc run3: created=1", r3.result!.summary.created === 1, JSON.stringify(r3.result!.summary));
  const newPay = await s2PaymentByNid(nid);
  check("csc run3: payment recreated under new id", newPay != null && newPay.id !== oldPayId, `new=${newPay?.id}`);
  const r4 = runLoader(T18, T18_FLAGS);
  check("csc run4 (standard t18 after restore): exit 0", r4.code === 0);
  const heal = (r4.result!.detail as Record<string, any>).refHeal ?? {};
  check("csc run4: heal pre-pass cleared fingerprint(s)", Number(heal.cleared ?? 0) >= 1, JSON.stringify(heal));
  check("csc run4: updated >= 1 (re-resolved AR row)", r4.result!.summary.updated >= 1, JSON.stringify(r4.result!.summary));
  check("csc run4: verify pass", r4.result!.verify.status === "pass");
  const ref = rowsOf(await db.execute(sql`
    SELECT reference_type, reference_id FROM ledger
     WHERE charge_plugin = 's1-import' AND charge_plugin_key = ${`ar-${arIds[0]}`}
  `))[0];
  check("csc run4: AR reference re-points at recreated payment",
    ref != null && String(ref.reference_type) === "payment" && String(ref.reference_id) === String(newPay?.id),
    JSON.stringify(ref));
  const r5 = runLoader(T18, T18_FLAGS);
  check("csc run5: converged all-unchanged", r5.code === 0 && r5.result!.summary.created === 0 && r5.result!.summary.updated === 0 && r5.result!.summary.deleted === 0, JSON.stringify(r5.result?.summary));
}

// ---------------------------------------------------------------------------
// Phase: hours (t20) — stale-key cleanup via the sidecar
// ---------------------------------------------------------------------------
const T20 = "load-hours.ts";
const T20_FLAGS = ["--migration-mode"];

interface PpGroup { key: string; workerNid: number; employerNid: number; year: number; month: number; nids: number[] }

function asScalarRef(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return v[0];
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

async function payperiodGroups(): Promise<PpGroup[]> {
  const rows = rowsOf(await db.execute(sql`SELECT nid, fields FROM s1_staging.records WHERE bundle = 'sirius_payperiod'`));
  const groups = new Map<string, PpGroup>();
  for (const r of rows) {
    const f = (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields) as Record<string, unknown>;
    const workerNid = asScalarRef(f["field_sirius_worker"]);
    const employerNid = asScalarRef(f["field_grievance_shop"]);
    const ds = f["field_sirius_date_start"];
    if (workerNid == null || employerNid == null || typeof ds !== "string" || !/^\d{4}-\d{2}/.test(ds)) continue;
    const year = Number(ds.slice(0, 4));
    const month = Number(ds.slice(5, 7));
    const key = `${workerNid}|${employerNid}|${year}|${month}`;
    const g = groups.get(key) ?? { key, workerNid, employerNid, year, month, nids: [] };
    g.nids.push(Number(r.nid));
    groups.set(key, g);
  }
  return [...groups.values()];
}

async function s2HoursRow(workerId: string, employerId: string, year: number, month: number): Promise<{ id: string; hours: number } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT id, hours FROM worker_hours
     WHERE worker_id = ${workerId} AND employer_id = ${employerId} AND year = ${year} AND month = ${month} AND day = 1
  `))[0];
  return r ? { id: String(r.id), hours: Number(r.hours) } : null;
}

async function hoursKeyExists(workerId: string, employerId: string, year: number, month: number): Promise<boolean> {
  return rowsOf(await db.execute(sql`
    SELECT 1 FROM s1_staging.hours_keys
     WHERE worker_id = ${workerId} AND employer_id = ${employerId} AND year = ${year} AND month = ${month}
  `)).length > 0;
}

async function phaseHours(): Promise<void> {
  console.log("== phase: hours (t20 stale-key cleanup) ==");
  await ensureHoursKeysTable();

  // run1: adoption + baseline. Seeds hours_keys from existing mapped-pair
  // day=1 rows (epoch stamp), then the run restamps everything still staged;
  // stale cleanup should find nothing on an aligned dev.
  const r1 = runLoader(T20, [...T20_FLAGS, "--adopt-hours-keys"]);
  check("hrs run1 (adopt): exit 0", r1.code === 0);
  check("hrs run1: envelope present", r1.result != null);
  if (!r1.result) return;
  const d1 = r1.result.detail as Record<string, any>;
  check("hrs run1: verify pass", r1.result.verify.status === "pass", JSON.stringify(r1.result.verify));
  check("hrs run1: cleanup ran (not skipped)", d1.staleHoursCleanup?.skipped == null, JSON.stringify(d1.staleHoursCleanup));
  const keyCount = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM s1_staging.hours_keys`))[0];
  check("hrs run1: sidecar populated", Number(keyCount.n) > 0 && Number(keyCount.n) === Number(d1.written), `keys=${keyCount.n} written=${d1.written}`);

  // pick a single-payperiod group whose worker+employer resolve
  const groups = await payperiodGroups();
  const singles = groups.filter((g) => g.nids.length === 1);
  let target: (PpGroup & { workerId: string; employerId: string }) | null = null;
  for (const g of singles) {
    const wm = (await getMappings("worker", [g.workerNid])).get(g.workerNid);
    const em = (await getMappings("employer", [g.employerNid])).get(g.employerNid);
    if (!wm || !em) continue;
    if (await s2HoursRow(wm.s2Id, em.s2Id, g.year, g.month)) {
      target = { ...g, workerId: wm.s2Id, employerId: em.s2Id };
      break;
    }
  }
  if (!target) { check("hrs: found a resolvable single-payperiod group", false); return; }
  const ppNid = target.nids[0];
  const saved = await readRecord("sirius_payperiod", ppNid);

  // S1 delete → stale cleanup removes the month row + sidecar key
  try {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_payperiod' AND nid = ${ppNid}`);
    const r2 = runLoader(T20, T20_FLAGS);
    check("hrs run2 (payperiod deleted): exit 0", r2.code === 0);
    check("hrs run2: deleted=1", r2.result!.summary.deleted === 1, JSON.stringify(r2.result!.summary));
    check("hrs run2: S2 hours row gone", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) === null);
    check("hrs run2: sidecar key gone", !(await hoursKeyExists(target.workerId, target.employerId, target.year, target.month)));
  } finally {
    await upsertRecords([saved]);
  }
  const r3 = runLoader(T20, T20_FLAGS);
  check("hrs run3 (restore): exit 0", r3.code === 0);
  check("hrs run3: S2 hours row back", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) !== null);
  check("hrs run3: sidecar key back", await hoursKeyExists(target.workerId, target.employerId, target.year, target.month));

  // month retarget (payperiod MOVED): shift date_start to a month with no
  // other payperiod for the same (worker, employer) — old month row must be
  // cleaned, new month row created.
  const taken = new Set(groups.filter((g) => g.workerNid === target!.workerNid && g.employerNid === target!.employerNid).map((g) => `${g.year}|${g.month}`));
  let mv: { year: number; month: number } | null = null;
  for (let k = 1; k <= 24 && !mv; k++) {
    const total = target.year * 12 + (target.month - 1) + k;
    const cand = { year: Math.floor(total / 12), month: (total % 12) + 1 };
    if (!taken.has(`${cand.year}|${cand.month}`)) mv = cand;
  }
  if (!mv) { check("hrs retarget: found a free month", false); return; }
  const ds = String(saved.fields["field_sirius_date_start"]);
  const movedDs = `${mv.year}-${String(mv.month).padStart(2, "0")}${ds.slice(7)}`;
  try {
    await upsertRecords([{ ...saved, fields: { ...saved.fields, field_sirius_date_start: movedDs } }]);
    const r4 = runLoader(T20, T20_FLAGS);
    check("hrs run4 (month retarget): exit 0", r4.code === 0);
    check("hrs run4: deleted=1 (old month)", r4.result!.summary.deleted === 1, JSON.stringify(r4.result!.summary));
    check("hrs run4: old month row gone", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) === null);
    check("hrs run4: new month row exists", (await s2HoursRow(target.workerId, target.employerId, mv.year, mv.month)) !== null);
  } finally {
    await upsertRecords([saved]);
  }
  const r5 = runLoader(T20, T20_FLAGS);
  check("hrs run5 (restore): exit 0", r5.code === 0);
  check("hrs run5: old month row back", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) !== null);
  check("hrs run5: moved month row cleaned", (await s2HoursRow(target.workerId, target.employerId, mv.year, mv.month)) === null);
}

// ---------------------------------------------------------------------------
// Phase: parity — verify-balance-parity must report 0 drift after the
// reconcile phases converged everything.
// ---------------------------------------------------------------------------
async function phaseParity(): Promise<void> {
  console.log("== phase: parity ==");
  const t0 = Date.now();
  const proc = spawnSync("npx", ["tsx", "scripts/s1-migration/verify-balance-parity.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  console.log(`  · verify-balance-parity.ts → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check("parity: 0 drift (exit 0)", proc.status === 0);
  if (proc.status !== 0) {
    console.log(`  · stdout tail:\n${(proc.stdout ?? "").slice(-3000)}`);
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-1000)}`);
  }
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await ensureStagingSchema();
  await ensureRawLedgerTable();
  await ensureIdMap();
  if (PHASE === "all" || PHASE === "payments") await phasePayments();
  if (PHASE === "all" || PHASE === "ledger") await phaseLedger();
  if (PHASE === "all" || PHASE === "cascade") await phaseCascade();
  if (PHASE === "all" || PHASE === "hours") await phaseHours();
  if (PHASE === "all" || PHASE === "parity") await phaseParity();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
