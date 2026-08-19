/**
 * Dev-only smoke for the T16/T17 sync conversion (Task 294 — RUNBOOK §10):
 * elections reconcile (S1-wins update / delete / recreate) and benefit-history
 * month-set diffing (extend / shorten / retarget / delete / rel divergence /
 * open-end advancement + retraction / anchor maintenance), proven end-to-end
 * against the dev database, then month parity for three ruled months.
 *
 * Scenarios
 *   elections — run1 baseline; run2 all-fastpath zero-churn; S1 end-date edit
 *               → S2 updated + fingerprint advanced (restore converges);
 *               staged delete → S2 election deleted via sweep (restore →
 *               recreated under a fresh id).
 *   benefits  — run1 bootstrap (scratch build + dev-drift heal); run2 zero-
 *               churn; default-horizon run (no flag → current LA month, no
 *               deletes beyond horizon); closed-span extend +2mo and back;
 *               employer retarget (equal create+delete, anchor repointed);
 *               staged span delete (months+anchor swept, restore recreates);
 *               dependent→own-coverage flip (rel repair, same month keys);
 *               horizon advance to 2027-01 (delta creates) + open span closed
 *               at 2026-10 (3-month retraction) + restore; manual cleanup of
 *               the 2027-01 delta; final zero-churn run at the dev horizon.
 *   parity    — verify-month-parity at the dev horizon month (2026-12), the
 *               current month (2026-08), and a mid-history month, all with
 *               --max-disagreement-pct 0 against the post-sync state.
 *
 * NEVER restages dev (staging regen invalidates id_map — see memory). All
 * staged edits go through upsertRecords with saved-row restores; a finally
 * net re-upserts anything left unrestored after a crash (loaders must then
 * be re-run manually to converge).
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-sync-elections-benefits.ts \
 *          [--phase elections|benefits|parity]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage/database";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../../server/middleware/request-context";
import { ensureStagingSchema, upsertRecords, type StagedRecord } from "../lib/staging";
import { ensureIdMap, getMappings, deleteMapping } from "../lib/idmap";
import type { LoaderResult } from "../lib/sync";

const PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "all";
})();

const ELECTION_BUNDLE = "sirius_trust_worker_election";
const SPAN_BUNDLE = "sirius_trust_worker_benefit";
/** Dev staging convention: synthetic data ends 2026-12 (RUNBOOK §6). */
const DEV_HORIZON = "2026-12";
const idxOf = (y: number, m: number) => y * 12 + (m - 1);
const IDX_2026_08 = idxOf(2026, 8);
const IDX_2026_10 = idxOf(2026, 10);
const IDX_2027_01 = idxOf(2027, 1);

/** Dev data traps: regen leaves a handful of elections referencing relations
 * that never made id_map (relation_unmapped); worker_ref_missing is the
 * historic class (harmless to allow when absent). */
const T16_FLAGS = ["--allow-rejects", "worker_ref_missing,relation_unmapped"];
/** Dev data traps (RUNBOOK §8 t17 row): pre-existing reject classes that
 * re-resolve (and re-reject) on every sync run. relation_unmapped and
 * employer_unresolved are synthetic-regen fallout (relations/shops that never
 * made id_map) — real S1 loads relations first, so prod runs expect zero. */
const T17_REJECTS = "start_missing,subscriber_worker_mismatch,relation_subscriber_mismatch,relation_unmapped,employer_unresolved";
const T17_FLAGS = ["--open-end-through", DEV_HORIZON, "--allow-rejects", T17_REJECTS];
const T17_FLAGS_2027 = ["--open-end-through", "2027-01", "--allow-rejects", T17_REJECTS];

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, any>> }).rows;
const oneNum = async (q: ReturnType<typeof sql>): Promise<number> => Number(rowsOf(await db.execute(q))[0]?.c ?? 0);

// ---------------------------------------------------------------------------
// Loader spawn harness (loaders call process.exit) — parse the standard
// result envelope via S1_RESULT_JSON_PATH.
// ---------------------------------------------------------------------------
let runSeq = 0;
function runLoader(script: string, args: string[], expectEnvelope = true): { code: number; result: LoaderResult | null } {
  const resultPath = `/tmp/t294-smoke-result-${process.pid}-${++runSeq}.json`;
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
  if (expectEnvelope && result == null) {
    console.log(`  · NO RESULT ENVELOPE — stdout tail:\n${(proc.stdout ?? "").slice(-2000)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-2000)}`);
  } else if (proc.status !== 0) {
    console.log(`  · stdout tail:\n${(proc.stdout ?? "").slice(-1500)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-800)}`);
  }
  return { code: proc.status ?? -1, result };
}

