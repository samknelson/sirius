/**
 * T16 loader — S1 trust worker elections → worker_trust_elections.
 * Load-order step: after T15 (relationships) and the policies adopt-mapper.
 *
 * Rules (03-transformations T16, 06-strategy-revision):
 *   - Source bundle `sirius_trust_worker_election`.
 *   - worker ← field_sirius_worker, employer ← field_grievance_shop (S1
 *     naming trap: "shop" = employer).
 *   - benefit_ids = ORDERED S2 trust_benefit ids from the multi-value
 *     field_sirius_trust_benefits (delta order preserved). Benefits resolve
 *     via id_map / trust_benefits.sirius_id / unique name (resolvers.ts);
 *     any unresolved benefit on a row is a fatal reject — never partial.
 *   - relationship_ids from field_sirius_contact_relations via id_map
 *     `relation` (T15). Unmapped relation = fatal reject (silently dropping
 *     a dependent from an election would be data loss).
 *   - enrollment_type: field_sirius_trust_election_type term NAME → coded
 *     S2 enum. S1 elections WITHOUT a type (majority in prod) load with
 *     enrollment_type NULL — reported, pending any fund ruling. Unmapped
 *     term names are fatal rejects; `--type-map tid=code,...` overrides for
 *     production term names.
 *   - Policy is NOT stored (derived at read time per employer history);
 *     the S1 policy nid is stashed verbatim in data.s1PolicyNid.
 *   - field_sirius_active reconcile (T14): active=No with no end date
 *     end-dates the election from node.changed (same convention as T15).
 *   - Dates are D7 wall-time datetimes → date-only cast (toYmd, no tz math).
 *
 * Writes go through storage.workerTrustElections.createForMigration — verbatim
 * history: FK + end>start contracts enforced, but NO dual-coverage assert
 * and NO auto-end of prior open elections (S1 is the record of its own era).
 *
 * Idempotency: id_map entity `election`. Mapped rows are adopted and
 * re-verified; a mapping pointing at a deleted S2 row fails loud.
 *
 * Usage: npx tsx scripts/s1-migration/load-elections.ts \
 *          [--dry-run] [--allow-rejects r1,r2] [--type-map tid=code,...]
 * Output is aggregate counts only (no PII).
 */
import { storage } from "../../server/storage/database";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { ENROLLMENT_TYPES, type EnrollmentType } from "../../shared/schema/trust/elections-schema";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import {
  RejectLog,
  loadStaged,
  strOf,
  tidOf,
  targetNidOf,
  toYmd,
  epochToYmd,
  yesNo,
} from "./lib/loader-utils";
import { targetNidsOf, resolveBenefitNidMap } from "./lib/resolvers";

const LOADER = "t16-elections";
const BUNDLE = "sirius_trust_worker_election";
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

/** --type-map 1521=first_time,1522=open_enrollment — production term-name
 * overrides by tid. Codes are validated against the S2 enum at parse time. */
const TYPE_OVERRIDES: Map<number, EnrollmentType> = (() => {
  const i = process.argv.indexOf("--type-map");
  const out = new Map<number, EnrollmentType>();
  if (i < 0 || !process.argv[i + 1]) return out;
  for (const pair of process.argv[i + 1].split(",")) {
    const [tidRaw, code] = pair.split("=").map((s) => s.trim());
    const tid = Number(tidRaw);
    if (!Number.isInteger(tid) || !(ENROLLMENT_TYPES as readonly string[]).includes(code)) {
      throw new Error(`--type-map entry "${pair}" invalid (want tid=<${ENROLLMENT_TYPES.join("|")}>)`);
    }
    out.set(tid, code as EnrollmentType);
  }
  return out;
})();

/** Canonical S1 election-type term names, normalized (lowercase, alnum only).
 * Synthetic dev names: FirstTime / OpenEnrollment / LifeEvent. Production
 * names that differ must come in via --type-map (unmapped = fatal reject). */
const CANONICAL_TYPES: Record<string, EnrollmentType> = {
  firsttime: "first_time",
  firsttimeenrollment: "first_time",
  initialenrollment: "first_time",
  openenrollment: "open_enrollment",
  lifeevent: "life_event",
  qualifyinglifeevent: "life_event",
  cobra: "cobra",
};

const normalizeTypeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** All reasons are row-skipping (fatal for that election). */
const FATAL_REASONS = [
  "worker_ref_missing",
  "worker_unmapped",
  "employer_ref_missing",
  "employer_unmapped",
  "start_missing",
  "bad_start_date",
  "bad_end_date",
  "end_not_after_start",
  "inactive_no_end",
  "benefit_unmapped",
  "relation_unmapped",
  "election_type_unmapped",
  "election_create_failed",
  "mapped_row_missing",
] as const;

function classifyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/worker/i.test(msg)) return "worker_fk";
  if (/employer/i.test(msg)) return "employer_fk";
  if (/start|end|date/i.test(msg)) return "date_contract";
  return "error";
}

