/**
 * T17 loader — S1 trust worker benefit records → trust_wmb, ALL history,
 * NO cutoff (N17 ruling). Load-order step: after T16 (elections).
 *
 * GRAIN CONVERSION: S1 `sirius_trust_worker_benefit` rows are coverage
 * SPANS (date_start .. optional date_end); S2 `trust_wmb` is MONTH grain
 * (month int + year int, unique per worker/employer/benefit/month). The
 * loader expands every span into its inclusive month range:
 *   - end date mid-month → that month is still covered (inclusive),
 *   - open-ended spans (no end) expand through --open-end-through YYYY-MM,
 *     which is REQUIRED when any open span exists (the operator names the
 *     transition month explicitly; post-freeze months belong to S2's scan),
 *   - spans longer than MAX_SPAN_MONTHS (100 years) are bad-date rejects.
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
 * trust_wmb has NO data column: provenance lives in id_map (entity `wb`,
 * S1 nid → ANCHOR row id = the span's first month) + source_relation_id.
 * Overlapping S1 spans for the same (worker, employer, benefit) legally
 * share month rows — shared months are adopted, not duplicated.
 *
 * Idempotency: re-runs walk every span's months again and create only the
 * missing ones (heals partial spans); anchor mappings are adopted.
 *
 * NOTE (prod scale): span expansion multiplies 609k spans into millions of
 * month rows; per-row INSERTs are fine for dev but the production freeze
 * run needs the Track C bulk-transport hardening (COPY + checkpoints).
 *
 * Usage: npx tsx scripts/s1-migration/load-benefit-history.ts \
 *          [--dry-run] [--allow-rejects r1,r2] [--open-end-through YYYY-MM]
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
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, loadStaged, strOf, targetNidOf, toYmd, epochToYmd, yesNo } from "./lib/loader-utils";
import {
  resolveBenefitNidMap,
  ymOfYmd,
  ymKey,
  parseYm,
  compareYm,
  monthsBetweenInclusive,
  type Ym,
} from "./lib/resolvers";

const LOADER = "t17-benefit-history";
const BUNDLE = "sirius_trust_worker_benefit";
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();
const OPEN_END_THROUGH: Ym | null = (() => {
  const i = process.argv.indexOf("--open-end-through");
  if (i < 0 || !process.argv[i + 1]) return null;
  const ym = parseYm(process.argv[i + 1]);
  if (!ym) throw new Error(`--open-end-through must be YYYY-MM, got "${process.argv[i + 1]}"`);
  return ym;
})();

/** All reasons are span-skipping (fatal for that S1 record). */
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
  "open_end_through_required",
  "open_span_after_through",
  "span_too_long",
  "wmb_create_failed",
  "mapped_anchor_missing",
] as const;

interface ResolvedSpan {
  nid: number;
  workerId: string;
  employerId: string;
  benefitId: string;
  sourceRelationId: string | null;
  months: Ym[];
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const rowKey = (workerId: string, employerId: string, benefitId: string, ym: Ym) =>
  `${workerId}|${employerId}|${benefitId}|${ymKey(ym)}`;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = {
    loader: LOADER,
    dryRun: DRY_RUN,
    allowedRejects: ALLOWED_REJECTS,
    openEndThrough: OPEN_END_THROUGH ? ymKey(OPEN_END_THROUGH) : null,
  };
  const rejects = new RejectLog();

  const staged = await loadStaged(BUNDLE);
  report.staged = staged.length;

  const benefitRes = await resolveBenefitNidMap(LOADER, DRY_RUN);
  report.benefitResolution = {
    stagedBenefits: benefitRes.stagedBenefits,
    viaIdMap: benefitRes.viaIdMap,
    viaSiriusId: benefitRes.viaSiriusId,
    viaName: benefitRes.viaName,
    ambiguousNames: benefitRes.ambiguousNames,
    unresolved: benefitRes.unresolved.length,
  };

