/**
 * Month-parity harness — the benefit-history cutover gate (fund ruling
 * 2026-08-05: T17 imports history directly; correctness is judged by a
 * month-parity validation run, not by re-deriving history).
 *
 * READ-ONLY against S2 app tables and staged S1 data: benefit resolution
 * runs in dry mode (no id_map adoption writes); the only write is the
 * run-report row appended to s1_staging.runs (loader convention) plus the
 * idempotent CREATE-IF-NOT-EXISTS staging bootstrap.
 *
 * For the flag-selected comparison month it compares:
 *   S2 view:  trust_wmb rows (worker, employer, benefit) for that month —
 *             what S2 believes about who held which benefit.
 *   S1 view:  staged sirius_trust_worker_benefit coverage SPANS whose
 *             inclusive month range covers that month, resolved through the
 *             exact T17 rules (id_map crosswalk, dependents via relations →
 *             worker_2, employer fallback via the linked election,
 *             inactive-no-end end-dating from node.changed).
 *
 * EVIDENCE SOURCES are pluggable: the S1 view is produced by an
 * EvidenceSource, and the harness compares S2 against EVERY registered
 * source independently. When the staged worker-month tags land (T29), add a
 * second source to EVIDENCE_SOURCES and the same comparison/report/gate
 * machinery applies — plus cross-source disagreement becomes visible as the
 * two sources' reports diverging.
 *
 * Comparison classification (per worker, then per tuple):
 *   matched            — identical (worker, employer, benefit) both sides
 *   employer_mismatch  — same worker+benefit, different employer (pairs)
 *   wrong_benefit      — worker covered both sides but by different
 *                        benefits (pairs: one expected + one actual tuple)
 *   missing_in_s2      — S1 expects coverage, S2 has no row
 *   extra_in_s2        — S2 has a row no S1 span explains
 * disagreementPct = disagreeing tuple-sides / total tuple-sides, where each
 * pair class counts both of its sides as disagreeing.
 *
 * Report is AGGREGATE-ONLY (HIPAA): per-benefit and overall counts, rates,
 * reason codes; samples are S1 nids (or opaque S2 row ids for extras) —
 * never names.
 *
 * S1-side rows that cannot be resolved (unmapped benefit/worker/relation,
 * malformed dates, …) are counted per reject-style reason and EXCLUDED from
 * the comparison; every reason present must be explicitly allowed via
 * --allow-unresolved or the run fails — exactly the loaders' fail-loud
 * reject policy.
 *
 * Gate (fail-loud, exit 1 on breach):
 *   - disagreementPct > --max-disagreement-pct (REQUIRED, no default — the
 *     operator states the threshold explicitly every run; the production
 *     value needs fund sign-off, Laura/Sam own the N6/parity test design)
 *   - any unresolved reason not in --allow-unresolved
 *
 * Volume: staged spans stream through keyset paging with per-page batched
 * id_map lookups (prod: ~609K spans); only spans covering the target month
 * are resolved. Memory holds one month's coverage tuples (bounded by that
 * month's membership), never the full history.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/verify-month-parity.ts \
 *     --month YYYY-MM --max-disagreement-pct N \
 *     [--open-end-through YYYY-MM] [--allow-unresolved r1,r2]
 *
 * --open-end-through mirrors the T17 loader flag EXACTLY: open spans (no
 * end date) are treated as ending at that horizon. When the flag is absent,
 * every open span is unresolved (`open_end_through_required`) — T17 refused
 * to load such spans without an operator-named horizon, so the harness
 * refuses to guess about them too; an open span STARTING after the horizon
 * is unresolved as `open_span_after_through`. Pass the same horizon the
 * loader ran with or the gate would judge coverage T17 deliberately never
 * loaded.
 */
import { writeFileSync } from "node:fs";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings } from "./lib/idmap";
import { RejectLog, pagedStaged, stagedCountOf, chunk, strOf, targetNidOf, toYmd, epochToYmd, yesNo } from "./lib/loader-utils";
import {
  resolveBenefitNidMap,
  ymOfYmd,
  ymKey,
  parseYm,
  compareYm,
  monthsBetweenInclusive,
  MAX_SPAN_MONTHS,
  type Ym,
} from "./lib/resolvers";
import { numFlag, listFlag, flagValue } from "./lib/parity";

