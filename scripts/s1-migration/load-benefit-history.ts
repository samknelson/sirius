/**
 * T17 loader — S1 trust worker benefit records → trust_wmb, ALL history,
 * NO cutoff (N17 ruling). Load-order step: after T16 (elections).
 *
 * CONVERTED SYNC LOADER (Task 294): during the ~1-month dual-run S1 stays
 * the system of record and this loader runs daily. S1's benefit scanner
 * rewrites spans constantly (5× more span updates than inserts), so the
 * loader RECONCILES instead of skip-if-mapped:
 *
 *   1. RESOLUTION (span grain, incremental). Staged spans are classified
 *      against the persistent scratch table `s1_staging.t17_desired_spans`
 *      (each row = one span's resolved (worker, employer, benefit, relation,
 *      start..end) plus the consumed staged fingerprint). Unchanged spans
 *      fast-path skip; changed/new spans re-resolve with the SAME T16/T17
 *      resolution semantics as the freeze loader and upsert their scratch
 *      row. REJECTED spans leave their old scratch row untouched
 *      (stale-but-safe: a transient reject must never cascade into month
 *      deletions). Spans deleted from S1 are deleted from scratch, so their
 *      months become stale below.
 *   2. MONTH DIFF (set-based, staging-side). The desired month set is
 *      materialized in SQL by expanding ALL scratch spans through the
 *      open-end horizon (`s1_staging.t17_diff_months`, run-scoped), then
 *      diffed against live trust_wmb:
 *        - missing months → created via storage.trust.wmb.createWorkerBenefit
 *        - stale months (live row for a MIGRATED worker at or before the
 *          horizon with no desired counterpart) → deleteWorkerBenefit
 *        - source_relation_id divergence → delete + recreate (repair)
 *      All S2 writes are per-row storage calls inside notification+charge
 *      suppression, keyset-paged, and proportional to actual churn. Rows
 *      AFTER the horizon are never deleted (post-freeze scan rows are S2's),
 *      only counted as `staleBeyondHorizon`. Rows of non-migrated workers
 *      are untouchable by construction (deletion scope requires a non-stub
 *      id_map worker mapping).
 *   3. OPEN-END ADVANCEMENT. `--open-end-through YYYY-MM` is now OPTIONAL
 *      and defaults to the current month in fund-local time (LA). Each daily
 *      run therefore extends open spans by exactly the delta; a span closed
 *      in S1 retracts its previously-extended future months (they become
 *      stale). At final cutover the operator passes the ruled freeze month
 *      explicitly, matching verify-month-parity's flag.
 *   4. ANCHOR MAINTENANCE. id_map `wb` (span nid → anchor month-row id) is
 *      CONSUMED BY T18 (ledger references resolve wb → live trust_wmb id),
 *      so anchors must never dangle: after the diff, anchors whose row was
 *      deleted are re-pointed to the span's first surviving month row,
 *      anchors of spans with no surviving months are retired, and new spans
 *      get anchors once their months exist. (The pre-conversion
 *      `mapped_anchor_missing` reject is retired — dangling anchors are now
 *      repaired automatically.)
 *
 *   Election-employer refresh: spans without a shop fall back to the linked
 *   election's employer. That election can change employer WITHOUT the span
 *   changing in S1, so scratch rows flagged employer_from_election re-check
 *   the election's current employer every run (bounded: only flagged spans).
 *   Other dependency remaps (worker/relation/benefit id_map repairs) do NOT
 *   auto-refresh scratch — run `--force-reconcile` after such repairs.
 *
 * GRAIN CONVERSION (unchanged from the freeze loader): S1
 * `sirius_trust_worker_benefit` rows are coverage SPANS (date_start ..
 * optional date_end); S2 `trust_wmb` is MONTH grain (month int + year int,
 * unique per worker/employer/benefit/month). End date mid-month → that month
 * is still covered (inclusive). Spans longer than MAX_SPAN_MONTHS (100
 * years) are rejects. An open span STARTING after the horizon is no longer a
 * reject (future-dated S1 enrollments must not fail a daily sync): it holds
 * an empty month set until the horizon catches up, counted as
 * `openSpansStartingAfterHorizon`.
 *
 * Row targeting (matches S2's premium model — trust_wmb.worker_id is the
 * COVERED person's worker row, dependents resolve via worker_relations):
 *   - field_sirius_contact_relation set → the covered person is the
 *     dependent: worker_id = relation.worker_2, source_relation_id = the
 *     mapped worker_relations id. The relation's worker_1 must equal the
 *     mapped subscriber when both are present (else fatal reject).
 *   - no relation → subscriber's own coverage: worker_id from
 *     field_sirius_trust_subscriber (fallback field_sirius_worker; if both
 *     are present and disagree, fatal reject — never guess).
 *   - employer ← field_grievance_shop; when absent, falls back to the
 *     linked election's employer (field_sirius_trust_election → T16 map).
 *   - field_sirius_active=No with no end date → end-dated from node.changed
 *     (T14/T15 convention), counted separately for month-parity scrutiny.
 *
 * trust_wmb has NO data column: provenance lives in id_map (entity `wb`) +
 * source_relation_id. Overlapping S1 spans for the same (worker, employer,
 * benefit) legally share month rows; a shared month's source_relation_id is
 * the FIRST covering span's (lowest nid — matches the freeze loader's
 * creation order), preferring nothing: NULL own-coverage only wins when the
 * lowest-nid covering span is own coverage.
 *
 * Idempotency: a re-run with identical staging + horizon does zero S2
 * writes. DRY RUN reconciles against a throwaway COPY of the scratch table
 * (real scratch, id_map and S2 are untouched) and reports would-be counts.
 *
 * Usage: npx tsx scripts/s1-migration/load-benefit-history.ts \
 *          [--dry-run] [--allow-rejects r1,r2] [--open-end-through YYYY-MM] \
 *          [--force-reconcile] [--allow-findings k1,k2]
 * Output is aggregate counts only (no PII).
 */