// ---------------------------------------------------------------------------
// Staged-row save/restore (never restage dev) + crash-safety net
// ---------------------------------------------------------------------------
const pendingRestores = new Map<string, StagedRecord>();

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

async function saveForRestore(bundle: string, nid: number): Promise<StagedRecord> {
  const rec = await readRecord(bundle, nid);
  pendingRestores.set(`${bundle}:${nid}`, rec);
  return rec;
}

async function restoreRecord(rec: StagedRecord): Promise<void> {
  await upsertRecords([rec]);
  pendingRestores.delete(`${rec.bundle}:${rec.nid}`);
}

/** Mutate a staged record's fields (bare-scalar dev shapes: dates are plain
 * "YYYY-MM-DD HH:MM:SS" strings, entity refs plain numbers). */
async function editFields(rec: StagedRecord, edit: (fields: Record<string, unknown>) => void): Promise<void> {
  const copy: StagedRecord = { ...rec, fields: JSON.parse(JSON.stringify(rec.fields)) };
  edit(copy.fields);
  await upsertRecords([copy]);
}

const ymdOfIdx = (idx: number, day: number) =>
  `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")} 00:00:00`;

/** Re-upsert a bundle's staged rows so content_hash is populated (dev rows
 * staged before the sync upgrade). Idempotent. */
async function backfillBundleHashes(bundle: string): Promise<void> {
  const nulls = await oneNum(sql`SELECT COUNT(*)::int AS c FROM s1_staging.records WHERE bundle = ${bundle} AND content_hash IS NULL`);
  if (nulls === 0) return;
  const rows = rowsOf(await db.execute(sql`SELECT nid FROM s1_staging.records WHERE bundle = ${bundle} ORDER BY nid`));
  const recs: StagedRecord[] = [];
  for (const r of rows) recs.push(await readRecord(bundle, Number(r.nid)));
  await upsertRecords(recs);
  const after = await oneNum(sql`SELECT COUNT(*)::int AS c FROM s1_staging.records WHERE bundle = ${bundle} AND content_hash IS NULL`);
  check(`backfill: ${bundle} content_hash populated`, after === 0, `nullHashes=${after}`);
}

/** Dev prep (memory: s1-regen-idmap-staleness): drop id_map leftovers whose
 * staged source vanished in a synthetic regen — else run1's deletion sweep
 * would "delete" live S2 rows that current-numbering nids map to. Also drop
 * election mappings whose S2 row was deleted out-of-band (dev churn) — the
 * loader treats those as mapped_row_missing rejects. */