const HARNESS = "verify-month-parity";
const BUNDLE = "sirius_trust_worker_benefit";

const MONTH: Ym = (() => {
  const raw = flagValue("--month");
  if (!raw) throw new Error("--month YYYY-MM is required (the comparison month)");
  const ym = parseYm(raw);
  if (!ym) throw new Error(`--month must be YYYY-MM, got "${raw}"`);
  return ym;
})();
const MAX_DISAGREEMENT_PCT: number = (() => {
  const n = numFlag("--max-disagreement-pct");
  if (n == null) {
    throw new Error(
      "--max-disagreement-pct is required (0–100; no default on purpose — the parity threshold is an explicit operator decision pending fund sign-off)",
    );
  }
  if (n > 100) throw new Error(`--max-disagreement-pct must be 0–100, got ${n}`);
  return n;
})();
const OPEN_END_THROUGH: Ym | null = (() => {
  const raw = flagValue("--open-end-through");
  if (raw == null) return null;
  const ym = parseYm(raw);
  if (!ym) throw new Error(`--open-end-through must be YYYY-MM, got "${raw}"`);
  return ym;
})();
const ALLOWED_UNRESOLVED: string[] = listFlag("--allow-unresolved");

// ---------------------------------------------------------------------------
// Evidence-source abstraction (second sources plug in here — T29 tags)
// ---------------------------------------------------------------------------

interface EvidenceTuple {
  workerId: string;
  employerId: string;
  benefitId: string;
  /** S1 provenance key for aggregate-safe samples. */
  s1Nid: number;
}

interface EvidenceResult {
  /** Deduped expected coverage for the month, keyed worker|employer|benefit. */
  tuples: Map<string, EvidenceTuple>;
  /** Rows this source could not resolve — reject-style, gate on them. */
  unresolved: RejectLog;
  counters: Record<string, unknown>;
}

interface EvidenceSource {
  name: string;
  collect(month: Ym): Promise<EvidenceResult>;
}

const tupleKey = (w: string, e: string, b: string) => `${w}|${e}|${b}`;

/**
 * Evidence source 1: staged T17 coverage spans, resolved with the loader's
 * own rules. Spans are date-screened BEFORE any id_map work so only spans
 * covering the target month pay resolution cost.
 */
