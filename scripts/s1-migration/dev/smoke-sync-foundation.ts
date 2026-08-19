/**
 * Dev-only smoke for the sync foundation (Task 292 — RUNBOOK §10):
 * versioned consumed fingerprints, --force-reconcile, deletion sweeps, and
 * the standard loader result envelope, proven end-to-end on the two pilot
 * loaders (load-options, load-policies) against the dev database.
 *
 * Scenarios
 *   units    — canonicalJson/combineFingerprints/classifyRow matrices, DB
 *              hash stability across re-upserts, scratch-entity deletion
 *              sweep (delete / deactivate / report-only / alreadyHandled /
 *              stub exclusion / sourceIds + sourceSql selectors).
 *   options  — run1 baseline; run2 all-unchanged fast path (a manually
 *              drifted S2 row proves rows are truly skipped); S1 edit of a
 *              worker-ms term (also proves the fast path feeds the intra-run
 *              industry cache); --force-reconcile heals the drift;
 *              logic-version-only bump reprocesses exactly those rows;
 *              vanished staged term → blocking deleted_in_s1 finding,
 *              acknowledged via --allow-findings, healed by restore.
 *   policies — run1 baseline; run2 all-unchanged; S1 title edit remaps the
 *              nid onto a different configured policy (S1-wins) and back.
 *
 * NEVER restages dev (staging regen invalidates id_map — see memory). All
 * staged edits go through upsertTerms/upsertRecords with saved-row restores
 * in a finally block; hash backfill = re-upsert of rows read from staging.
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-sync-foundation.ts [--phase units|options|policies]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { createUnifiedOptionsStorage, type OptionsTypeName } from "../../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../../server/middleware/request-context";
import {
  ensureStagingSchema,
  upsertTerms,
  upsertRecords,
  type StagedTerm,
  type StagedRecord,
} from "../lib/staging";
import { ensureIdMap, putMapping, getMappings, deleteMapping } from "../lib/idmap";
import {
  canonicalJson,
  contentHashOf,
  combineFingerprints,
  classifyRow,
  sweepDeletions,
  FINDING_DELETED_IN_S1,
  type LoaderResult,
} from "../lib/sync";

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
// Loader spawn harness — each loader calls process.exit, so run it as a child
// process and parse the standard result envelope via S1_RESULT_JSON_PATH.
// ---------------------------------------------------------------------------
let runSeq = 0;
function runLoader(script: string, args: string[]): { code: number; result: LoaderResult | null } {
  const resultPath = `/tmp/t292-smoke-result-${process.pid}-${++runSeq}.json`;
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
    } catch {
      /* leave null */
    }
    try { unlinkSync(resultPath); } catch { /* ignore */ }
  }
  console.log(`  · ${script} ${args.join(" ")} → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (result == null) {
    console.log(`  · NO RESULT ENVELOPE — stdout tail:\n${(proc.stdout ?? "").slice(-2000)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-2000)}`);
  } else if (proc.status !== 0) {
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-800)}`);
  }
  return { code: proc.status ?? -1, result };
}

// ---------------------------------------------------------------------------
// Staged-row save/restore helpers (never restage dev)
// ---------------------------------------------------------------------------
async function readTerm(tid: number): Promise<StagedTerm> {
  const r = rowsOf(await db.execute(sql`
    SELECT tid, vocabulary, name, description, weight, fields FROM s1_staging.terms WHERE tid = ${tid}
  `))[0];
  if (!r) throw new Error(`term ${tid} not staged`);
  return {
    tid: Number(r.tid),
    vocabulary: String(r.vocabulary),
    name: String(r.name),
    description: r.description == null ? null : String(r.description),
    weight: Number(r.weight),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
  };
}

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

/** Re-upsert every staged term (and, for policies, record) so content_hash is
 * populated — dev rows were staged before the sync upgrade. Idempotent. */