import { storage } from "../../server/storage/database";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, remapMapping, deleteMapping } from "./lib/idmap";
import { RejectLog, pagedStaged, stagedCountOf, chunk, strOf, targetNidOf, toYmd, epochToYmd, yesNo, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  resolveBenefitNidMap,
  ymOfYmd,
  ymKey,
  parseYm,
  compareYm,
  epochToLaYm,
  MAX_SPAN_MONTHS,
  type Ym,
} from "./lib/resolvers";
import {
  buildLoaderResult,
  classifyRow,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type SyncFinding,
} from "./lib/sync";

const LOADER = "t17-benefit-history";
const BUNDLE = "sirius_trust_worker_benefit";
const DRY_RUN = process.argv.includes("--dry-run");
/** Loader logic version — BUMP whenever resolution logic (targeting rules,
 * date conventions) changes so scratch rows re-resolve on their next run. */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();
/** Open-end horizon: explicit flag, else the current month in fund-local
 * (LA) time — each daily dual-run sync advances open spans to "now". The
 * final cutover run and verify-month-parity must pass the SAME ruled month
 * explicitly (RUNBOOK §6/§10). */
const OPEN_END_FLAG: Ym | null = (() => {
  const i = process.argv.indexOf("--open-end-through");
  if (i < 0 || !process.argv[i + 1]) return null;
  const ym = parseYm(process.argv[i + 1]);
  if (!ym) throw new Error(`--open-end-through must be YYYY-MM, got "${process.argv[i + 1]}"`);
  return ym;
})();
const OPEN_END_THROUGH: Ym = OPEN_END_FLAG ?? epochToLaYm(Date.now() / 1000);
const idxOfYm = (ym: Ym) => ym.y * 12 + (ym.m - 1);
const H_IDX = idxOfYm(OPEN_END_THROUGH);

/** All reasons are span-skipping (fatal for that S1 record). Retired since
 * the freeze loader: open_end_through_required (horizon now defaults),
 * open_span_after_through (loads with an empty month set — counted, not
 * rejected), mapped_anchor_missing (anchors auto-repair). */
const FATAL_REASONS = [
  "benefit_ref_missing",
  "benefit_unmapped",
  "worker_ref_missing",
  "worker_unmapped",
  "subscriber_worker_mismatch",
  "relation_unmapped",
  "relation_map_broken",
  "relation_subscriber_mismatch",
  "employer_unresolved",
  "start_missing",
  "bad_start_date",
  "bad_end_date",
  "end_before_start",
  "inactive_no_end",
  "bad_changed_epoch",
  "span_too_long",
  "wmb_create_failed",
  "wmb_delete_failed",
  "wmb_rel_repair_failed",
] as const;

/** Persistent scratch (survives runs; resolution cache + sync fingerprints).
 * DRY RUN operates on a throwaway copy so nothing durable moves. */
const SPANS_TABLE = DRY_RUN ? "s1_staging.t17_desired_spans_dryrun" : "s1_staging.t17_desired_spans";
const SPANS = () => sql.raw(SPANS_TABLE);

interface ResolvedSpan {
  nid: number;
  contentHash: string | null;
  workerId: string;
  employerId: string;
  benefitId: string;
  sourceRelationId: string | null;
  employerFromElection: boolean;
  startIdx: number;
  endIdx: number | null; // null = open-ended
}

const PAGE = 2000;

async function ensureScratchTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.t17_desired_spans (
      nid bigint PRIMARY KEY,
      worker_id varchar NOT NULL,
      employer_id varchar NOT NULL,
      benefit_id varchar NOT NULL,
      source_relation_id varchar,
      employer_from_election boolean NOT NULL DEFAULT false,
      start_idx int NOT NULL,
      end_idx int,
      consumed_fingerprint text,
      logic_version int,
      last_synced_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS t17_desired_spans_worker_idx ON s1_staging.t17_desired_spans (worker_id)`);
  // deletion-scope + anchor probes join id_map by (entity, s2_id)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS id_map_entity_s2_id_idx ON s1_staging.id_map (entity, s2_id)`);
  // run-scoped work tables (UNLOGGED: rebuilt every run; NOT TEMP — the pool
  // uses many sessions, so a temp table would vanish between statements)
  await db.execute(sql`
    CREATE UNLOGGED TABLE IF NOT EXISTS s1_staging.t17_diff_months (
      worker_id varchar NOT NULL,
      employer_id varchar NOT NULL,
      benefit_id varchar NOT NULL,
      month int NOT NULL,
      year int NOT NULL,
      source_relation_id varchar,
      nid bigint NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNLOGGED TABLE IF NOT EXISTS s1_staging.t17_missing_rows (
      seq bigserial PRIMARY KEY,
      worker_id varchar NOT NULL,
      employer_id varchar NOT NULL,
      benefit_id varchar NOT NULL,
      month int NOT NULL,
      year int NOT NULL,
      source_relation_id varchar,
      nid bigint NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNLOGGED TABLE IF NOT EXISTS s1_staging.t17_stale_rows (
      seq bigserial PRIMARY KEY,
      wmb_id varchar NOT NULL,
      worker_id varchar NOT NULL,
      month int NOT NULL,
      year int NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNLOGGED TABLE IF NOT EXISTS s1_staging.t17_rel_repair (
      seq bigserial PRIMARY KEY,
      wmb_id varchar NOT NULL,
      worker_id varchar NOT NULL,
      employer_id varchar NOT NULL,
      benefit_id varchar NOT NULL,
      month int NOT NULL,
      year int NOT NULL,
      desired_relation_id varchar,
      nid bigint NOT NULL
    )
  `);
  if (DRY_RUN) {
    await db.execute(sql`DROP TABLE IF EXISTS s1_staging.t17_desired_spans_dryrun`);
    await db.execute(sql`CREATE UNLOGGED TABLE s1_staging.t17_desired_spans_dryrun (LIKE s1_staging.t17_desired_spans INCLUDING ALL)`);
    await db.execute(sql`INSERT INTO s1_staging.t17_desired_spans_dryrun SELECT * FROM s1_staging.t17_desired_spans`);
  }
}