const stagedSpansSource: EvidenceSource = {
  name: "staged-benefit-spans",
  async collect(month) {
    const unresolved = new RejectLog();
    const tuples = new Map<string, EvidenceTuple>();
    let spansSeen = 0;
    let spansNotCovering = 0;
    let spansCovering = 0;
    let openSpans = 0;
    let inactiveEndDated = 0;
    let dependentSpans = 0;
    let employerFromElection = 0;
    let duplicateTuples = 0;

    const benefitRes = await resolveBenefitNidMap(HARNESS, /* dryRun (read-only!) */ true);

    for await (const staged of pagedStaged(BUNDLE)) {
      // ---- date screen (field-local; no lookups) ----
      interface Screened {
        nid: number;
        fields: Record<string, unknown>;
        inactiveEnded: boolean;
      }
      const covering: Screened[] = [];
      for (const s of staged) {
        spansSeen++;
        const f = s.fields;
        const startRaw = strOf(f, "field_sirius_date_start");
        if (!startRaw) {
          unresolved.add("start_missing", { nid: s.nid }, s.nid);
          continue;
        }
        const startYmd = toYmd(startRaw);
        if (!startYmd) {
          unresolved.add("bad_start_date", { nid: s.nid }, s.nid);
          continue;
        }
        const endRaw = strOf(f, "field_sirius_date_end");
        let endYmd: string | null = null;
        if (endRaw) {
          endYmd = toYmd(endRaw);
          if (!endYmd) {
            unresolved.add("bad_end_date", { nid: s.nid }, s.nid);
            continue;
          }
        }
        let inactiveEnded = false;
        const active = yesNo(strOf(f, "field_sirius_active"));
        if (active === false && !endYmd) {
          if (s.changed == null) {
            unresolved.add("inactive_no_end", { nid: s.nid }, s.nid);
            continue;
          }
          const changedYmd = epochToYmd(s.changed);
          if (!changedYmd) {
            unresolved.add("bad_changed_epoch", { nid: s.nid, changed: s.changed }, s.nid);
            continue;
          }
          endYmd = changedYmd;
          inactiveEnded = true;
        }
        const startYm = ymOfYmd(startYmd);
        let endYm: Ym | null = endYmd ? ymOfYmd(endYmd) : null;
        if (endYm && compareYm(endYm, startYm) < 0) {
          unresolved.add("end_before_start", { nid: s.nid }, s.nid);
          continue;
        }
        // open spans: EXACT T17 semantics — no horizon means the loader never
        // loaded them, so the harness refuses to guess about them either
        if (!endYm) {
          openSpans++;
          if (!OPEN_END_THROUGH) {
            unresolved.add("open_end_through_required", { nid: s.nid }, s.nid);
            continue;
          }
          if (compareYm(OPEN_END_THROUGH, startYm) < 0) {
            unresolved.add("open_span_after_through", { nid: s.nid, startYm: ymKey(startYm) }, s.nid);
            continue;
          }
          endYm = OPEN_END_THROUGH;
        }
        // mirror the loader's bad-date tripwire: absurd spans were never loaded
        try {
          if (monthsBetweenInclusive(startYm, endYm).length > MAX_SPAN_MONTHS) throw new Error("too long");
        } catch {
          unresolved.add("span_too_long", { nid: s.nid }, s.nid);
          continue;
        }
        if (compareYm(startYm, month) > 0 || compareYm(month, endYm) > 0) {
          spansNotCovering++;
          continue;
        }
        if (inactiveEnded) inactiveEndDated++;
        covering.push({ nid: s.nid, fields: f, inactiveEnded });
      }
      spansCovering += covering.length;
      if (covering.length === 0) continue;

      // ---- per-page bulk id_map lookups (T17 pattern) ----
      const workerNids: number[] = [];
      const employerNids: number[] = [];
      const relationNids: number[] = [];
      const electionNids: number[] = [];
      for (const s of covering) {
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

      const relationRow = new Map<string, { worker1: string; worker2: string }>();
      const relIds = [...new Set([...relationMap.values()].map((v) => v.s2Id))];
      for (const ids of chunk(relIds, 500)) {
        const res = (await db.execute(sql`
          SELECT id, worker_1, worker_2 FROM worker_relations
           WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        `)) as unknown as { rows: Array<{ id: string; worker_1: string; worker_2: string }> };
        for (const r of res.rows) relationRow.set(r.id, { worker1: r.worker_1, worker2: r.worker_2 });
      }
      const electionEmployer = new Map<string, string>();
      const electionIds = [...new Set([...electionMap.values()].map((v) => v.s2Id))];
      for (const ids of chunk(electionIds, 500)) {
        const res = (await db.execute(sql`
          SELECT id, employer_id FROM worker_trust_elections
           WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        `)) as unknown as { rows: Array<{ id: string; employer_id: string }> };
        for (const r of res.rows) electionEmployer.set(r.id, r.employer_id);
      }

      // ---- resolve pass (T17 targeting rules, read-only) ----
      for (const s of covering) {
        const { nid, fields: f } = s;
        const benefitNid = targetNidOf(f, "field_sirius_trust_benefit");
        if (benefitNid == null) {
          unresolved.add("benefit_ref_missing", { nid }, nid);
          continue;
        }
        const benefitId = benefitRes.map.get(benefitNid);
        if (!benefitId) {
          unresolved.add("benefit_unmapped", { nid, benefitNid }, nid);
          continue;
        }
        const subNid = targetNidOf(f, "field_sirius_trust_subscriber");
        const wNid = targetNidOf(f, "field_sirius_worker");
        const subscriberWorkerId = subNid != null ? workerMap.get(subNid)?.s2Id ?? null : null;
        const relNid = targetNidOf(f, "field_sirius_contact_relation");
        let workerId: string | null = null;
        if (relNid != null) {
          const relId = relationMap.get(relNid)?.s2Id;
          if (!relId) {
            unresolved.add("relation_unmapped", { nid, relationNid: relNid }, nid);
            continue;
          }
          const rel = relationRow.get(relId);
          if (!rel) {
            unresolved.add("relation_map_broken", { nid, relationNid: relNid }, nid);
            continue;
          }
          if (subscriberWorkerId && rel.worker1 !== subscriberWorkerId) {
            unresolved.add("relation_subscriber_mismatch", { nid, relationNid: relNid }, nid);
            continue;
          }
          workerId = rel.worker2;
          dependentSpans++;
        } else {
          const ownerNid = subNid ?? wNid;
          if (ownerNid == null) {
            unresolved.add("worker_ref_missing", { nid }, nid);
            continue;
          }
          if (subNid != null && wNid != null && subNid !== wNid) {
            unresolved.add("subscriber_worker_mismatch", { nid, subNid, wNid }, nid);
            continue;
          }
          workerId = workerMap.get(ownerNid)?.s2Id ?? null;
          if (!workerId) {
            unresolved.add("worker_unmapped", { nid, workerNid: ownerNid }, nid);
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
            employerId = electionEmployer.get(elId) ?? null;
            if (employerId) employerFromElection++;
          }
        }
        if (!employerId) {
          unresolved.add("employer_unresolved", { nid }, nid);
          continue;
        }
        const key = tupleKey(workerId, employerId, benefitId);
        if (tuples.has(key)) duplicateTuples++; // overlapping spans legally share months
        else tuples.set(key, { workerId, employerId, benefitId, s1Nid: nid });
      }
    }

    return {
      tuples,
      unresolved,
      counters: {
        stagedSpans: spansSeen,
        spansCoveringMonth: spansCovering,
        spansNotCoveringMonth: spansNotCovering,
        openSpans,
        inactiveEndDated,
        dependentSpans,
        employerFromElection,
        overlappingSpanTuples: duplicateTuples,
        benefitResolution: {
          stagedBenefits: benefitRes.stagedBenefits,
          viaIdMap: benefitRes.viaIdMap,
          viaSiriusId: benefitRes.viaSiriusId,
          viaName: benefitRes.viaName,
          ambiguousNames: benefitRes.ambiguousNames,
          unresolved: benefitRes.unresolved.length,
        },
      },
    };
  },
};

/** Registered evidence sources. T29 worker-month tags plug in as a second
 * entry; the harness then reports each source's parity independently. */
const EVIDENCE_SOURCES: EvidenceSource[] = [stagedSpansSource];

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

interface ActualRow {
  id: string;
  workerId: string;
  employerId: string;
  benefitId: string;
}

const SAMPLE_CAP = 25;

function compare(expected: Map<string, EvidenceTuple>, actual: ActualRow[]) {
  const expectedByWorker = new Map<string, EvidenceTuple[]>();
  for (const t of expected.values()) {
    (expectedByWorker.get(t.workerId) ?? expectedByWorker.set(t.workerId, []).get(t.workerId)!).push(t);
  }
  const actualByWorker = new Map<string, ActualRow[]>();
  const actualKeys = new Map<string, ActualRow>();
  let duplicateActual = 0;
  for (const r of actual) {
    const key = tupleKey(r.workerId, r.employerId, r.benefitId);
    if (actualKeys.has(key)) {
      duplicateActual++; // unique constraint makes this impossible; belt & braces
      continue;
    }
    actualKeys.set(key, r);
    (actualByWorker.get(r.workerId) ?? actualByWorker.set(r.workerId, []).get(r.workerId)!).push(r);
  }

  let matched = 0;
  let missingInS2 = 0;
  let extraInS2 = 0;
  let wrongBenefitPairs = 0;
  let employerMismatchPairs = 0;
  let workersOnlyInS1 = 0;
  let workersOnlyInS2 = 0;
  const missingSamples: Array<Record<string, unknown>> = [];
  const extraSamples: Array<Record<string, unknown>> = [];
  const wrongBenefitSamples: Array<Record<string, unknown>> = [];
  const employerMismatchSamples: Array<Record<string, unknown>> = [];

  const perBenefit = new Map<string, { expected: number; actual: number; matched: number }>();
  const bump = (benefitId: string, k: "expected" | "actual" | "matched") => {
    let b = perBenefit.get(benefitId);
    if (!b) {
      b = { expected: 0, actual: 0, matched: 0 };
      perBenefit.set(benefitId, b);
    }
    b[k]++;
  };
  for (const t of expected.values()) bump(t.benefitId, "expected");
  for (const r of actualKeys.values()) bump(r.benefitId, "actual");

  const workers = new Set([...expectedByWorker.keys(), ...actualByWorker.keys()]);
  for (const w of workers) {
    const exp = expectedByWorker.get(w) ?? [];
    const act = actualByWorker.get(w) ?? [];
    if (exp.length === 0) workersOnlyInS2++;
    if (act.length === 0) workersOnlyInS1++;

    const actByKey = new Map(act.map((r) => [tupleKey(r.workerId, r.employerId, r.benefitId), r]));
    const expRem: EvidenceTuple[] = [];
    for (const t of exp) {
      const k = tupleKey(t.workerId, t.employerId, t.benefitId);
      if (actByKey.has(k)) {
        matched++;
        bump(t.benefitId, "matched");
        actByKey.delete(k);
      } else {
        expRem.push(t);
      }
    }
    let actRem = [...actByKey.values()];

    // same benefit, different employer → employer_mismatch pair
    const expRem2: EvidenceTuple[] = [];
    for (const t of expRem) {
      const i = actRem.findIndex((r) => r.benefitId === t.benefitId);
      if (i >= 0) {
        employerMismatchPairs++;
        if (employerMismatchSamples.length < SAMPLE_CAP) {
          employerMismatchSamples.push({ s1Nid: t.s1Nid, wmbId: actRem[i].id });
        }
        actRem.splice(i, 1);
      } else {
        expRem2.push(t);
      }
    }
    // covered both sides but by different benefits → wrong_benefit pairs
    const pairs = Math.min(expRem2.length, actRem.length);
    for (let i = 0; i < pairs; i++) {
      wrongBenefitPairs++;
      if (wrongBenefitSamples.length < SAMPLE_CAP) {
        wrongBenefitSamples.push({ s1Nid: expRem2[i].s1Nid, wmbId: actRem[i].id });
      }
    }
    for (const t of expRem2.slice(pairs)) {
      missingInS2++;
      if (missingSamples.length < SAMPLE_CAP) missingSamples.push({ s1Nid: t.s1Nid });
    }
    for (const r of actRem.slice(pairs)) {
      extraInS2++;
      if (extraSamples.length < SAMPLE_CAP) extraSamples.push({ wmbId: r.id });
    }
  }

  const disagreeing = missingInS2 + extraInS2 + 2 * (wrongBenefitPairs + employerMismatchPairs);
  const total = matched + disagreeing;
  const disagreementPct = total === 0 ? 0 : Math.round((disagreeing / total) * 10000) / 100;

  return {
    expectedTuples: expected.size,
    actualRows: actualKeys.size,
    duplicateActual,
    matched,
    missingInS2,
    extraInS2,
    wrongBenefitPairs,
    employerMismatchPairs,
    workersOnlyInS1,
    workersOnlyInS2,
    disagreeing,
    comparedTupleSides: total,
    disagreementPct,
    perBenefit,
    samples: {
      missingInS2: missingSamples,
      extraInS2: extraSamples,
      wrongBenefit: wrongBenefitSamples,
      employerMismatch: employerMismatchSamples,
    },
  };
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = {
    harness: HARNESS,
    month: ymKey(MONTH),
    maxDisagreementPct: MAX_DISAGREEMENT_PCT,
    openEndThrough: OPEN_END_THROUGH ? ymKey(OPEN_END_THROUGH) : null,
    allowedUnresolved: ALLOWED_UNRESOLVED,
  };
  report.stagedSpans = await stagedCountOf(BUNDLE);

  // ---- S2 view of the month (one month's membership — bounded) ----
  const actual: ActualRow[] = (
    (await db.execute(sql`
      SELECT id, worker_id, employer_id, benefit_id FROM trust_wmb
       WHERE year = ${MONTH.y} AND month = ${MONTH.m}
    `)) as unknown as { rows: Array<{ id: string; worker_id: string; employer_id: string; benefit_id: string }> }
  ).rows.map((r) => ({ id: r.id, workerId: r.worker_id, employerId: r.employer_id, benefitId: r.benefit_id }));
  report.s2MonthRows = actual.length;

  // benefit labels for the per-benefit table (fund config, not PII)
  const benefitLabels = new Map<string, { name: string | null; siriusId: string | null }>(
    (
      (await db.execute(sql`SELECT id, name, sirius_id FROM trust_benefits`)) as unknown as {
        rows: Array<{ id: string; name: string | null; sirius_id: string | null }>;
      }
    ).rows.map((r) => [r.id, { name: r.name, siriusId: r.sirius_id }]),
  );

  const failures: string[] = [];
  const sources: Array<Record<string, unknown>> = [];

  for (const source of EVIDENCE_SOURCES) {
    const evidence = await source.collect(MONTH);
    const cmp = compare(evidence.tuples, actual);

    const perBenefit = [...cmp.perBenefit.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([benefitId, c]) => ({
        benefitId,
        siriusId: benefitLabels.get(benefitId)?.siriusId ?? null,
        name: benefitLabels.get(benefitId)?.name ?? null,
        expected: c.expected,
        actual: c.actual,
        matched: c.matched,
        expectedUnmatched: c.expected - c.matched,
        actualUnmatched: c.actual - c.matched,
      }));

    const { perBenefit: _pb, samples, ...overall } = cmp;
    sources.push({
      source: source.name,
      counters: evidence.counters,
      unresolved: evidence.unresolved.counts,
      unresolvedSamples: evidence.unresolved.samples,
      overall,
      perBenefit,
      mismatchSamples: samples,
    });

    if (cmp.disagreementPct > MAX_DISAGREEMENT_PCT) {
      failures.push(
        `${source.name}: disagreementPct ${cmp.disagreementPct} > threshold ${MAX_DISAGREEMENT_PCT} ` +
          `(matched=${cmp.matched} missing=${cmp.missingInS2} extra=${cmp.extraInS2} ` +
          `wrongBenefit=${cmp.wrongBenefitPairs} employerMismatch=${cmp.employerMismatchPairs})`,
      );
    }
    for (const d of evidence.unresolved.disallowedReasons(ALLOWED_UNRESOLVED)) {
      failures.push(`${source.name}: unresolved reason not allowed: ${d.reason}=${d.count}`);
    }
  }

  report.sources = sources;
  report.failures = failures;
  report.result = failures.length === 0 ? "PASS" : "FAIL";

  console.log(JSON.stringify(report, null, 2));
  // Machine-readable handoff for the sync orchestrator (§11).
  if (process.env.S1_RESULT_JSON_PATH) writeFileSync(process.env.S1_RESULT_JSON_PATH, JSON.stringify(report));
  await recordRun(
    startedAt,
    {
      harness: HARNESS,
      month: ymKey(MONTH),
      maxDisagreementPct: MAX_DISAGREEMENT_PCT,
      openEndThrough: OPEN_END_THROUGH ? ymKey(OPEN_END_THROUGH) : null,
      allowedUnresolved: ALLOWED_UNRESOLVED,
    },
    report,
  );
  await pgPool.end();
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} parity failure(s) — see report.failures`);
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