async function dropStaleSyncMappings(): Promise<void> {
  for (const [entity, bundle] of [["election", ELECTION_BUNDLE], ["wb", SPAN_BUNDLE]] as const) {
    const stale = rowsOf(await db.execute(sql`
      SELECT m.s1_id FROM s1_staging.id_map m
       WHERE m.entity = ${entity} AND m.stub = false
         AND NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = ${bundle} AND r.nid = m.s1_id)
    `));
    for (const r of stale) await deleteMapping(entity, Number(r.s1_id));
    if (stale.length > 0) console.log(`  · prep: dropped ${stale.length} stale dev ${entity} mapping(s)`);
  }
  const dangling = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = 'election' AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM worker_trust_elections e WHERE e.id = m.s2_id)
  `));
  for (const r of dangling) await deleteMapping("election", Number(r.s1_id));
  if (dangling.length > 0) console.log(`  · prep: dropped ${dangling.length} dangling dev election mapping(s)`);
}

// ---------------------------------------------------------------------------
// Phase: elections
// ---------------------------------------------------------------------------
async function phaseElections(): Promise<void> {
  console.log("== phase: elections ==");
  await backfillBundleHashes(ELECTION_BUNDLE);
  await dropStaleSyncMappings();

  const e1 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run1: exit 0", e1.code === 0);
  check("t16 run1: envelope present", e1.result != null);
  if (!e1.result) return;
  check("t16 run1: reject gate pass", e1.result.rejectGate.status === "pass", JSON.stringify(e1.result.rejectGate));
  check("t16 run1: verify clean", Number(e1.result.detail.verifyFailures) === 0);

  const e2 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run2: exit 0", e2.code === 0);
  const s2 = e2.result!.summary;
  check("t16 run2: zero churn", s2.created === 0 && s2.updated === 0 && s2.deleted === 0, JSON.stringify(s2));
  check("t16 run2: fast path used", Number(e2.result!.detail.fastPathSkips) > 0, `skips=${e2.result!.detail.fastPathSkips}`);
  check(
    "t16 run2: rejects match run1 (rejected rows re-resolve, not accumulate)",
    JSON.stringify(e2.result!.detail.rejects) === JSON.stringify(e1.result.detail.rejects),
    JSON.stringify(e2.result!.detail.rejects),
  );

  // --- S1 end-date edit → S2 updated (S1 wins), fingerprint advances ---
  const picked = rowsOf(await db.execute(sql`
    SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.bundle = ${ELECTION_BUNDLE} AND r.nid = m.s1_id
      JOIN worker_trust_elections e ON e.id = m.s2_id
     WHERE m.entity = 'election' AND m.stub = false
     ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!picked) {
    check("t16 edit: found a mapped election", false);
    return;
  }
  const editNid = Number(picked.s1_id);
  const editS2 = String(picked.s2_id);
  const savedElection = await saveForRestore(ELECTION_BUNDLE, editNid);
  const endBefore = rowsOf(await db.execute(sql`SELECT end_ymd::text AS e FROM worker_trust_elections WHERE id = ${editS2}`))[0]?.e ?? null;
  await editFields(savedElection, (f) => {
    f.field_sirius_date_end = "2031-03-15 00:00:00";
  });

  const e3 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run3 (edit): exit 0", e3.code === 0);
  check("t16 run3: updated=1", e3.result!.summary.updated === 1, JSON.stringify(e3.result!.summary));
  check("t16 run3: created=0 deleted=0", e3.result!.summary.created === 0 && e3.result!.summary.deleted === 0);
  const endAfter = rowsOf(await db.execute(sql`SELECT end_ymd::text AS e FROM worker_trust_elections WHERE id = ${editS2}`))[0]?.e;
  check("t16 run3: S2 end date follows S1 edit", endAfter === "2031-03-15", `end=${endAfter}`);
  const fp3 = (await getMappings("election", [editNid])).get(editNid)!;
  const stagedHash3 = rowsOf(await db.execute(sql`
    SELECT content_hash FROM s1_staging.records WHERE bundle = ${ELECTION_BUNDLE} AND nid = ${editNid}
  `))[0].content_hash;
  check("t16 run3: fingerprint advanced to edited hash", fp3.consumedFingerprint === stagedHash3);

  await restoreRecord(savedElection);
  const e4 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run4 (restore): exit 0", e4.code === 0);
  check("t16 run4: updated=1 (healed back)", e4.result!.summary.updated === 1, JSON.stringify(e4.result!.summary));
  const endRestored = rowsOf(await db.execute(sql`SELECT end_ymd::text AS e FROM worker_trust_elections WHERE id = ${editS2}`))[0]?.e ?? null;
  check("t16 run4: S2 end date restored", endRestored === endBefore, `end=${endRestored} want=${endBefore}`);

  // --- staged delete → sweep deletes the S2 election; restore recreates ---
  // Pick an election no span references (t17's employer fallback must not be
  // left pointing at a deleted row mid-scenario). LIKE probe is deliberately
  // broad — this is candidate SELECTION, not correctness.
  const delPick = rowsOf(await db.execute(sql`
    SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.bundle = ${ELECTION_BUNDLE} AND r.nid = m.s1_id
      JOIN worker_trust_elections e ON e.id = m.s2_id
     WHERE m.entity = 'election' AND m.stub = false
       AND NOT EXISTS (
         SELECT 1 FROM s1_staging.records s
          WHERE s.bundle = ${SPAN_BUNDLE} AND s.fields::text LIKE '%' || m.s1_id || '%'
       )
     ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!delPick) {
    check("t16 delete: found an unreferenced mapped election", false);
    return;
  }
  const delNid = Number(delPick.s1_id);
  const delS2 = String(delPick.s2_id);
  const savedDeleted = await saveForRestore(ELECTION_BUNDLE, delNid);
  await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = ${ELECTION_BUNDLE} AND nid = ${delNid}`);

  const e5 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run5 (staged delete): exit 0", e5.code === 0);
  check("t16 run5: sweep deleted=1", e5.result!.summary.deleted === 1, JSON.stringify(e5.result!.detail.sweep));
  const rowGone = await oneNum(sql`SELECT COUNT(*)::int AS c FROM worker_trust_elections WHERE id = ${delS2}`);
  check("t16 run5: S2 election row deleted", rowGone === 0);
  check("t16 run5: mapping removed", !(await getMappings("election", [delNid])).has(delNid));

  await restoreRecord(savedDeleted);
  const e6 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run6 (restore): exit 0", e6.code === 0);
  check("t16 run6: created=1 (recreated)", e6.result!.summary.created === 1, JSON.stringify(e6.result!.summary));
  const remapped = (await getMappings("election", [delNid])).get(delNid);
  check("t16 run6: nid remapped to a live row", remapped != null && (await oneNum(sql`SELECT COUNT(*)::int AS c FROM worker_trust_elections WHERE id = ${remapped.s2Id}`)) === 1);

  const e7 = runLoader("load-elections.ts", T16_FLAGS);
  check("t16 run7 (converged): zero churn", e7.result!.summary.created === 0 && e7.result!.summary.updated === 0 && e7.result!.summary.deleted === 0, JSON.stringify(e7.result!.summary));
}