const rowsOf = <T,>(r: unknown) => (r as { rows: T[] }).rows;
const countOf = async (q: ReturnType<typeof sql>): Promise<number> => {
  const res = rowsOf<{ c: string | number }>(await db.execute(q));
  return Number(res[0]?.c ?? 0);
};

/** Desired-months anti-join fragments (single source of truth for diff,
 * verify and the beyond-horizon audit). */
const missingWhere = () => sql`
  NOT EXISTS (
    SELECT 1 FROM trust_wmb w
     WHERE w.worker_id = d.worker_id AND w.employer_id = d.employer_id
       AND w.benefit_id = d.benefit_id AND w.month = d.month AND w.year = d.year
  )`;
const staleWhere = (hIdx: number) => sql`
  (w.year * 12 + w.month - 1) <= ${hIdx}
  AND EXISTS (
    SELECT 1 FROM s1_staging.id_map m
     WHERE m.entity = 'worker' AND m.stub = false AND m.s2_id = w.worker_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM s1_staging.t17_diff_months d
     WHERE d.worker_id = w.worker_id AND d.employer_id = w.employer_id
       AND d.benefit_id = w.benefit_id AND d.month = w.month AND d.year = w.year
  )`;
const relDivergeJoin = () => sql`
  FROM trust_wmb w
  JOIN s1_staging.t17_diff_months d
    ON d.worker_id = w.worker_id AND d.employer_id = w.employer_id
   AND d.benefit_id = w.benefit_id AND d.month = w.month AND d.year = w.year
 WHERE COALESCE(w.source_relation_id, '') <> COALESCE(d.source_relation_id, '')`;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureScratchTables();

  const report: Record<string, unknown> = {
    loader: LOADER,
    dryRun: DRY_RUN,
    allowedRejects: ALLOWED_REJECTS,
    openEndThrough: ymKey(OPEN_END_THROUGH),
    openEndThroughSource: OPEN_END_FLAG ? "flag" : "default-current-la-month",
  };
  const rejects = new RejectLog();
  const summary = emptySummary();
  throttleStorageOpLogs();

  report.staged = await stagedCountOf(BUNDLE);
  report.preexistingMonthRows = await countOf(sql`SELECT count(*)::bigint AS c FROM trust_wmb`);

  // Empty/truncated staging on a sync target would classify EVERY span as
  // S1-deleted and delete every migrated month row. Refuse loudly.
  if ((report.staged as number) === 0) {
    const scratchCount = await countOf(sql`SELECT count(*)::bigint AS c FROM ${SPANS()}`);
    if (scratchCount > 0) {
      console.error(
        `FAIL: staging has 0 ${BUNDLE} rows but the desired-span scratch holds ${scratchCount} spans — ` +
          `refusing to reconcile (this would delete every migrated benefit month). Restage first.`,
      );
      await pgPool.end();
      process.exit(1);
    }
    report.note = "staging empty and scratch empty — nothing to reconcile";
    const result = buildLoaderResult({
      loader: LOADER, logicVersion: LOGIC_VERSION, dryRun: DRY_RUN, forceReconcile: FORCE_RECONCILE,
      summary, rejects, allowedRejects: ALLOWED_REJECTS, verifyFailures: 0, detail: report,
    });
    emitLoaderResult(result);
    if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, result as unknown as Record<string, unknown>);
    await pgPool.end();
    process.exit(loaderExitCode(result));
  }

  // heartbeat: aggregates only (span counts/elapsed/rate — never row contents)
  const progress = makeProgressLogger(LOADER, report.staged as number);
  let progressDone = 0;
  progress.phase("pre-scan");

  const benefitRes = await resolveBenefitNidMap(LOADER, DRY_RUN);
  report.benefitResolution = {
    stagedBenefits: benefitRes.stagedBenefits,
    viaIdMap: benefitRes.viaIdMap,
    viaSiriusId: benefitRes.viaSiriusId,
    viaName: benefitRes.viaName,
    ambiguousNames: benefitRes.ambiguousNames,
    unresolved: benefitRes.unresolved.length,
  };

  // ---- global counters ----
  let fastPathSkips = 0;
  let resolvedSpans = 0;
  let spanUpserts = 0;
  let openSpans = 0;
  let openAfterHorizon = 0;
  let inactiveEndDated = 0;
  let employerFromElection = 0;
  let dependentSpans = 0;
  let monthsExpanded = 0;
  let maxSpanMonths = 0;
  let pages = 0;
  const rejectedNids: number[] = [];

  // ================= PHASE 1: span resolution (incremental) =================
  // Keyset-paged; only spans whose staged content_hash differs from the
  // scratch row's consumed fingerprint (or with no scratch row) re-resolve.
  for await (const staged of pagedStaged(BUNDLE)) {
    pages++;
    progress.phase(null);

    // ---- classification against scratch fingerprints ----
    const fpRes = rowsOf<{ nid: string | number; consumed_fingerprint: string | null; logic_version: number | null }>(
      await db.execute(sql`
        SELECT nid, consumed_fingerprint, logic_version FROM ${SPANS()}
         WHERE nid IN (${sql.join(staged.map((s) => sql`${s.nid}`), sql`, `)})
      `),
    );
    const scratchFp = new Map<number, { consumedFingerprint: string | null; logicVersion: number | null }>();
    for (const r of fpRes) {
      scratchFp.set(Number(r.nid), {
        consumedFingerprint: r.consumed_fingerprint,
        logicVersion: r.logic_version == null ? null : Number(r.logic_version),
      });
    }
    const toProcess: typeof staged = [];
    for (const s of staged) {
      const fp = scratchFp.get(s.nid);
      const asMapping = fp ? { stub: false, consumedFingerprint: fp.consumedFingerprint, logicVersion: fp.logicVersion } : undefined;
      if (asMapping && classifyRow(asMapping, s.contentHash, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
        summary.unchanged++;
        fastPathSkips++;
        progressDone++;
        continue;
      }
      toProcess.push(s);
    }
    progress.update(progressDone);
    if (toProcess.length === 0) continue;

    // ---- per-page bulk id_map lookups (changed/new spans only) ----
    const workerNids: number[] = [];
    const employerNids: number[] = [];
    const relationNids: number[] = [];
    const electionNids: number[] = [];
    for (const s of toProcess) {
      for (const k of ["field_sirius_trust_subscriber", "field_sirius_worker"]) {
        const n = targetNidOf(s.fields, k);
        if (n != null) workerNids.push(n);
      }
      const e = targetNidOf(s.fields, "field_grievance_shop");
      if (e != null) employerNids.push(e);
      const r = targetNidOf(s.fields, "field_sirius_contact_relation");
      if (r != null) relationNids.push(r);
      const el = targetNidOf(s.fields, "field_sirius_trust_election");
      if (el != null) electionNids.push(el);
    }
    const [workerMap, employerMap, relationMap, electionMap] = await Promise.all([
      getMappings("worker", workerNids),
      getMappings("employer", employerNids),
      getMappings("relation", relationNids),
      getMappings("election", electionNids),
    ]);

    // ---- worker_relations rows for dependent targeting (worker_2) ----
    const relationRow = new Map<string, { worker1: string; worker2: string }>();
    const relIds = [...new Set([...relationMap.values()].map((v) => v.s2Id))];
    for (const ids of chunk(relIds, 500)) {
      const res = rowsOf<{ id: string; worker_1: string; worker_2: string }>(await db.execute(sql`
        SELECT id, worker_1, worker_2 FROM worker_relations
         WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `));
      for (const r of res) relationRow.set(r.id, { worker1: r.worker_1, worker2: r.worker_2 });
    }

    // ---- election employer fallback (batched per page) ----
    const electionEmployer = new Map<string, string>();
    const electionIds = [...new Set([...electionMap.values()].map((v) => v.s2Id))];
    for (const ids of chunk(electionIds, 500)) {
      const res = rowsOf<{ id: string; employer_id: string }>(await db.execute(sql`
        SELECT id, employer_id FROM worker_trust_elections
         WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `));
      for (const r of res) electionEmployer.set(r.id, r.employer_id);
    }

    // ---- resolve pass (page-scoped; identical semantics to the freeze
    // loader except the two retired open-span rejects) ----
    const resolved: ResolvedSpan[] = [];

    for (const s of toProcess) {
    const nid = s.nid;
    const f = s.fields;

    const benefitNid = targetNidOf(f, "field_sirius_trust_benefit");
    if (benefitNid == null) {
      rejects.add("benefit_ref_missing", { nid }, nid);
      continue;
    }
    const benefitId = benefitRes.map.get(benefitNid);
    if (!benefitId) {
      rejects.add("benefit_unmapped", { nid, benefitNid }, nid);
      continue;
    }

    const subNid = targetNidOf(f, "field_sirius_trust_subscriber");
    const wNid = targetNidOf(f, "field_sirius_worker");
    const subscriberWorkerId = subNid != null ? workerMap.get(subNid)?.s2Id ?? null : null;

    const relNid = targetNidOf(f, "field_sirius_contact_relation");
    let workerId: string | null = null;
    let sourceRelationId: string | null = null;
    if (relNid != null) {
      const relId = relationMap.get(relNid)?.s2Id;
      if (!relId) {
        rejects.add("relation_unmapped", { nid, relationNid: relNid }, nid);
        continue;
      }
      const rel = relationRow.get(relId);
      if (!rel) {
        rejects.add("relation_map_broken", { nid, relationNid: relNid }, nid);
        continue;
      }
      if (subscriberWorkerId && rel.worker1 !== subscriberWorkerId) {
        rejects.add("relation_subscriber_mismatch", { nid, relationNid: relNid }, nid);
        continue;
      }
      workerId = rel.worker2;
      sourceRelationId = relId;
      dependentSpans++;
    } else {
      const ownerNid = subNid ?? wNid;
      if (ownerNid == null) {
        rejects.add("worker_ref_missing", { nid }, nid);
        continue;
      }
      if (subNid != null && wNid != null && subNid !== wNid) {
        rejects.add("subscriber_worker_mismatch", { nid, subNid, wNid }, nid);
        continue;
      }
      workerId = workerMap.get(ownerNid)?.s2Id ?? null;
      if (!workerId) {
        rejects.add("worker_unmapped", { nid, workerNid: ownerNid }, nid);
        continue;
      }
    }

    let employerId: string | null = null;
    let viaElection = false;
    const shopNid = targetNidOf(f, "field_grievance_shop");
    if (shopNid != null) employerId = employerMap.get(shopNid)?.s2Id ?? null;
    if (!employerId) {
      const elNid = targetNidOf(f, "field_sirius_trust_election");
      const elId = elNid != null ? electionMap.get(elNid)?.s2Id : undefined;
      if (elId) {
        employerId = electionEmployer.get(elId) ?? null;
        if (employerId) {
          employerFromElection++;
          viaElection = true;
        }
      }
    }
    if (!employerId) {
      rejects.add("employer_unresolved", { nid }, nid);
      continue;
    }

    const startRaw = strOf(f, "field_sirius_date_start");
    if (!startRaw) {
      rejects.add("start_missing", { nid }, nid);
      continue;
    }
    const startYmd = toYmd(startRaw);
    if (!startYmd) {
      rejects.add("bad_start_date", { nid }, nid);
      continue;
    }
    const endRaw = strOf(f, "field_sirius_date_end");
    let endYmd: string | null = null;
    if (endRaw) {
      endYmd = toYmd(endRaw);
      if (!endYmd) {
        rejects.add("bad_end_date", { nid }, nid);
        continue;
      }
    }

    // T14 active reconcile (counted for month-parity scrutiny)
    const active = yesNo(strOf(f, "field_sirius_active"));
    if (active === false && !endYmd) {
      if (s.changed == null) {
        rejects.add("inactive_no_end", { nid }, nid);
        continue;
      }
      const changedYmd = epochToYmd(s.changed);
      if (!changedYmd) {
        rejects.add("bad_changed_epoch", { nid, changed: s.changed }, nid);
        continue;
      }
      endYmd = changedYmd;
      inactiveEndDated++;
    }

    const startYm = ymOfYmd(startYmd);
    const endYm: Ym | null = endYmd ? ymOfYmd(endYmd) : null;
    if (endYm && compareYm(endYm, startYm) < 0) {
      rejects.add("end_before_start", { nid }, nid);
      continue;
    }
    const startIdx = idxOfYm(startYm);
    const endIdx = endYm ? idxOfYm(endYm) : null;
    if (endIdx == null) {
      openSpans++;
      if (startIdx > H_IDX) openAfterHorizon++; // empty month set until the horizon advances
    }
    const effectiveEnd = endIdx ?? H_IDX;
    const expansion = Math.max(0, effectiveEnd - startIdx + 1);
    if (expansion > MAX_SPAN_MONTHS) {
      rejects.add("span_too_long", { nid, startYm: ymKey(startYm), endYm: endYm ? ymKey(endYm) : ymKey(OPEN_END_THROUGH) }, nid);
      continue;
    }
    monthsExpanded += expansion;
    if (expansion > maxSpanMonths) maxSpanMonths = expansion;
    resolved.push({
      nid,
      contentHash: s.contentHash,
      workerId,
      employerId,
      benefitId,
      sourceRelationId,
      employerFromElection: viaElection,
      startIdx,
      endIdx,
    });
    }
    resolvedSpans += resolved.length;
    for (const s of toProcess) {
      if (rejects.hasAny(s.nid)) rejectedNids.push(s.nid);
    }
    progressDone += toProcess.length;
    progress.update(progressDone);

    // ---- scratch upsert (batched; rejected spans left untouched) ----
    for (const batch of chunk(resolved, 500)) {
      await db.execute(sql`
        INSERT INTO ${SPANS()}
          (nid, worker_id, employer_id, benefit_id, source_relation_id, employer_from_election,
           start_idx, end_idx, consumed_fingerprint, logic_version, last_synced_at)
        VALUES ${sql.join(
          batch.map(
            (r) => sql`(${r.nid}::bigint, ${r.workerId}::varchar, ${r.employerId}::varchar, ${r.benefitId}::varchar,
              ${r.sourceRelationId}::varchar, ${r.employerFromElection}::boolean, ${r.startIdx}::int,
              ${r.endIdx}::int, ${r.contentHash}::text, ${LOGIC_VERSION}::int, now())`,
          ),
          sql`, `,
        )}
        ON CONFLICT (nid) DO UPDATE SET
          worker_id = EXCLUDED.worker_id,
          employer_id = EXCLUDED.employer_id,
          benefit_id = EXCLUDED.benefit_id,
          source_relation_id = EXCLUDED.source_relation_id,
          employer_from_election = EXCLUDED.employer_from_election,
          start_idx = EXCLUDED.start_idx,
          end_idx = EXCLUDED.end_idx,
          consumed_fingerprint = EXCLUDED.consumed_fingerprint,
          logic_version = EXCLUDED.logic_version,
          last_synced_at = now()
      `);
      spanUpserts += batch.length;
    }
  }

  // Rejected spans that still hold an OLD scratch row keep contributing their
  // stale desired months (stale-but-safe; prevents transient rejects from
  // cascading into deletions). Surfaced for the operator every run.
  let rejectedWithStaleDesired = 0;
  for (const ids of chunk(rejectedNids, 500)) {
    rejectedWithStaleDesired += await countOf(sql`
      SELECT count(*)::bigint AS c FROM ${SPANS()}
       WHERE nid IN (${sql.join(ids.map((n) => sql`${n}`), sql`, `)})
    `);
  }

  // ---- election-employer refresh (flagged spans only; election employer can
  // change in S2 via the T16 sync without the span changing in S1) ----
  progress.phase("employer-refresh");
  let employerRefreshed = 0;
  {
    let cursor = 0;
    for (;;) {
      const flagged = rowsOf<{ nid: string | number; employer_id: string }>(await db.execute(sql`
        SELECT nid, employer_id FROM ${SPANS()}
         WHERE employer_from_election AND nid > ${cursor}
         ORDER BY nid LIMIT ${PAGE}
      `));
      if (flagged.length === 0) break;
      cursor = Number(flagged[flagged.length - 1].nid);
      const nids = flagged.map((r) => Number(r.nid));
      // staged election ref per span nid
      const staged = rowsOf<{ nid: string | number; fields: unknown }>(await db.execute(sql`
        SELECT nid, fields FROM s1_staging.records
         WHERE bundle = ${BUNDLE} AND nid IN (${sql.join(nids.map((n) => sql`${n}`), sql`, `)})
      `));
      const elNidBySpan = new Map<number, number>();
      for (const r of staged) {
        const fields = (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>;
        const elNid = targetNidOf(fields, "field_sirius_trust_election");
        if (elNid != null) elNidBySpan.set(Number(r.nid), elNid);
      }
      const elMap = await getMappings("election", [...elNidBySpan.values()]);
      const elIds = [...new Set([...elMap.values()].map((v) => v.s2Id))];
      const elEmployer = new Map<string, string>();
      for (const ids of chunk(elIds, 500)) {
        const res = rowsOf<{ id: string; employer_id: string }>(await db.execute(sql`
          SELECT id, employer_id FROM worker_trust_elections
           WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        `));
        for (const r of res) elEmployer.set(r.id, r.employer_id);
      }
      const updates: Array<{ nid: number; employerId: string }> = [];
      for (const row of flagged) {
        const nid = Number(row.nid);
        const elNid = elNidBySpan.get(nid);
        const elId = elNid != null ? elMap.get(elNid)?.s2Id : undefined;
        const current = elId ? elEmployer.get(elId) : undefined;
        if (current && current !== row.employer_id) updates.push({ nid, employerId: current });
      }
      for (const u of updates) {
        await db.execute(sql`
          UPDATE ${SPANS()} SET employer_id = ${u.employerId}::varchar, last_synced_at = now()
           WHERE nid = ${u.nid}::bigint
        `);
        employerRefreshed++;
      }
      if (flagged.length < PAGE) break;
    }
  }

  // ---- S1-deletion sweep: scratch rows + wb anchor mappings ----
  progress.phase("sweep");
  let spansDeleted = 0;
  if (!DRY_RUN) {
    const del = rowsOf<{ nid: string | number }>(await db.execute(sql`
      DELETE FROM ${SPANS()} t
       WHERE NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = ${BUNDLE} AND r.nid = t.nid)
       RETURNING nid
    `));
    spansDeleted = del.length;
  } else {
    spansDeleted = await countOf(sql`
      SELECT count(*)::bigint AS c FROM ${SPANS()} t
       WHERE NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = ${BUNDLE} AND r.nid = t.nid)
    `);
    // keep the dry-run copy faithful for the diff below
    await db.execute(sql`
      DELETE FROM ${SPANS()} t
       WHERE NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = ${BUNDLE} AND r.nid = t.nid)
    `);
  }
  const findings: SyncFinding[] = [];
  const wbSweep = await sweepDeletions({
    entity: "wb",
    loaders: [LOADER],
    sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = ${BUNDLE}`,
    dryRun: DRY_RUN,
    policy: async () => ({
      // The anchor mapping simply goes away; the span's month rows are
      // removed by the global diff (its scratch row was deleted above).
      action: "delete",
      apply: async () => {},
    }),
  });
  report.wbSweep = { candidates: wbSweep.candidates, deleted: wbSweep.deleted, alreadyHandled: wbSweep.alreadyHandled };
  findings.push(...wbSweep.findings);

  // ================= PHASE 2: set-based month diff =================
  progress.phase("diff-materialize");
  await db.execute(sql`TRUNCATE s1_staging.t17_diff_months`);
  await db.execute(sql`DROP INDEX IF EXISTS s1_staging.t17_diff_months_key_idx`);
  // Expand ALL scratch spans through the horizon. Shared months collapse to
  // one row; source_relation_id = the LOWEST-nid covering span's relation
  // (matches the freeze loader's first-creator-wins creation order).
  await db.execute(sql`
    INSERT INTO s1_staging.t17_diff_months (worker_id, employer_id, benefit_id, month, year, source_relation_id, nid)
    SELECT worker_id, employer_id, benefit_id,
           (idx % 12) + 1 AS month, idx / 12 AS year,
           (array_agg(source_relation_id ORDER BY nid))[1] AS source_relation_id,
           min(nid) AS nid
      FROM (
        SELECT s.worker_id, s.employer_id, s.benefit_id, s.source_relation_id, s.nid,
               generate_series(s.start_idx, COALESCE(s.end_idx, ${H_IDX}::int)) AS idx
          FROM ${SPANS()} s
      ) x
     GROUP BY worker_id, employer_id, benefit_id, idx
  `);
  await db.execute(sql`CREATE INDEX t17_diff_months_key_idx ON s1_staging.t17_diff_months (worker_id, employer_id, benefit_id, month, year)`);
  await db.execute(sql`ANALYZE s1_staging.t17_diff_months`);
  report.scratchSpans = await countOf(sql`SELECT count(*)::bigint AS c FROM ${SPANS()}`);
  report.desiredMonths = await countOf(sql`SELECT count(*)::bigint AS c FROM s1_staging.t17_diff_months`);

  // ---- materialize the three churn sets (set-based; write work below is
  // proportional to these counts, not to total volume) ----
  await db.execute(sql`TRUNCATE s1_staging.t17_missing_rows RESTART IDENTITY`);
  await db.execute(sql`
    INSERT INTO s1_staging.t17_missing_rows (worker_id, employer_id, benefit_id, month, year, source_relation_id, nid)
    SELECT d.worker_id, d.employer_id, d.benefit_id, d.month, d.year, d.source_relation_id, d.nid
      FROM s1_staging.t17_diff_months d
     WHERE ${missingWhere()}
  `);
  await db.execute(sql`TRUNCATE s1_staging.t17_stale_rows RESTART IDENTITY`);
  await db.execute(sql`
    INSERT INTO s1_staging.t17_stale_rows (wmb_id, worker_id, month, year)
    SELECT w.id, w.worker_id, w.month, w.year
      FROM trust_wmb w
     WHERE ${staleWhere(H_IDX)}
  `);
  await db.execute(sql`TRUNCATE s1_staging.t17_rel_repair RESTART IDENTITY`);
  await db.execute(sql`
    INSERT INTO s1_staging.t17_rel_repair (wmb_id, worker_id, employer_id, benefit_id, month, year, desired_relation_id, nid)
    SELECT w.id, w.worker_id, w.employer_id, w.benefit_id, w.month, w.year, d.source_relation_id, d.nid
    ${relDivergeJoin()}
  `);
  const missingCount = await countOf(sql`SELECT count(*)::bigint AS c FROM s1_staging.t17_missing_rows`);
  const staleCount = await countOf(sql`SELECT count(*)::bigint AS c FROM s1_staging.t17_stale_rows`);
  const relCount = await countOf(sql`SELECT count(*)::bigint AS c FROM s1_staging.t17_rel_repair`);

  // Post-freeze rows (beyond the horizon) are NEVER deleted — S2's scan owns
  // them after cutover. Counted for operator visibility only: nonzero during
  // the dual-run means something besides this sync writes migrated workers'
  // months (the benefits scan must stay disabled until cutover).
  report.staleBeyondHorizon = await countOf(sql`
    SELECT count(*)::bigint AS c FROM trust_wmb w
     WHERE (w.year * 12 + w.month - 1) > ${H_IDX}
       AND EXISTS (
         SELECT 1 FROM s1_staging.id_map m
          WHERE m.entity = 'worker' AND m.stub = false AND m.s2_id = w.worker_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM s1_staging.t17_diff_months d
          WHERE d.worker_id = w.worker_id AND d.employer_id = w.employer_id
            AND d.benefit_id = w.benefit_id AND d.month = w.month AND d.year = w.year
       )
  `);

  // ---- apply: creates, deletes, rel repairs (per-row storage writes inside
  // suppression; keyset-paged by seq) ----
  let monthsCreated = 0;
  let monthsDeleted = 0;
  let relRepaired = 0;

  if (DRY_RUN) {
    monthsCreated = missingCount;
    monthsDeleted = staleCount;
    relRepaired = relCount;
  } else {
    progress.phase("diff-create", missingCount);
    let cursor = 0;
    for (;;) {
      const rows = rowsOf<{ seq: string | number; worker_id: string; employer_id: string; benefit_id: string; month: number; year: number; source_relation_id: string | null; nid: string | number }>(
        await db.execute(sql`
          SELECT seq, worker_id, employer_id, benefit_id, month, year, source_relation_id, nid
            FROM s1_staging.t17_missing_rows WHERE seq > ${cursor} ORDER BY seq LIMIT ${PAGE}
        `),
      );
      if (rows.length === 0) break;
      cursor = Number(rows[rows.length - 1].seq);
      for (const r of rows) {
        progress.add(1);
        try {
          await withNotificationsSuppressed(() =>
            withChargePluginsSuppressed(() =>
              storage.trust.wmb.createWorkerBenefit({
                workerId: r.worker_id,
                month: Number(r.month),
                year: Number(r.year),
                employerId: r.employer_id,
                benefitId: r.benefit_id,
                sourceRelationId: r.source_relation_id,
              }),
            ),
          );
          monthsCreated++;
        } catch {
          rejects.add("wmb_create_failed", { nid: Number(r.nid), ym: `${r.year}-${String(r.month).padStart(2, "0")}` }, Number(r.nid));
        }
      }
      if (rows.length < PAGE) break;
    }

    progress.phase("diff-delete", staleCount);
    cursor = 0;
    for (;;) {
      const rows = rowsOf<{ seq: string | number; wmb_id: string; month: number; year: number }>(
        await db.execute(sql`
          SELECT seq, wmb_id, month, year FROM s1_staging.t17_stale_rows
           WHERE seq > ${cursor} ORDER BY seq LIMIT ${PAGE}
        `),
      );
      if (rows.length === 0) break;
      cursor = Number(rows[rows.length - 1].seq);
      for (const r of rows) {
        progress.add(1);
        try {
          await withNotificationsSuppressed(() =>
            withChargePluginsSuppressed(async () => {
              await storage.trust.wmb.deleteWorkerBenefit(r.wmb_id);
            }),
          );
          monthsDeleted++;
        } catch {
          rejects.add("wmb_delete_failed", { ym: `${r.year}-${String(r.month).padStart(2, "0")}` });
        }
      }
      if (rows.length < PAGE) break;
    }

    progress.phase("diff-rel-repair", relCount);
    cursor = 0;
    for (;;) {
      const rows = rowsOf<{ seq: string | number; wmb_id: string; worker_id: string; employer_id: string; benefit_id: string; month: number; year: number; desired_relation_id: string | null; nid: string | number }>(
        await db.execute(sql`
          SELECT seq, wmb_id, worker_id, employer_id, benefit_id, month, year, desired_relation_id, nid
            FROM s1_staging.t17_rel_repair WHERE seq > ${cursor} ORDER BY seq LIMIT ${PAGE}
        `),
      );
      if (rows.length === 0) break;
      cursor = Number(rows[rows.length - 1].seq);
      for (const r of rows) {
        progress.add(1);
        try {
          await withNotificationsSuppressed(() =>
            withChargePluginsSuppressed(async () => {
              await storage.trust.wmb.deleteWorkerBenefit(r.wmb_id);
              await storage.trust.wmb.createWorkerBenefit({
                workerId: r.worker_id,
                month: Number(r.month),
                year: Number(r.year),
                employerId: r.employer_id,
                benefitId: r.benefit_id,
                sourceRelationId: r.desired_relation_id,
              });
            }),
          );
          relRepaired++;
        } catch {
          rejects.add("wmb_rel_repair_failed", { nid: Number(r.nid), ym: `${r.year}-${String(r.month).padStart(2, "0")}` }, Number(r.nid));
        }
      }
      if (rows.length < PAGE) break;
    }
  }
  summary.created += monthsCreated;
  summary.deleted += monthsDeleted + wbSweep.deleted;
  summary.updated += relRepaired;

  // ================= PHASE 3: anchor maintenance =================
  // wb anchors are consumed by T18 (ledger reference resolution) and must
  // always point at a LIVE trust_wmb row of their span.
  let anchorsRepointed = 0;
  let anchorsRetired = 0;
  let anchorsCreated = 0;
  if (!DRY_RUN) {
    progress.phase("anchors");
    const dangling = rowsOf<{ nid: string | number }>(await db.execute(sql`
      SELECT m.s1_id AS nid FROM s1_staging.id_map m
       WHERE m.entity = 'wb' AND m.stub = false
         AND NOT EXISTS (SELECT 1 FROM trust_wmb w WHERE w.id = m.s2_id)
       ORDER BY m.s1_id
    `));
    for (const batch of chunk(dangling.map((d) => Number(d.nid)), 500)) {
      const replacements = rowsOf<{ nid: string | number; id: string }>(await db.execute(sql`
        SELECT s.nid, a.id FROM ${SPANS()} s
        CROSS JOIN LATERAL (
          SELECT w.id FROM trust_wmb w
           WHERE w.worker_id = s.worker_id AND w.employer_id = s.employer_id AND w.benefit_id = s.benefit_id
             AND (w.year * 12 + w.month - 1) BETWEEN s.start_idx AND COALESCE(s.end_idx, ${H_IDX}::int)
           ORDER BY w.year, w.month LIMIT 1
        ) a
        WHERE s.nid IN (${sql.join(batch.map((n) => sql`${n}`), sql`, `)})
      `));
      const replacementByNid = new Map(replacements.map((r) => [Number(r.nid), r.id]));
      for (const nid of batch) {
        const newId = replacementByNid.get(nid);
        if (newId) {
          await remapMapping("wb", nid, newId, LOADER);
          anchorsRepointed++;
        } else {
          // span gone from scratch (deleted/rejected) or has no surviving
          // months (e.g. open span starting after the horizon)
          await deleteMapping("wb", nid);
          anchorsRetired++;
        }
      }
    }
    // new anchors: scratch spans with surviving months but no wb mapping yet
    let cursor = 0;
    for (;;) {
      const rows = rowsOf<{ nid: string | number; id: string }>(await db.execute(sql`
        SELECT s.nid, a.id FROM ${SPANS()} s
        CROSS JOIN LATERAL (
          SELECT w.id FROM trust_wmb w
           WHERE w.worker_id = s.worker_id AND w.employer_id = s.employer_id AND w.benefit_id = s.benefit_id
             AND (w.year * 12 + w.month - 1) BETWEEN s.start_idx AND COALESCE(s.end_idx, ${H_IDX}::int)
           ORDER BY w.year, w.month LIMIT 1
        ) a
        WHERE s.nid > ${cursor}
          AND NOT EXISTS (SELECT 1 FROM s1_staging.id_map m WHERE m.entity = 'wb' AND m.s1_id = s.nid)
        ORDER BY s.nid LIMIT ${PAGE}
      `));
      // cursor must advance over ALL scanned spans, not just matches — page on
      // the scratch table itself to avoid stalling when a stretch has no rows
      const scanned = rowsOf<{ nid: string | number }>(await db.execute(sql`
        SELECT nid FROM ${SPANS()} WHERE nid > ${cursor} ORDER BY nid LIMIT ${PAGE}
      `));
      if (scanned.length === 0) break;
      cursor = Number(scanned[scanned.length - 1].nid);
      const scannedSet = new Set(scanned.map((r) => Number(r.nid)));
      for (const r of rows) {
        if (!scannedSet.has(Number(r.nid))) continue; // belongs to a later page
        await putMapping("wb", Number(r.nid), r.id, { stub: false, loader: LOADER });
        anchorsCreated++;
      }
      if (scanned.length < PAGE) break;
    }
  }

  // ================= verify pass (global, set-based) =================
  progress.phase("verify");
  let verifyFailures = 0;
  const verify: Record<string, number> = {};
  if (!DRY_RUN) {
    verify.missingAfter = await countOf(sql`
      SELECT count(*)::bigint AS c FROM s1_staging.t17_diff_months d WHERE ${missingWhere()}
    `);
    verify.staleAfter = await countOf(sql`
      SELECT count(*)::bigint AS c FROM trust_wmb w WHERE ${staleWhere(H_IDX)}
    `);
    verify.relDivergedAfter = await countOf(sql`SELECT count(*)::bigint AS c ${relDivergeJoin()}`);
    verify.danglingAnchorsAfter = await countOf(sql`
      SELECT count(*)::bigint AS c FROM s1_staging.id_map m
       WHERE m.entity = 'wb' AND m.stub = false
         AND NOT EXISTS (SELECT 1 FROM trust_wmb w WHERE w.id = m.s2_id)
    `);
    verifyFailures = verify.missingAfter + verify.staleAfter + verify.relDivergedAfter + verify.danglingAnchorsAfter;
  }
  report.verify = verify;
  progress.stop();

  report.pages = pages;
  report.fastPathSkips = fastPathSkips;
  report.resolvedSpans = resolvedSpans;
  report.spanUpserts = spanUpserts;
  report.spansDeleted = spansDeleted;
  report.rejectedWithStaleDesired = rejectedWithStaleDesired;
  report.openSpans = openSpans;
  report.openSpansStartingAfterHorizon = openAfterHorizon;
  report.dependentSpans = dependentSpans;
  report.employerFromElection = employerFromElection;
  report.employerRefreshedFromElection = employerRefreshed;
  report.inactiveEndDated = inactiveEndDated;
  report.monthsExpanded = monthsExpanded;
  report.maxSpanMonths = maxSpanMonths;
  report.avgSpanMonths = resolvedSpans > 0 ? Math.round((monthsExpanded / resolvedSpans) * 10) / 10 : 0;
  report.diff = { missing: missingCount, stale: staleCount, relDiverged: relCount };
  report.monthsCreated = monthsCreated;
  report.monthsDeleted = monthsDeleted;
  report.relRepaired = relRepaired;
  report.anchors = { created: anchorsCreated, repointed: anchorsRepointed, retired: anchorsRetired };
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) {
    await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS, forceReconcile: FORCE_RECONCILE, openEndThrough: ymKey(OPEN_END_THROUGH) }, result as unknown as Record<string, unknown>);
  } else {
    await db.execute(sql`DROP TABLE IF EXISTS s1_staging.t17_desired_spans_dryrun`);
  }

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(
      `FAIL: ${result.blockingFindings.length} blocking sync finding(s) (${[...new Set(result.blockingFindings.map((f) => f.kind))].join(", ")}). ` +
        `Resolve them or acknowledge per run via --allow-findings.`,
    );
  }
  await pgPool.end();
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  // HIPAA: never echo raw driver/storage errors (they can embed row values).
  // S1_MIGRATION_DEBUG=1 restores full errors for local debugging.
  if (process.env.S1_MIGRATION_DEBUG === "1") console.error(err);
  else if (err instanceof Error) console.error(`FATAL ${err.constructor.name}: ${String(err.message).split("\n")[0]}`);
  else console.error("FATAL: unknown_error");
  process.exit(1);
});