  // ---- bulk id_map lookups ----
  const workerNids: number[] = [];
  const employerNids: number[] = [];
  const relationNids: number[] = [];
  const electionNids: number[] = [];
  for (const s of staged) {
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
  const [workerMap, employerMap, relationMap, electionMap, wbMap] = await Promise.all([
    getMappings("worker", workerNids),
    getMappings("employer", employerNids),
    getMappings("relation", relationNids),
    getMappings("election", electionNids),
    getMappings("wb", staged.map((s) => s.nid)),
  ]);

  // ---- worker_relations rows for dependent targeting (worker_2) ----
  const relationRow = new Map<string, { worker1: string; worker2: string }>();
  const relIds = [...new Set([...relationMap.values()].map((v) => v.s2Id))];
  for (const ids of chunk(relIds, 500)) {
    const res = (await db.execute(sql`
      SELECT id, worker_1, worker_2 FROM worker_relations
       WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `)) as unknown as { rows: Array<{ id: string; worker_1: string; worker_2: string }> };
    for (const r of res.rows) relationRow.set(r.id, { worker1: r.worker_1, worker2: r.worker_2 });
  }

  // ---- election employer fallback cache ----
  const electionEmployer = new Map<string, string | null>();
  async function employerOfElection(s2ElectionId: string): Promise<string | null> {
    if (!electionEmployer.has(s2ElectionId)) {
      const row = await storage.workerTrustElections.getById(s2ElectionId);
      electionEmployer.set(s2ElectionId, row?.employerId ?? null);
    }
    return electionEmployer.get(s2ElectionId) ?? null;
  }

  // ---- resolve pass (reject-complete before any write) ----
  const resolved: ResolvedSpan[] = [];
  let openSpans = 0;
  let inactiveEndDated = 0;
  let employerFromElection = 0;
  let dependentSpans = 0;
  let monthsExpanded = 0;
  let maxSpanMonths = 0;

  for (const s of staged) {
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
    const shopNid = targetNidOf(f, "field_grievance_shop");
    if (shopNid != null) employerId = employerMap.get(shopNid)?.s2Id ?? null;
    if (!employerId) {
      const elNid = targetNidOf(f, "field_sirius_trust_election");
      const elId = elNid != null ? electionMap.get(elNid)?.s2Id : undefined;
      if (elId) {
        employerId = await employerOfElection(elId);
        if (employerId) employerFromElection++;
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
      endYmd = epochToYmd(s.changed);
      inactiveEndDated++;
    }

    const startYm = ymOfYmd(startYmd);
    let endYm: Ym | null = endYmd ? ymOfYmd(endYmd) : null;
    if (endYm && compareYm(endYm, startYm) < 0) {
      rejects.add("end_before_start", { nid }, nid);
      continue;
    }
    if (!endYm) {
      openSpans++;
      if (!OPEN_END_THROUGH) {
        rejects.add("open_end_through_required", { nid }, nid);
        continue;
      }
      if (compareYm(OPEN_END_THROUGH, startYm) < 0) {
        rejects.add("open_span_after_through", { nid, startYm: ymKey(startYm) }, nid);
        continue;
      }
      endYm = OPEN_END_THROUGH;
    }

    let months: Ym[];
    try {
      months = monthsBetweenInclusive(startYm, endYm);
    } catch {
      rejects.add("span_too_long", { nid, startYm: ymKey(startYm), endYm: ymKey(endYm) }, nid);
      continue;
    }
    monthsExpanded += months.length;
    if (months.length > maxSpanMonths) maxSpanMonths = months.length;
    resolved.push({ nid, workerId, employerId, benefitId, sourceRelationId, months });
  }

  report.resolvedSpans = resolved.length;
  report.openSpans = openSpans;
  report.dependentSpans = dependentSpans;
  report.employerFromElection = employerFromElection;
  report.inactiveEndDated = inactiveEndDated;
  report.monthsExpanded = monthsExpanded;
  report.maxSpanMonths = maxSpanMonths;
  report.avgSpanMonths = resolved.length > 0 ? Math.round((monthsExpanded / resolved.length) * 10) / 10 : 0;

  // ---- prefetch existing month rows for every target worker ----
  const existingByKey = new Map<string, string>(); // rowKey → trust_wmb.id
  const targetWorkerIds = [...new Set(resolved.map((r) => r.workerId))];
  for (const ids of chunk(targetWorkerIds, 200)) {
    const res = (await db.execute(sql`
      SELECT id, month, year, worker_id, employer_id, benefit_id FROM trust_wmb
       WHERE worker_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `)) as unknown as {
      rows: Array<{ id: string; month: number; year: number; worker_id: string; employer_id: string; benefit_id: string }>;
    };
    for (const r of res.rows) {
      existingByKey.set(rowKey(r.worker_id, r.employer_id, r.benefit_id, { y: Number(r.year), m: Number(r.month) }), r.id);
    }
  }
  report.preexistingMonthRows = existingByKey.size;

  // ---- write pass (span by span; shared months adopted, never duplicated) ----
  let monthsCreated = 0;
  let monthsAdopted = 0;
  let overlapSharedMonths = 0;
  let anchorsCreated = 0;
  let anchorsAdopted = 0;
  const createdThisRun = new Set<string>();
  const loadedSpans: ResolvedSpan[] = [];

  for (const span of resolved) {
    const mappedAnchor = wbMap.get(span.nid)?.s2Id;
    let anchorId: string | null = mappedAnchor ?? null;
    if (mappedAnchor) {
      // Anchor must still exist — a broken mapping is repaired by hand, never silently remapped.
      const anchorKeyExists = [...existingByKey.values()].includes(mappedAnchor);
      if (!anchorKeyExists) {
        const res = (await db.execute(
          sql`SELECT id FROM trust_wmb WHERE id = ${mappedAnchor}`,
        )) as unknown as { rows: Array<{ id: string }> };
        if (res.rows.length === 0) {
          rejects.add("mapped_anchor_missing", { nid: span.nid }, span.nid);
          continue;
        }
      }
      anchorsAdopted++;
    }

    let spanFailed = false;
    for (const ym of span.months) {
      const key = rowKey(span.workerId, span.employerId, span.benefitId, ym);
      const existing = existingByKey.get(key);
      if (existing) {
        monthsAdopted++;
        if (createdThisRun.has(key)) overlapSharedMonths++;
        if (!anchorId) anchorId = existing;
        continue;
      }
      if (DRY_RUN) {
        monthsCreated++;
        existingByKey.set(key, `dry:${span.nid}`);
        createdThisRun.add(key);
        continue;
      }
      try {
        const row = await withNotificationsSuppressed(() =>
          withChargePluginsSuppressed(() =>
            storage.trust.wmb.createWorkerBenefit({
              workerId: span.workerId,
              month: ym.m,
              year: ym.y,
              employerId: span.employerId,
              benefitId: span.benefitId,
              sourceRelationId: span.sourceRelationId,
            }),
          ),
        );
        monthsCreated++;
        existingByKey.set(key, row.id);
        createdThisRun.add(key);
        if (!anchorId) anchorId = row.id;
      } catch {
        rejects.add("wmb_create_failed", { nid: span.nid, ym: ymKey(ym) }, span.nid);
        spanFailed = true;
        break;
      }
    }
    if (spanFailed) continue;

    if (!DRY_RUN && anchorId && !mappedAnchor) {
      await putMapping("wb", span.nid, anchorId, { stub: false, loader: LOADER });
      anchorsCreated++;
    }
    loadedSpans.push(span);
  }

  report.monthsCreated = monthsCreated;
  report.monthsAdopted = monthsAdopted;
  report.overlapSharedMonths = overlapSharedMonths;
  report.anchorsCreated = anchorsCreated;
  report.anchorsAdopted = anchorsAdopted;

  // ---- verify pass: every expected (tuple, month) row exists ----
  let verifyFailures = 0;
  const verifySamples: Array<Record<string, unknown>> = [];
  if (!DRY_RUN) {
    const verifyByKey = new Map<string, true>();
    for (const ids of chunk(targetWorkerIds, 200)) {
      const res = (await db.execute(sql`
        SELECT month, year, worker_id, employer_id, benefit_id FROM trust_wmb
         WHERE worker_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as {
        rows: Array<{ month: number; year: number; worker_id: string; employer_id: string; benefit_id: string }>;
      };
      for (const r of res.rows) {
        verifyByKey.set(rowKey(r.worker_id, r.employer_id, r.benefit_id, { y: Number(r.year), m: Number(r.month) }), true);
      }
    }
    for (const span of loadedSpans) {
      for (const ym of span.months) {
        if (!verifyByKey.has(rowKey(span.workerId, span.employerId, span.benefitId, ym))) {
          verifyFailures++;
          if (verifySamples.length < 25) verifySamples.push({ nid: span.nid, ym: ymKey(ym) });
        }
      }
    }
  }

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  if (verifySamples.length > 0) report.verifyFailureSamples = verifySamples;

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

  await pgPool.end();
  if (verifyFailures > 0) process.exit(1);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  // HIPAA: never echo raw driver/storage errors (they can embed row values).
  // S1_MIGRATION_DEBUG=1 restores full errors for local debugging.
  if (process.env.S1_MIGRATION_DEBUG === "1") console.error(err);
  else if (err instanceof Error) console.error(`FATAL ${err.constructor.name}: ${String(err.message).split("\n")[0]}`);
  else console.error("FATAL: unknown_error");
  process.exit(1);
});