// ---------------------------------------------------------------------------
// Phase: benefits
// ---------------------------------------------------------------------------
interface ScratchSpan {
  nid: number;
  worker_id: string;
  employer_id: string;
  benefit_id: string;
  source_relation_id: string | null;
  start_idx: number;
  end_idx: number | null;
}

/** Tuple-unique scratch spans (their tuple's live months are exactly theirs). */
async function pickSpan(where: ReturnType<typeof sql>): Promise<ScratchSpan | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT s.nid, s.worker_id, s.employer_id, s.benefit_id, s.source_relation_id, s.start_idx, s.end_idx
      FROM s1_staging.t17_desired_spans s
     WHERE NOT EXISTS (
             SELECT 1 FROM s1_staging.t17_desired_spans o
              WHERE o.nid <> s.nid AND o.worker_id = s.worker_id
                AND o.employer_id = s.employer_id AND o.benefit_id = s.benefit_id
           )
       AND ${where}
     ORDER BY COALESCE(s.end_idx, 999999) - s.start_idx, s.nid
     LIMIT 1
  `))[0];
  if (!r) return null;
  return {
    nid: Number(r.nid),
    worker_id: String(r.worker_id),
    employer_id: String(r.employer_id),
    benefit_id: String(r.benefit_id),
    source_relation_id: r.source_relation_id == null ? null : String(r.source_relation_id),
    start_idx: Number(r.start_idx),
    end_idx: r.end_idx == null ? null : Number(r.end_idx),
  };
}

const spanLen = (s: ScratchSpan) => (s.end_idx == null ? NaN : s.end_idx - s.start_idx + 1);
const tupleMonths = (s: { worker_id: string; employer_id: string; benefit_id: string }) => sql`
  SELECT COUNT(*)::int AS c FROM trust_wmb w
   WHERE w.worker_id = ${s.worker_id} AND w.employer_id = ${s.employer_id} AND w.benefit_id = ${s.benefit_id}