interface ResolvedElection {
  nid: number;
  workerId: string;
  employerId: string;
  startYmd: string;
  endYmd: string | null;
  benefitIds: string[];
  relationshipIds: string[];
  enrollmentType: EnrollmentType | null;
  data: Record<string, unknown>;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

  const staged = await loadStaged(BUNDLE);
  report.staged = staged.length;

  // ---- benefit nid → trust_benefits.id (shared T16/T17 resolution) ----
  const benefitRes = await resolveBenefitNidMap(LOADER, DRY_RUN);
  report.benefitResolution = {
    stagedBenefits: benefitRes.stagedBenefits,
    viaIdMap: benefitRes.viaIdMap,
    viaSiriusId: benefitRes.viaSiriusId,
    viaName: benefitRes.viaName,
    ambiguousNames: benefitRes.ambiguousNames,
    unresolved: benefitRes.unresolved.length,
  };

  // ---- election-type terms (staged vocabulary; coded remap, NOT options) ----
  const termRows = (
    (await db.execute(sql`
      SELECT tid, name FROM s1_staging.terms WHERE vocabulary = 'sirius_election_type'
    `)) as unknown as { rows: Array<{ tid: string | number; name: string }> }
  ).rows;
  const termNameByTid = new Map<number, string>(termRows.map((r) => [Number(r.tid), r.name]));
  report.electionTypeTerms = termRows.length;

  // ---- bulk id_map lookups ----
  const workerNids: number[] = [];
  const employerNids: number[] = [];
  const relationNids: number[] = [];
  for (const s of staged) {
    const w = targetNidOf(s.fields, "field_sirius_worker");
    if (w != null) workerNids.push(w);
    const e = targetNidOf(s.fields, "field_grievance_shop");
    if (e != null) employerNids.push(e);
    relationNids.push(...targetNidsOf(s.fields, "field_sirius_contact_relations"));
  }
  const [workerMap, employerMap, relationMap, electionMap] = await Promise.all([
    getMappings("worker", workerNids),
    getMappings("employer", employerNids),
    getMappings("relation", relationNids),
    getMappings("election", staged.map((s) => s.nid)),
  ]);

  // ---- resolve pass (reject-complete before any write) ----
  const resolved: ResolvedElection[] = [];
  let typed = 0;
  let untyped = 0;
  let endDatedFromChanged = 0;
  const perType: Record<string, number> = {};