async function backfillTermHashes(): Promise<void> {
  const rows = rowsOf(await db.execute(sql`SELECT tid FROM s1_staging.terms ORDER BY tid`));
  const terms: StagedTerm[] = [];
  for (const r of rows) terms.push(await readTerm(Number(r.tid)));
  await upsertTerms(terms);
  const nulls = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS c FROM s1_staging.terms WHERE content_hash IS NULL`))[0];
  check("backfill: all staged terms have content_hash", Number(nulls.c) === 0, `nullHashes=${nulls.c}`);
}

async function backfillRecordHashes(): Promise<void> {
  const rows = rowsOf(await db.execute(sql`SELECT bundle, nid FROM s1_staging.records ORDER BY bundle, nid`));
  const recs: StagedRecord[] = [];
  for (const r of rows) recs.push(await readRecord(String(r.bundle), Number(r.nid)));
  await upsertRecords(recs);
  const nulls = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS c FROM s1_staging.records WHERE content_hash IS NULL`))[0];
  check("backfill: all staged records have content_hash", Number(nulls.c) === 0, `nullHashes=${nulls.c}`);
}

/** Dev prep: drop id_map leftovers pointing at staged rows that no longer
 * exist (synthetic regen assigns new ids — memory: s1-regen-idmap-staleness).
 * Without this, the very first sweep would report historic garbage. */
async function dropStaleDevMappings(): Promise<void> {
  const staleTerms = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = 'term' AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM s1_staging.terms t WHERE t.tid = m.s1_id)
  `));
  for (const r of staleTerms) await deleteMapping("term", Number(r.s1_id));
  if (staleTerms.length > 0) console.log(`  · prep: dropped ${staleTerms.length} stale dev term mapping(s): ${staleTerms.map((r) => r.s1_id).join(",")}`);
  const stalePolicies = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
     WHERE m.entity = 'policy' AND m.stub = false
       AND NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.nid = m.s1_id)
  `));
  for (const r of stalePolicies) await deleteMapping("policy", Number(r.s1_id));
  if (stalePolicies.length > 0) console.log(`  · prep: dropped ${stalePolicies.length} stale dev policy mapping(s): ${stalePolicies.map((r) => r.s1_id).join(",")}`);
}

/** Dev prep: drop t4-options term mappings whose S2 target row was deleted
 * out-of-band (dev-only churn). The loader hard-fails on dangling mappings
 * ("repair id_map before re-running") — the repair for a vanished target is
 * to forget the mapping so the term re-resolves by name/create. */