`;

async function phaseBenefits(): Promise<void> {
  console.log("== phase: benefits ==");
  await backfillBundleHashes(SPAN_BUNDLE);
  await dropStaleSyncMappings();

  // --- b1: bootstrap (scratch build; heals any accumulated dev drift) ---
  const wmbBefore = await oneNum(sql`SELECT COUNT(*)::int AS c FROM trust_wmb`);
  const b1 = runLoader("load-benefit-history.ts", T17_FLAGS);
  check("t17 run1: exit 0", b1.code === 0);
  check("t17 run1: envelope present", b1.result != null);
  if (!b1.result) return;
  const d1 = b1.result.detail;
  check("t17 run1: reject gate pass", b1.result.rejectGate.status === "pass", JSON.stringify(b1.result.rejectGate));
  check("t17 run1: scratch populated", Number(d1.scratchSpans) > 0, `scratchSpans=${d1.scratchSpans}`);
  check("t17 run1: desired months computed", Number(d1.desiredMonths) > 0, `desiredMonths=${d1.desiredMonths}`);
  check("t17 run1: verify clean", Number(d1.verifyFailures) === 0, JSON.stringify(d1.verify));
  console.log(`  · run1 heal: wmbBefore=${wmbBefore} created=${d1.monthsCreated} deleted=${d1.monthsDeleted} relRepaired=${d1.relRepaired} anchors=${JSON.stringify(d1.anchors)}`);

  // --- b2: converged zero-churn ---
  const b2 = runLoader("load-benefit-history.ts", T17_FLAGS);
  check("t17 run2: exit 0", b2.code === 0);
  const d2 = b2.result!.detail;
  check(
    "t17 run2: zero churn",
    Number(d2.monthsCreated) === 0 && Number(d2.monthsDeleted) === 0 && Number(d2.relRepaired) === 0 && Number(d2.spansDeleted) === 0,
    `created=${d2.monthsCreated} deleted=${d2.monthsDeleted} rel=${d2.relRepaired} spansDeleted=${d2.spansDeleted}`,
  );
  check("t17 run2: fast path used", Number(d2.fastPathSkips) > 0, `skips=${d2.fastPathSkips}`);
  const a2 = d2.anchors as { created: number; repointed: number; retired: number };
  check("t17 run2: anchors quiescent", a2.created === 0 && a2.repointed === 0 && a2.retired === 0, JSON.stringify(a2));
  check("t17 run2: verify clean", Number(d2.verifyFailures) === 0, JSON.stringify(d2.verify));

  // --- b3: default horizon (no flag) = current LA month; never deletes
  // beyond it (dev rows through 2026-12 stay protected) ---
  const b3 = runLoader("load-benefit-history.ts", ["--allow-rejects", T17_REJECTS]);
  check("t17 run3 (default horizon): exit 0", b3.code === 0);
  const d3 = b3.result!.detail;
  check("t17 run3: horizon defaulted to current LA month", d3.openEndThrough === "2026-08" && d3.openEndThroughSource === "default-current-la-month", `h=${d3.openEndThrough} src=${d3.openEndThroughSource}`);
  check("t17 run3: no churn at shorter horizon", Number(d3.monthsCreated) === 0 && Number(d3.monthsDeleted) === 0, `created=${d3.monthsCreated} deleted=${d3.monthsDeleted}`);
  check("t17 run3: beyond-horizon rows counted, not deleted", Number(d3.staleBeyondHorizon) > 0, `staleBeyondHorizon=${d3.staleBeyondHorizon}`);

  // --- b4: extend a closed span by 2 months, then restore ---
  const extendSpan = await pickSpan(sql`
    s.end_idx IS NOT NULL AND s.end_idx <= ${IDX_2026_08} AND s.source_relation_id IS NULL
    AND EXISTS (
      SELECT 1 FROM s1_staging.records r
       WHERE r.bundle = ${SPAN_BUNDLE} AND r.nid = s.nid AND r.fields ? 'field_sirius_date_end'
    )
  `);
  check("t17 extend: candidate found", extendSpan != null);
  if (!extendSpan) return;
  const savedExtend = await saveForRestore(SPAN_BUNDLE, extendSpan.nid);
  await editFields(savedExtend, (f) => {
    f.field_sirius_date_end = ymdOfIdx(extendSpan.end_idx! + 2, 15);
  });
  const b4 = runLoader("load-benefit-history.ts", T17_FLAGS);
  check("t17 run4 (extend +2mo): monthsCreated=2, no deletes", Number(b4.result!.detail.monthsCreated) === 2 && Number(b4.result!.detail.monthsDeleted) === 0, `created=${b4.result!.detail.monthsCreated} deleted=${b4.result!.detail.monthsDeleted}`);
  await restoreRecord(savedExtend);
  const b5 = runLoader("load-benefit-history.ts", T17_FLAGS);
  check("t17 run5 (shorten back): monthsDeleted=2, no creates", Number(b5.result!.detail.monthsDeleted) === 2 && Number(b5.result!.detail.monthsCreated) === 0, `created=${b5.result!.detail.monthsCreated} deleted=${b5.result!.detail.monthsDeleted}`);
  check("t17 run5: tuple months back to span length", (await oneNum(tupleMonths(extendSpan))) === spanLen(extendSpan));

  // --- b6: retarget employer → equal create+delete, anchor repointed ---
  const retargetSpan = await pickSpan(sql`
    s.end_idx IS NOT NULL AND s.end_idx <= ${IDX_2026_08}
    AND NOT s.employer_from_election AND s.source_relation_id IS NULL
    AND EXISTS (
      SELECT 1 FROM s1_staging.records r
       WHERE r.bundle = ${SPAN_BUNDLE} AND r.nid = s.nid AND r.fields ? 'field_grievance_shop'
    )
  `);
  check("t17 retarget: candidate found", retargetSpan != null);
  if (!retargetSpan) return;
  const newEmp = rowsOf(await db.execute(sql`
    SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m
      JOIN employers e ON e.id = m.s2_id
     WHERE m.entity = 'employer' AND m.stub = false AND m.s2_id <> ${retargetSpan.employer_id}
       AND NOT EXISTS (
         SELECT 1 FROM s1_staging.t17_desired_spans o
          WHERE o.worker_id = ${retargetSpan.worker_id} AND o.employer_id = m.s2_id
            AND o.benefit_id = ${retargetSpan.benefit_id}
       )
     ORDER BY m.s1_id LIMIT 1
  `))[0];
  check("t17 retarget: alternate employer found", newEmp != null);
  if (!newEmp) return;
  const L6 = spanLen(retargetSpan);
  const savedRetarget = await saveForRestore(SPAN_BUNDLE, retargetSpan.nid);
  await editFields(savedRetarget, (f) => {
    f.field_grievance_shop = Number(newEmp.s1_id);
  });
  const b6 = runLoader("load-benefit-history.ts", T17_FLAGS);
  const d6 = b6.result!.detail;
  check(`t17 run6 (retarget employer): ${L6} created + ${L6} deleted`, Number(d6.monthsCreated) === L6 && Number(d6.monthsDeleted) === L6, `created=${d6.monthsCreated} deleted=${d6.monthsDeleted}`);
  check("t17 run6: anchor repointed", (d6.anchors as any).repointed >= 1, JSON.stringify(d6.anchors));
  check("t17 run6: new tuple has the months", (await oneNum(tupleMonths({ ...retargetSpan, employer_id: String(newEmp.s2_id) }))) === L6);
  check("t17 run6: old tuple emptied", (await oneNum(tupleMonths(retargetSpan))) === 0);
  await restoreRecord(savedRetarget);
  const b7 = runLoader("load-benefit-history.ts", T17_FLAGS);
  check("t17 run7 (retarget back): converged", Number(b7.result!.detail.monthsCreated) === L6 && Number(b7.result!.detail.monthsDeleted) === L6 && (await oneNum(tupleMonths(retargetSpan))) === L6);

  // --- b8: staged span delete → months + anchor swept; restore recreates ---
  const delSpan = extendSpan; // tuple-unique, closed, restored state
  const L8 = spanLen(delSpan);
  const savedDelSpan = await saveForRestore(SPAN_BUNDLE, delSpan.nid);
  await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = ${SPAN_BUNDLE} AND nid = ${delSpan.nid}`);
  const b8 = runLoader("load-benefit-history.ts", T17_FLAGS);
  const d8 = b8.result!.detail;
  check("t17 run8 (span deleted): scratch span swept", Number(d8.spansDeleted) === 1, `spansDeleted=${d8.spansDeleted}`);
  check(`t17 run8: ${L8} months deleted`, Number(d8.monthsDeleted) === L8, `deleted=${d8.monthsDeleted}`);
  check("t17 run8: wb mapping swept", (d8.wbSweep as any).deleted === 1 && !(await getMappings("wb", [delSpan.nid])).has(delSpan.nid), JSON.stringify(d8.wbSweep));
  check("t17 run8: tuple emptied", (await oneNum(tupleMonths(delSpan))) === 0);
  await restoreRecord(savedDelSpan);
  const b9 = runLoader("load-benefit-history.ts", T17_FLAGS);
  const d9 = b9.result!.detail;
  check(`t17 run9 (span restored): ${L8} months recreated`, Number(d9.monthsCreated) === L8, `created=${d9.monthsCreated}`);
  check("t17 run9: anchor recreated", (d9.anchors as any).created === 1, JSON.stringify(d9.anchors));
  const anchor9 = (await getMappings("wb", [delSpan.nid])).get(delSpan.nid);
  check("t17 run9: anchor points at a live tuple row", anchor9 != null && (await oneNum(sql`
    SELECT COUNT(*)::int AS c FROM trust_wmb w
     WHERE w.id = ${anchor9?.s2Id ?? ""} AND w.worker_id = ${delSpan.worker_id}
       AND w.employer_id = ${delSpan.employer_id} AND w.benefit_id = ${delSpan.benefit_id}
  `)) === 1);

  // --- b10: rel divergence repair — simulate S2 drift (rows stripped of
  // their relation out-of-band) and prove the sync restores S1's rel with
  // the same month keys (no create/delete churn). Dev note: an S1-side
  // dependent→own flip isn't stageable here (relation shell workers have no
  // S1 worker nid to become a subscriber), but both mutations land in the
  // same relDiverged diff bucket — this exercises that path end-to-end. ---
  const relSpan = await pickSpan(sql`
    s.end_idx IS NOT NULL AND s.end_idx <= ${IDX_2026_08} AND s.source_relation_id IS NOT NULL
  `);
  check("t17 rel-repair: candidate found", relSpan != null);
  if (!relSpan) return;
  const L10 = spanLen(relSpan);
  await db.execute(sql`
    UPDATE trust_wmb SET source_relation_id = NULL
     WHERE worker_id = ${relSpan.worker_id} AND employer_id = ${relSpan.employer_id}
       AND benefit_id = ${relSpan.benefit_id} AND source_relation_id = ${relSpan.source_relation_id}
  `);
  const b10 = runLoader("load-benefit-history.ts", T17_FLAGS);
  const d10 = b10.result!.detail;
  check(`t17 run10 (S2 rel drift): relRepaired=${L10}, no create/delete`, Number(d10.relRepaired) === L10 && Number(d10.monthsCreated) === 0 && Number(d10.monthsDeleted) === 0, `rel=${d10.relRepaired} created=${d10.monthsCreated} deleted=${d10.monthsDeleted}`);
  check("t17 run10: rows re-carry S1's relation", (await oneNum(sql`
    SELECT COUNT(*)::int AS c FROM trust_wmb w
     WHERE w.worker_id = ${relSpan.worker_id} AND w.employer_id = ${relSpan.employer_id}
       AND w.benefit_id = ${relSpan.benefit_id} AND w.source_relation_id = ${relSpan.source_relation_id}
  `)) === L10);
  const b11 = runLoader("load-benefit-history.ts", T17_FLAGS);
  check("t17 run11 (post-repair): zero churn", Number(b11.result!.detail.relRepaired) === 0 && Number(b11.result!.detail.monthsCreated) === 0 && Number(b11.result!.detail.monthsDeleted) === 0);

  // --- b12: horizon advance to 2027-01 → delta creates only ---
  const pre2027Ids = new Set(
    rowsOf(await db.execute(sql`SELECT id FROM trust_wmb WHERE year = 2027 AND month = 1`)).map((r) => String(r.id)),
  );
  const expected2027 = await oneNum(sql`
    SELECT COUNT(*)::int AS c FROM (
      SELECT DISTINCT worker_id, employer_id, benefit_id
        FROM s1_staging.t17_desired_spans
       WHERE end_idx IS NULL AND start_idx <= ${IDX_2027_01}
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM trust_wmb w
       WHERE w.worker_id = t.worker_id AND w.employer_id = t.employer_id
         AND w.benefit_id = t.benefit_id AND w.year = 2027 AND w.month = 1
    )
  `);
  const b12 = runLoader("load-benefit-history.ts", T17_FLAGS_2027);
  const d12 = b12.result!.detail;
  check(`t17 run12 (horizon 2027-01): exactly ${expected2027} delta creates`, Number(d12.monthsCreated) === expected2027 && Number(d12.monthsDeleted) === 0, `created=${d12.monthsCreated} deleted=${d12.monthsDeleted}`);

  // --- b13: close an open span at 2026-10 → 3-month retraction at 2027-01 ---
  const openSpan = await pickSpan(sql`s.end_idx IS NULL AND s.start_idx <= ${IDX_2026_10}`);
  check("t17 close-open: candidate found", openSpan != null);
  if (openSpan) {
    const savedOpen = await saveForRestore(SPAN_BUNDLE, openSpan.nid);
    await editFields(savedOpen, (f) => {
      f.field_sirius_date_end = ymdOfIdx(IDX_2026_10, 20);
    });
    const b13 = runLoader("load-benefit-history.ts", T17_FLAGS_2027);
    const d13 = b13.result!.detail;
    check("t17 run13 (open span closed @2026-10): 3 months retracted", Number(d13.monthsDeleted) === 3 && Number(d13.monthsCreated) === 0, `deleted=${d13.monthsDeleted} created=${d13.monthsCreated}`);
    await restoreRecord(savedOpen);
    const b14 = runLoader("load-benefit-history.ts", T17_FLAGS_2027);
    check("t17 run14 (reopened): 3 months re-extended", Number(b14.result!.detail.monthsCreated) === 3 && Number(b14.result!.detail.monthsDeleted) === 0, `created=${b14.result!.detail.monthsCreated}`);
  }

  // --- b15: clean up the 2027-01 delta (dev keeps the 2026-12 convention),
  // then converge at the dev horizon ---
  const delta = rowsOf(await db.execute(sql`SELECT id FROM trust_wmb WHERE year = 2027 AND month = 1`))
    .map((r) => String(r.id))
    .filter((id) => !pre2027Ids.has(id));
  for (const id of delta) {
    await withNotificationsSuppressed(() =>
      withChargePluginsSuppressed(async () => {
        await storage.trust.wmb.deleteWorkerBenefit(id);
      }),
    );
  }
  console.log(`  · cleanup: removed ${delta.length} 2027-01 delta row(s)`);
  const b15 = runLoader("load-benefit-history.ts", T17_FLAGS);
  const d15 = b15.result!.detail;
  check(
    "t17 run15 (back at dev horizon): zero churn, verify clean",
    b15.code === 0 && Number(d15.monthsCreated) === 0 && Number(d15.monthsDeleted) === 0 && Number(d15.relRepaired) === 0 && Number(d15.verifyFailures) === 0,
    `created=${d15.monthsCreated} deleted=${d15.monthsDeleted} rel=${d15.relRepaired} verify=${JSON.stringify(d15.verify)}`,
  );
}