  for (const s of staged) {
    const nid = s.nid;
    const f = s.fields;

    const workerNid = targetNidOf(f, "field_sirius_worker");
    if (workerNid == null) {
      rejects.add("worker_ref_missing", { nid }, nid);
      continue;
    }
    const workerId = workerMap.get(workerNid)?.s2Id;
    if (!workerId) {
      rejects.add("worker_unmapped", { nid, workerNid }, nid);
      continue;
    }

    const employerNid = targetNidOf(f, "field_grievance_shop");
    if (employerNid == null) {
      rejects.add("employer_ref_missing", { nid }, nid);
      continue;
    }
    const employerId = employerMap.get(employerNid)?.s2Id;
    if (!employerId) {
      rejects.add("employer_unmapped", { nid, employerNid }, nid);
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

    // T14 active reconcile: inactive with no end date → end-date from changed
    const active = yesNo(strOf(f, "field_sirius_active"));
    let rowEndDatedFromChanged = false;
    if (active === false && !endYmd) {
      if (s.changed == null) {
        rejects.add("inactive_no_end", { nid }, nid);
        continue;
      }
      endYmd = epochToYmd(s.changed);
      rowEndDatedFromChanged = true;
    }

    if (endYmd && endYmd <= startYmd) {
      rejects.add("end_not_after_start", { nid, endDatedFromChanged: rowEndDatedFromChanged }, nid);
      continue;
    }

    const benefitNids = targetNidsOf(f, "field_sirius_trust_benefits");
    const benefitIds: string[] = [];
    let benefitFail = false;
    for (const bNid of benefitNids) {
      const bid = benefitRes.map.get(bNid);
      if (!bid) {
        rejects.add("benefit_unmapped", { nid, benefitNid: bNid }, nid);
        benefitFail = true;
        break;
      }
      benefitIds.push(bid);
    }
    if (benefitFail) continue;

    const relNids = targetNidsOf(f, "field_sirius_contact_relations");
    const relationshipIds: string[] = [];
    let relFail = false;
    for (const rNid of relNids) {
      const rid = relationMap.get(rNid)?.s2Id;
      if (!rid) {
        rejects.add("relation_unmapped", { nid, relationNid: rNid }, nid);
        relFail = true;
        break;
      }
      relationshipIds.push(rid);
    }
    if (relFail) continue;

    const typeTid = tidOf(f, "field_sirius_trust_election_type");
    let enrollmentType: EnrollmentType | null = null;
    if (typeTid == null) {
      untyped++;
    } else {
      const override = TYPE_OVERRIDES.get(typeTid);
      if (override) {
        enrollmentType = override;
      } else {
        const name = termNameByTid.get(typeTid);
        const code = name != null ? CANONICAL_TYPES[normalizeTypeName(name)] : undefined;
        if (!code) {
          rejects.add("election_type_unmapped", { nid, tid: typeTid }, nid);
          continue;
        }
        enrollmentType = code;
      }
      typed++;
      perType[enrollmentType] = (perType[enrollmentType] ?? 0) + 1;
    }
    if (rowEndDatedFromChanged) endDatedFromChanged++;

    const policyNid = targetNidOf(f, "field_sirius_trust_policy");
    const data: Record<string, unknown> = { source: "s1-migration", s1Nid: nid };
    if (policyNid != null) data.s1PolicyNid = policyNid;
    if (active != null) data.s1Active = active;
    if (rowEndDatedFromChanged) data.endDatedFromChanged = true;

    resolved.push({ nid, workerId, employerId, startYmd, endYmd, benefitIds, relationshipIds, enrollmentType, data });
  }

  report.resolved = resolved.length;
  report.typedElections = typed;
  report.untypedElections = untyped;
  report.perEnrollmentType = perType;
  report.endDatedFromChanged = endDatedFromChanged;

  // ---- write pass ----
  // Crash-repair provenance: an election created before its putMapping landed
  // is re-found by its stashed s1Nid and re-adopted into id_map, not duplicated.
  const provenanceRes = await db.execute(sql`
    SELECT id, data->>'s1Nid' AS nid FROM worker_trust_elections
    WHERE data->>'source' = 's1-migration' AND data->>'s1Nid' IS NOT NULL
  `);
  const provenanceByNid = new Map<number, string>();
  for (const p of (provenanceRes as unknown as { rows: Array<{ id: string; nid: string }> }).rows) {
    const n = Number(p.nid);
    if (Number.isFinite(n) && !provenanceByNid.has(n)) provenanceByNid.set(n, p.id);
  }

  let created = 0;
  let adopted = 0;
  let adoptedByProvenance = 0;
  const expectations: Array<{ nid: number; s2Id: string; want: ResolvedElection }> = [];

  for (const r of resolved) {
    const mapped = electionMap.get(r.nid)?.s2Id;
    if (mapped) {
      const existing = await storage.workerTrustElections.getById(mapped);
      if (!existing) {
        rejects.add("mapped_row_missing", { nid: r.nid }, r.nid);
        continue;
      }
      adopted++;
      expectations.push({ nid: r.nid, s2Id: mapped, want: r });
      continue;
    }
    // crash-repair: row exists (provenance) but id_map lost the mapping
    const orphanId = provenanceByNid.get(r.nid);
    if (orphanId) {
      const winner = DRY_RUN ? orphanId : await putMapping("election", r.nid, orphanId, { stub: false, loader: LOADER });
      adopted++;
      adoptedByProvenance++;
      expectations.push({ nid: r.nid, s2Id: winner, want: r });
      continue;
    }
    if (DRY_RUN) {
      created++;
      continue;
    }
    try {
      const row = await withNotificationsSuppressed(() =>
        withChargePluginsSuppressed(() =>
          storage.workerTrustElections.createForMigration({
            workerId: r.workerId,
            employerId: r.employerId,
            startYmd: r.startYmd,
            endYmd: r.endYmd,
            benefitIds: r.benefitIds,
            relationshipIds: r.relationshipIds,
            enrollmentType: r.enrollmentType,
            data: r.data,
          }),
        ),
      );
      const winner = await putMapping("election", r.nid, row.id, { stub: false, loader: LOADER });
      created++;
      expectations.push({ nid: r.nid, s2Id: winner, want: r });
    } catch (e) {
      rejects.add("election_create_failed", { nid: r.nid, code: classifyError(e) }, r.nid);
    }
  }

  report.created = created;
  report.adopted = adopted;
  report.adoptedByProvenance = adoptedByProvenance;

  // ---- verify pass (exact field equality on every loaded row) ----
  let verifyFailures = 0;
  const verifySamples: Array<Record<string, unknown>> = [];
  for (const ex of expectations) {
    const row = await storage.workerTrustElections.getById(ex.s2Id);
    const w = ex.want;
    const mismatches: string[] = [];
    if (!row) {
      mismatches.push("row_missing");
    } else {
      if (row.workerId !== w.workerId) mismatches.push("workerId");
      if (row.employerId !== w.employerId) mismatches.push("employerId");
      if (row.startYmd !== w.startYmd) mismatches.push("startYmd");
      if ((row.endYmd ?? null) !== w.endYmd) mismatches.push("endYmd");
      if ((row.enrollmentType ?? null) !== w.enrollmentType) mismatches.push("enrollmentType");
      if (JSON.stringify(row.benefitIds ?? []) !== JSON.stringify(w.benefitIds)) mismatches.push("benefitIds");
      if (JSON.stringify(row.relationshipIds ?? []) !== JSON.stringify(w.relationshipIds))
        mismatches.push("relationshipIds");
    }
    if (mismatches.length > 0) {
      verifyFailures++;
      if (verifySamples.length < 25) verifySamples.push({ nid: ex.nid, fields: mismatches });
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