async function dropDanglingTermMappings(options: ReturnType<typeof createUnifiedOptionsStorage>): Promise<void> {
  // Per-TYPE liveness: dev churn produced mappings pointing at rows of the
  // WRONG options table (e.g. a payment-type tid mapped to an industry row),
  // which a cross-type id union would wrongly consider live.
  const VOCAB_TYPE: Record<string, OptionsTypeName> = {
    sirius_industry: "industry",
    grievance_industry: "industry",
    sirius_member_status: "worker-ms",
    sirius_payment_type: "ledger-payment-type",
    sirius_gender: "gender",
    sirius_reltype: "worker-relation-type",
    sirius_contact_relationship_types: "worker-relation-type",
  };
  const idsByType = new Map<string, Set<string>>();
  for (const type of new Set(Object.values(VOCAB_TYPE))) {
    idsByType.set(type, new Set(((await options.list(type)) as Array<{ id: string }>).map((r) => r.id)));
  }
  const stagedVocabByTid = new Map<number, string>();
  for (const r of rowsOf(await db.execute(sql`SELECT tid, vocabulary FROM s1_staging.terms`))) {
    stagedVocabByTid.set(Number(r.tid), String(r.vocabulary));
  }
  const mappings = rowsOf(
    await db.execute(sql`SELECT s1_id, s2_id FROM s1_staging.id_map WHERE entity = 'term' AND loader = 't4-options'`),
  );
  for (const m of mappings) {
    const tid = Number(m.s1_id);
    const vocab = stagedVocabByTid.get(tid);
    if (!vocab) continue; // vanished staged source is dropStaleDevMappings' job
    const type = VOCAB_TYPE[vocab];
    if (!type) continue;
    const s2Id = String(m.s2_id);
    if (idsByType.get(type)!.has(s2Id)) continue;
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'term' AND s1_id = ${tid}`);
    console.log(`  · prep: dropped dangling term mapping ${tid} → ${s2Id} (no live ${type} row)`);
  }
}

/** Dev prep: after a synthetic staging regen, S2 option rows can carry
 * siriusIds from the RETIRED tid numbering while staged terms have new tids.
 * The loader refuses name-adoption onto a row that already carries a
 * different siriusId ("resolve manually") — we resolve exactly those cases
 * by declaring identity in id_map; the loader's matched path then heals the
 * stale siriusId (S1 wins). Only touches rows whose siriusId is numeric and
 * NOT a currently-staged tid. Dev-only; production tids are never renumbered. */
async function prepAdoptStaleSiriusIds(options: ReturnType<typeof createUnifiedOptionsStorage>): Promise<void> {
  const TID_VOCAB_TO_TYPE: Record<string, OptionsTypeName> = {
    sirius_industry: "industry",
    grievance_industry: "industry",
    sirius_member_status: "worker-ms",
    sirius_payment_type: "ledger-payment-type",
    sirius_gender: "gender",
  };
  // A numeric siriusId is "retired" only relative to its OWN options type:
  // regen tid ranges overlap across vocabs, so a stale industry siriusId can
  // numerically collide with a CURRENT member-status tid.
  const tidsByVocab = new Map<string, Set<number>>();
  for (const r of rowsOf(await db.execute(sql`SELECT tid, vocabulary FROM s1_staging.terms`))) {
    const v = String(r.vocabulary);
    if (!tidsByVocab.has(v)) tidsByVocab.set(v, new Set());
    tidsByVocab.get(v)!.add(Number(r.tid));
  }
  const typeTids = new Map<string, Set<number>>();
  for (const [vocab, type] of Object.entries(TID_VOCAB_TO_TYPE)) {
    if (!typeTids.has(type)) typeTids.set(type, new Set());
    for (const tid of tidsByVocab.get(vocab) ?? []) typeTids.get(type)!.add(tid);
  }
  let declared = 0;
  for (const [vocab, type] of Object.entries(TID_VOCAB_TO_TYPE)) {
    const terms = rowsOf(await db.execute(sql`SELECT tid, name FROM s1_staging.terms WHERE vocabulary = ${vocab}`));
    if (terms.length === 0) continue;
    const mapped = await getMappings("term", terms.map((r) => Number(r.tid)));
    const rows = (await options.list(type)) as Array<{ id: string; name: string; siriusId?: string | null }>;
    for (const t of terms) {
      const tid = Number(t.tid);
      if (mapped.has(tid)) continue;
      const matches = rows.filter((r) => r.name.toLowerCase() === String(t.name).toLowerCase());
      if (matches.length !== 1) continue; // ambiguous/absent → leave to the loader
      const row = matches[0];
      const sid = row.siriusId;
      if (!sid || sid === String(tid)) continue; // plain adoption handles these
      if (!/^\d+$/.test(sid) || typeTids.get(type)!.has(Number(sid))) continue; // repair retired tids only
      await putMapping("term", tid, row.id, { stub: false, loader: "t4-options" });
      declared++;
      console.log(`  · prep: declared identity term ${tid} "${t.name}" → ${type} ${row.id} (stale siriusId ${sid} to be healed)`);
    }
  }
  if (declared > 0) console.log(`  · prep: declared ${declared} identity mapping(s) for retired-siriusId rows`);
}

// ---------------------------------------------------------------------------
// Phase: units
// ---------------------------------------------------------------------------
const SCRATCH_ENTITY = "smoke-sync-292";

async function phaseUnits(): Promise<void> {
  console.log("== phase: units ==");
  // canonicalJson: key order + undefined semantics
  check(
    "canonicalJson: key order irrelevant",
    canonicalJson({ b: 1, a: { d: 2, c: [1, undefined] } }) === canonicalJson({ a: { c: [1, null], d: 2 }, b: 1 }),
  );
  check("canonicalJson: undefined dropped in objects", canonicalJson({ a: 1, gone: undefined }) === '{"a":1}');
  check("contentHashOf: stable", contentHashOf({ x: [1, "２"] }) === contentHashOf({ x: [1, "２"] }));

  // combineFingerprints: label-keyed (order-independent), null is a sentinel
  check(
    "combineFingerprints: order independent",
    combineFingerprints([["def", "h1"], ["disc", "h2"]]) === combineFingerprints([["disc", "h2"], ["def", "h1"]]),
  );
  check("combineFingerprints: null participates", combineFingerprints([["a", null]]) !== combineFingerprints([]));
  check("combineFingerprints: null ≠ hash", combineFingerprints([["a", null]]) !== combineFingerprints([["a", "h"]]));
  let dupThrew = false;
  try { combineFingerprints([["a", "1"], ["a", "2"]]); } catch { dupThrew = true; }
  check("combineFingerprints: duplicate label throws", dupThrew);

  // classifyRow matrix
  const base = { stub: false, consumedFingerprint: "fp", logicVersion: 3 };
  check("classifyRow: no mapping → new", classifyRow(undefined, "fp", 3, false) === "new");
  check("classifyRow: stub → changed", classifyRow({ ...base, stub: true }, "fp", 3, false) === "changed");
  check("classifyRow: force → changed", classifyRow(base, "fp", 3, true) === "changed");
  check("classifyRow: null expected → changed", classifyRow(base, null, 3, false) === "changed");
  check("classifyRow: fp mismatch → changed", classifyRow(base, "other", 3, false) === "changed");
  check("classifyRow: version mismatch → changed", classifyRow(base, "fp", 4, false) === "changed");
  check("classifyRow: match → unchanged", classifyRow(base, "fp", 3, false) === "unchanged");

  // DB hash stability across double re-upsert of the same read-back row
  const anyTid = rowsOf(await db.execute(sql`SELECT tid FROM s1_staging.terms ORDER BY tid LIMIT 1`))[0];
  if (anyTid) {
    const tid = Number(anyTid.tid);
    await upsertTerms([await readTerm(tid)]);
    const h1 = rowsOf(await db.execute(sql`SELECT content_hash FROM s1_staging.terms WHERE tid = ${tid}`))[0].content_hash;
    await upsertTerms([await readTerm(tid)]);
    const h2 = rowsOf(await db.execute(sql`SELECT content_hash FROM s1_staging.terms WHERE tid = ${tid}`))[0].content_hash;
    check("staging: content_hash stable across re-upsert", h1 != null && h1 === h2, `h1=${String(h1).slice(0, 12)} h2=${String(h2).slice(0, 12)}`);
  }

  // Scratch-entity deletion sweep
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = ${SCRATCH_ENTITY}`);
  await putMapping(SCRATCH_ENTITY, 1, "smoke-del-1", { stub: false, loader: "smoke-sync" });
  await putMapping(SCRATCH_ENTITY, 2, "smoke-deact-2", { stub: false, loader: "smoke-sync" });
  await putMapping(SCRATCH_ENTITY, 3, "smoke-report-3", { stub: false, loader: "smoke-sync" });
  await putMapping(SCRATCH_ENTITY, 4, "smoke-stub-4", { stub: true, loader: "smoke-sync" });

  const applied: string[] = [];
  const policy = async (c: { s1Id: number }) =>
    c.s1Id === 1
      ? { action: "delete" as const, apply: async () => { applied.push("delete-1"); } }
      : c.s1Id === 2
        ? { action: "deactivate" as const, apply: async () => { applied.push("deact-2"); } }
        : { action: "report-only" as const, detail: { why: "smoke" } };

  // Both selectors say everything is current → no candidates
  const none1 = await sweepDeletions({ entity: SCRATCH_ENTITY, loaders: ["smoke-sync"], sourceIds: new Set([1, 2, 3]), dryRun: false, policy });
  check("sweep: sourceIds all-current → 0 candidates", none1.candidates === 0);
  const none2 = await sweepDeletions({ entity: SCRATCH_ENTITY, loaders: ["smoke-sync"], sourceSql: sql`SELECT unnest(ARRAY[1,2,3])::bigint AS s1_id`, dryRun: false, policy });
  check("sweep: sourceSql all-current → 0 candidates", none2.candidates === 0);

  // Dry run: counts but no mutations
  const dry = await sweepDeletions({ entity: SCRATCH_ENTITY, loaders: ["smoke-sync"], sourceIds: new Set<number>(), dryRun: true, policy });
  check("sweep dry-run: candidates=3 (stub excluded)", dry.candidates === 3, JSON.stringify(dry));
  check("sweep dry-run: no applies ran", applied.length === 0);
  const stillThere = await getMappings(SCRATCH_ENTITY, [1, 2, 3, 4]);
  check("sweep dry-run: nothing mutated", stillThere.size === 4 && stillThere.get(2)!.s1DeletedAt == null);

  // Real sweep
  const real = await sweepDeletions({ entity: SCRATCH_ENTITY, loaders: ["smoke-sync"], sourceIds: new Set<number>(), dryRun: false, policy });
  check("sweep: deleted/deactivated/reportOnly = 1/1/1", real.deleted === 1 && real.deactivated === 1 && real.reportOnly === 1, JSON.stringify(real));
  check("sweep: applies ran", applied.join(",") === "delete-1,deact-2");
  check("sweep: finding typed", real.findings.length === 1 && real.findings[0].kind === FINDING_DELETED_IN_S1 && real.findings[0].s1Id === 3);
  const after = await getMappings(SCRATCH_ENTITY, [1, 2, 3, 4]);
  check("sweep: delete removed mapping", !after.has(1));
  check("sweep: deactivate stamped s1_deleted_at, mapping kept", after.has(2) && after.get(2)!.s1DeletedAt != null);
  check("sweep: report-only untouched", after.has(3) && after.get(3)!.s1DeletedAt == null);
  check("sweep: stub never swept", after.has(4));

  // Re-sweep: deactivated → alreadyHandled; report-only re-emits
  const re = await sweepDeletions({ entity: SCRATCH_ENTITY, loaders: ["smoke-sync"], sourceIds: new Set<number>(), dryRun: false, policy });
  check("re-sweep: alreadyHandled=1, reportOnly=1, candidates=2", re.alreadyHandled === 1 && re.reportOnly === 1 && re.candidates === 2, JSON.stringify(re));

  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = ${SCRATCH_ENTITY}`);
}

// ---------------------------------------------------------------------------
// Phase: options pilot
// ---------------------------------------------------------------------------
async function phaseOptions(): Promise<void> {
  console.log("== phase: options pilot ==");
  const options = createUnifiedOptionsStorage();
  await backfillTermHashes();
  await dropStaleDevMappings();
  await dropDanglingTermMappings(options);
  await prepAdoptStaleSiriusIds(options);

  // run1: baseline reconcile (stamps fingerprints; may create/adopt on dev)
  const r1 = runLoader("load-options.ts", []);
  check("opt run1: exit 0", r1.code === 0);
  check("opt run1: envelope present", r1.result != null);
  if (!r1.result) return;
  check("opt run1: not forced", r1.result.forceReconcile === false);
  const stamped = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM s1_staging.id_map
     WHERE entity = 'term' AND loader = 't4-options' AND consumed_fingerprint IS NOT NULL AND logic_version = 1
  `))[0];
  check("opt run1: fingerprints stamped", Number(stamped.c) > 0, `stamped=${stamped.c}`);

  // Manually drift one payment-type option S2-side BEFORE run2: the fast path
  // must NOT heal it (proves rows are truly skipped, not silently rewritten).
  const payTid = Number(rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
      JOIN s1_staging.terms t ON t.tid = m.s1_id AND t.vocabulary = 'sirius_payment_type'
     WHERE m.entity = 'term' AND m.stub = false ORDER BY m.s1_id LIMIT 1
  `))[0].s1_id);
  const payMap = (await getMappings("term", [payTid])).get(payTid)!;
  const payRows: Array<{ id: string; name: string }> = await options.list("ledger-payment-type");
  const payRow = payRows.find((r) => r.id === payMap.s2Id)!;
  const payOriginalName = payRow.name;
  await withNotificationsSuppressed(() => options.update("ledger-payment-type", payRow.id, { name: `${payOriginalName} DRIFT292` }));

  // run2: everything unchanged → cheap skips, no writes, drift untouched
  const r2 = runLoader("load-options.ts", []);
  check("opt run2: exit 0", r2.code === 0);
  const s2 = r2.result!.summary;
  check("opt run2: created=0 updated=0", s2.created === 0 && s2.updated === 0, JSON.stringify(s2));
  const run2Skips = Number(r2.result!.detail.fastPathSkips ?? -1);
  check("opt run2: all handled terms fast-skipped", run2Skips > 0 && run2Skips === s2.unchanged, `skips=${run2Skips} unchanged=${s2.unchanged}`);
  const payAfter2 = (await options.list("ledger-payment-type") as Array<{ id: string; name: string }>).find((r) => r.id === payRow.id)!;
  check("opt run2: fast path did NOT touch drifted row", payAfter2.name === `${payOriginalName} DRIFT292`);

  // S1 edit: rename a worker-ms (member-status) term. Its vocab reprocesses
  // while sirius_industry stays all-unchanged — proving the fast path fills
  // industryByTid from mappings (else industry resolution would fail/fallback).
  const msTid = Number(rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
      JOIN s1_staging.terms t ON t.tid = m.s1_id AND t.vocabulary = 'sirius_member_status'
     WHERE m.entity = 'term' AND m.stub = false ORDER BY m.s1_id LIMIT 1
  `))[0].s1_id);
  const msSaved = await readTerm(msTid);
  const msMap = (await getMappings("term", [msTid])).get(msTid)!;
  await upsertTerms([{ ...msSaved, name: `${msSaved.name} EDIT292` }]);

  const r3 = runLoader("load-options.ts", []);
  check("opt run3 (S1 edit): exit 0", r3.code === 0);
  check("opt run3: updated ≥ 1", r3.result!.summary.updated >= 1, JSON.stringify(r3.result!.summary));
  check("opt run3: created = 0", r3.result!.summary.created === 0);
  const msRow3 = (await options.list("worker-ms") as Array<{ id: string; name: string }>).find((r) => r.id === msMap.s2Id);
  check("opt run3: S2 name follows S1 edit", msRow3?.name === `${msSaved.name} EDIT292`, `s2Name=${msRow3?.name}`);
  const msFp3 = (await getMappings("term", [msTid])).get(msTid)!;
  const msStagedHash3 = rowsOf(await db.execute(sql`SELECT content_hash FROM s1_staging.terms WHERE tid = ${msTid}`))[0].content_hash;
  check("opt run3: fingerprint advanced to edited hash", msFp3.consumedFingerprint === msStagedHash3);

  // Restore the staged term, then --force-reconcile: heals BOTH the restored
  // term (hash mismatch) and the manual S2 drift (fingerprint matches, force
  // bypasses the fast path). Envelope must say the run was forced.
  await upsertTerms([msSaved]);
  const r4 = runLoader("load-options.ts", ["--force-reconcile"]);
  check("opt run4 (forced): exit 0", r4.code === 0);
  check("opt run4: envelope says forced", r4.result!.forceReconcile === true);
  check("opt run4: fastPathSkips = 0", Number(r4.result!.detail.fastPathSkips) === 0);
  check("opt run4: updated ≥ 2 (drift + restored term)", r4.result!.summary.updated >= 2, JSON.stringify(r4.result!.summary));
  const payAfter4 = (await options.list("ledger-payment-type") as Array<{ id: string; name: string }>).find((r) => r.id === payRow.id)!;
  check("opt run4: forced run healed S2 drift", payAfter4.name === payOriginalName, `name=${payAfter4.name}`);
  const msRow4 = (await options.list("worker-ms") as Array<{ id: string; name: string }>).find((r) => r.id === msMap.s2Id);
  check("opt run4: restored term healed back", msRow4?.name === msSaved.name);

  // Logic-version-only change: decrement stored version for 3 mapped terms →
  // exactly those reprocess (no drift, so updated=0) and versions restore.
  const threeTids = rowsOf(await db.execute(sql`
    SELECT s1_id FROM s1_staging.id_map
     WHERE entity = 'term' AND loader = 't4-options' AND stub = false AND consumed_fingerprint IS NOT NULL
     ORDER BY s1_id LIMIT 3
  `)).map((r) => Number(r.s1_id));
  await db.execute(sql`
    UPDATE s1_staging.id_map SET logic_version = 0
     WHERE entity = 'term' AND s1_id IN (${sql.join(threeTids.map((t) => sql`${t}`), sql`, `)})
  `);
  const r5 = runLoader("load-options.ts", []);
  check("opt run5 (version bump): exit 0", r5.code === 0);
  check("opt run5: created=0 updated=0", r5.result!.summary.created === 0 && r5.result!.summary.updated === 0, JSON.stringify(r5.result!.summary));
  check(
    "opt run5: exactly the 3 version-bumped rows reprocessed",
    Number(r5.result!.detail.fastPathSkips) === run2Skips - 3,
    `skips=${r5.result!.detail.fastPathSkips} vs run2 ${run2Skips}`,
  );
  const versionsBack = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM s1_staging.id_map
     WHERE entity = 'term' AND s1_id IN (${sql.join(threeTids.map((t) => sql`${t}`), sql`, `)}) AND logic_version = 1
  `))[0];
  check("opt run5: logic versions restored to current", Number(versionsBack.c) === 3);

  // Vanished source: delete the staged worker-ms term. The sweep must emit a
  // blocking deleted_in_s1 finding (exit 1) while touching NOTHING; the flag
  // acknowledges it per run; restoring the term clears it.
  await db.execute(sql`DELETE FROM s1_staging.terms WHERE tid = ${msTid}`);
  const r6 = runLoader("load-options.ts", []);
  check("opt run6 (vanished source): exit 1", r6.code === 1);
  const f6 = r6.result!.blockingFindings ?? [];
  check(
    "opt run6: blocking deleted_in_s1 finding for the tid",
    f6.some((f) => f.kind === FINDING_DELETED_IN_S1 && f.entity === "term" && f.s1Id === msTid),
    JSON.stringify(f6),
  );
  check("opt run6: reportOnly counted", r6.result!.summary.reportOnly >= 1);
  const msMapStill = (await getMappings("term", [msTid])).get(msTid);
  check("opt run6: mapping intact (report-only)", msMapStill != null && msMapStill.s2Id === msMap.s2Id && msMapStill.s1DeletedAt == null);
  const msRowStill = (await options.list("worker-ms") as Array<{ id: string }>).find((r) => r.id === msMap.s2Id);
  check("opt run6: S2 row intact", msRowStill != null);

  const r7 = runLoader("load-options.ts", ["--allow-findings", "deleted_in_s1"]);
  check("opt run7 (--allow-findings): exit 0", r7.code === 0);
  check("opt run7: finding still reported", (r7.result!.findings ?? []).some((f) => f.s1Id === msTid));
  check("opt run7: not blocking", (r7.result!.blockingFindings ?? []).length === 0);

  await upsertTerms([msSaved]);
  const r8 = runLoader("load-options.ts", []);
  check("opt run8 (restored): exit 0", r8.code === 0);
  check("opt run8: no findings", (r8.result!.findings ?? []).length === 0);
  check("opt run8: back to all-unchanged", Number(r8.result!.detail.fastPathSkips) === run2Skips, `skips=${r8.result!.detail.fastPathSkips}`);
}

// ---------------------------------------------------------------------------
// Phase: policies pilot
// ---------------------------------------------------------------------------
const POLICY_FLAGS = ["--allow-rejects", "policy_unmatched_unreferenced"];

async function phasePolicies(): Promise<void> {
  console.log("== phase: policies pilot ==");
  await backfillRecordHashes();
  await dropStaleDevMappings();

  const p1 = runLoader("load-policies.ts", POLICY_FLAGS);
  check("pol run1: exit 0", p1.code === 0);
  check("pol run1: envelope present", p1.result != null);
  if (!p1.result) return;
  check("pol run1: reject gate pass", p1.result.rejectGate.status === "pass", JSON.stringify(p1.result.rejectGate));

  const p2 = runLoader("load-policies.ts", POLICY_FLAGS);
  check("pol run2: exit 0", p2.code === 0);
  check("pol run2: created=0 updated=0", p2.result!.summary.created === 0 && p2.result!.summary.updated === 0, JSON.stringify(p2.result!.summary));
  check("pol run2: fast path used", Number(p2.result!.detail.fastPathSkips) > 0, `skips=${p2.result!.detail.fastPathSkips}`);

  // S1-wins remap: retitle staged policy node A to node B's title → A must
  // re-resolve onto B's policy and the mapping must follow (then restore).
  const pair = rowsOf(await db.execute(sql`
    SELECT m.s1_id, m.s2_id, r.title FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.nid = m.s1_id AND r.bundle = 'sirius_trust_policy'
     WHERE m.entity = 'policy' AND m.stub = false
     ORDER BY m.s1_id
  `));
  const a = pair[0];
  const b = pair.find((x) => x.s2_id !== a?.s2_id && x.title && a?.title && String(x.title).toLowerCase() !== String(a.title).toLowerCase());
  if (!a || !b) {
    check("pol remap: found two distinct mapped policy nodes", false, `mapped=${pair.length}`);
    return;
  }
  const nidA = Number(a.s1_id);
  const savedA = await readRecord("sirius_trust_policy", nidA);
  await upsertRecords([{ ...savedA, title: String(b.title) }]);

  const p3 = runLoader("load-policies.ts", POLICY_FLAGS);
  check("pol run3 (retitle): exit 0", p3.code === 0);
  check("pol run3: updated=1 (remap)", p3.result!.summary.updated === 1, JSON.stringify(p3.result!.summary));
  check("pol run3: remappedNids includes the nid", ((p3.result!.detail.remappedNids as number[]) ?? []).includes(nidA));
  const mapA3 = (await getMappings("policy", [nidA])).get(nidA)!;
  check("pol run3: mapping retargeted to B's policy", mapA3.s2Id === b.s2_id, `s2=${mapA3.s2Id}`);

  await upsertRecords([savedA]);
  const p4 = runLoader("load-policies.ts", POLICY_FLAGS);
  check("pol run4 (restore): exit 0", p4.code === 0);
  check("pol run4: updated=1 (remap back)", p4.result!.summary.updated === 1, JSON.stringify(p4.result!.summary));
  const mapA4 = (await getMappings("policy", [nidA])).get(nidA)!;
  check("pol run4: mapping restored", mapA4.s2Id === String(a.s2_id), `s2=${mapA4.s2Id}`);
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await ensureStagingSchema();
  await ensureIdMap();
  if (PHASE === "all" || PHASE === "units") await phaseUnits();
  if (PHASE === "all" || PHASE === "options") await phaseOptions();
  if (PHASE === "all" || PHASE === "policies") await phasePolicies();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