// ---------------------------------------------------------------------------
// Phase: parity
// ---------------------------------------------------------------------------
async function phaseParity(): Promise<void> {
  console.log("== phase: parity ==");
  // Mid-history month: median populated month (≥5 rows to be meaningful).
  const months = rowsOf(await db.execute(sql`
    SELECT year, month FROM trust_wmb GROUP BY year, month HAVING COUNT(*) >= 5 ORDER BY year, month
  `));
  const mid = months[Math.floor(months.length / 2)];
  const midMonth = mid ? `${mid.year}-${String(mid.month).padStart(2, "0")}` : "2024-01";
  const targets = [DEV_HORIZON, "2026-08", midMonth];
  console.log(`  · parity months: ${targets.join(", ")} (allow-unresolved: ${T17_REJECTS})`);
  for (const month of targets) {
    const p = runLoader(
      "verify-month-parity.ts",
      ["--month", month, "--max-disagreement-pct", "0", "--open-end-through", DEV_HORIZON, "--allow-unresolved", T17_REJECTS],
      false,
    );
    check(`parity ${month}: exit 0`, p.code === 0);
  }
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await ensureStagingSchema();
  await ensureIdMap();
  try {
    if (PHASE === "all" || PHASE === "elections") await phaseElections();
    if (PHASE === "all" || PHASE === "benefits") await phaseBenefits();
    if (PHASE === "all" || PHASE === "parity") await phaseParity();
  } finally {
    if (pendingRestores.size > 0) {
      console.log(`  · finally-net: restoring ${pendingRestores.size} staged record(s) left by a mid-scenario failure`);
      await upsertRecords([...pendingRestores.values()]);
      console.log("  · finally-net: staged rows restored — re-run load-elections/load-benefit-history to converge S2");
    }
  }
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
