/**
 * T16 loader — S1 trust worker elections → worker_trust_elections.
 * Load-order step: after T15 (relationships) and the policies adopt-mapper.
 *
 * CONVERTED SYNC LOADER (Task 294): during the ~1-month dual-run S1 stays the
 * system of record and this loader runs daily. Semantics per run:
 *   - unchanged staged content (consumed fingerprint match at this
 *     LOGIC_VERSION) → fast-path skip, no reads/writes for that row.
 *   - changed content on a mapped row → re-resolve and, when the S2 row
 *     drifted, S1-wins overwrite via updateForMigration (suppressed).
 *     Fingerprints advance only after the page verify pass.
 *   - new staged rows → createForMigration + mapping (fingerprint stamped at
 *     insert, mirroring the t-policies pilot).
 *   - staged row deleted in S1 → deletion sweep storage-deletes the S2
 *     election (suppressed) and drops the mapping.
 *   NOTE the fast path skips ALL storage reads, so out-of-band S2 deletion of
 *   an unchanged mapped row is not detected until the row changes in S1 or a
 *   `--force-reconcile` run re-verifies everything.
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
 * Writes go through storage.workerTrustElections.createForMigration /
 * updateForMigration / delete — verbatim history: FK + end>start contracts
 * enforced, but NO dual-coverage assert and NO auto-end of prior open
 * elections (S1 is the record of its own era). All writes stay inside
 * notification + charge-plugin suppression.
 *
 * Idempotency: id_map entity `election`. A mapping pointing at a deleted S2
 * row still fails loud (mapped_row_missing); crash-repair re-adopts rows by
 * their stashed data->>'s1Nid' provenance.
 *
 * Usage: npx tsx scripts/s1-migration/load-elections.ts \
 *          [--dry-run] [--allow-rejects r1,r2] [--type-map tid=code,...] \
 *          [--force-reconcile] [--allow-findings k1,k2]
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
import { ensureIdMap, getMappings, putMapping, advanceFingerprints } from "./lib/idmap";
import {
  RejectLog,
  pagedStaged,
  stagedCountOf,
  chunk,
  strOf,
  tidOf,
  targetNidOf,
  toYmd,
  epochToYmd,
  yesNo,
  throttleStorageOpLogs,
} from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import { targetNidsOf, resolveBenefitNidMap } from "./lib/resolvers";
import {
  buildLoaderResult,
  canonicalJson,
  classifyRow,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type SyncFinding,
} from "./lib/sync";

const LOADER = "t16-elections";
const BUNDLE = "sirius_trust_worker_election";
const DRY_RUN = process.argv.includes("--dry-run");
/** Loader logic version — BUMP whenever resolution logic (type map, date
 * conventions, data stash shape) changes so mapped rows re-reconcile on
 * their next run. */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
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
  "bad_changed_epoch",
  "benefit_unmapped",
  "relation_unmapped",
  "election_create_failed",
  "election_update_failed",
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
  contentHash: string | null;
  workerId: string;
  employerId: string;
  startYmd: string;
  endYmd: string | null;
  benefitIds: string[];
  relationshipIds: string[];
  enrollmentType: EnrollmentType | null;
  data: Record<string, unknown>;
}

interface CurrentRow {
  id: string;
  worker_id: string;
  employer_id: string;
  start_ymd: string;
  end_ymd: string | null;
  enrollment_type: string | null;
  benefit_ids: string[] | null;
  relationship_ids: string[] | null;
  data: unknown;
}

/** Exact S1-wins drift check: migration-owned fields plus the data stash
 * (canonical-compared — Postgres jsonb reorders keys; memory:
 * jsonb-adopt-compare-key-order). Array order is significant (delta order). */
function rowMatches(row: CurrentRow, w: ResolvedElection): boolean {
  const rowData = typeof row.data === "string" ? JSON.parse(row.data) : row.data ?? null;
  return (
    row.worker_id === w.workerId &&
    row.employer_id === w.employerId &&
    row.start_ymd === w.startYmd &&
    (row.end_ymd ?? null) === w.endYmd &&
    (row.enrollment_type ?? null) === w.enrollmentType &&
    JSON.stringify(row.benefit_ids ?? []) === JSON.stringify(w.benefitIds) &&
    JSON.stringify(row.relationship_ids ?? []) === JSON.stringify(w.relationshipIds) &&
    canonicalJson(rowData) === canonicalJson(w.data)
  );
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  throttleStorageOpLogs();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();
  const summary = emptySummary();

  report.staged = await stagedCountOf(BUNDLE);

  // heartbeat: aggregates only (counts/elapsed/rate — never row contents)
  const progress = makeProgressLogger(LOADER, report.staged as number);
  let progressDone = 0;
  progress.phase("pre-scan");

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
      SELECT tid, name FROM s1_staging.terms
      WHERE vocabulary IN ('sirius_election_type', 'sirius_trust_election_type')
    `)) as unknown as { rows: Array<{ tid: string | number; name: string }> }
  ).rows;
  const termNameByTid = new Map<number, string>(termRows.map((r) => [Number(r.tid), r.name]));
  report.electionTypeTerms = termRows.length;

  // ---- crash-repair provenance (single bounded query; ids only) ----
  // An election created before its putMapping landed is re-found by its
  // stashed s1Nid and re-adopted into id_map, not duplicated.
  const provenanceRes = await db.execute(sql`
    SELECT id, data->>'s1Nid' AS nid FROM worker_trust_elections
    WHERE data->>'source' = 's1-migration' AND data->>'s1Nid' IS NOT NULL
  `);
  const provenanceByNid = new Map<number, string>();
  for (const p of (provenanceRes as unknown as { rows: Array<{ id: string; nid: string }> }).rows) {
    const n = Number(p.nid);
    if (Number.isFinite(n) && !provenanceByNid.has(n)) provenanceByNid.set(n, p.id);
  }

  // ---- global counters (accumulated across pages) ----
  let resolvedCount = 0;
  let fastPathSkips = 0;
  let typed = 0;
  let untyped = 0;
  let typedButIrrelevant = 0; // S1 type tid present but maps to a coverage-tier term (single/family/waived), not an S2 enrollment event type — silently null
  let endDatedFromChanged = 0;
  const perType: Record<string, number> = {};
  let created = 0;
  let updated = 0;
  let reconciledDriftFree = 0;
  let adopted = 0;
  let adoptedByProvenance = 0;
  let verifyFailures = 0;
  const verifySamples: Array<Record<string, unknown>> = [];
  let pages = 0;

  // ---- keyset-paged pipeline: classify → resolve → reconcile → verify, one
  // page at a time. Staged rows, id_map lookups, current-row reads and
  // verification are all page-bounded — memory stays flat at production
  // volume (~243k elections). Fingerprints advance post-verify per page.
  for await (const staged of pagedStaged(BUNDLE)) {
    pages++;
    progress.phase(null);

    // ---- classification (consumed-fingerprint fast path, Task 292/294) ----
    const electionMap = await getMappings("election", staged.map((s) => s.nid));
    const toProcess: typeof staged = [];
    for (const s of staged) {
      const mapping = electionMap.get(s.nid);
      if (mapping && classifyRow(mapping, s.contentHash, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
        summary.unchanged++;
        fastPathSkips++;
        progressDone++;
        continue;
      }
      toProcess.push(s);
    }
    progress.update(progressDone);
    if (toProcess.length === 0) continue;

    // ---- per-page bulk id_map lookups (changed/new rows only) ----
    const workerNids: number[] = [];
    const employerNids: number[] = [];
    const relationNids: number[] = [];
    for (const s of toProcess) {
      const w = targetNidOf(s.fields, "field_sirius_worker");
      if (w != null) workerNids.push(w);
      const e = targetNidOf(s.fields, "field_grievance_shop");
      if (e != null) employerNids.push(e);
      relationNids.push(...targetNidsOf(s.fields, "field_sirius_contact_relations"));
    }
    const [workerMap, employerMap, relationMap] = await Promise.all([
      getMappings("worker", workerNids),
      getMappings("employer", employerNids),
      getMappings("relation", relationNids),
    ]);

    // ---- resolve pass (page-scoped; reject-complete before any page write) ----
    const resolved: ResolvedElection[] = [];

    for (const s of toProcess) {
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
      const changedYmd = epochToYmd(s.changed);
      if (!changedYmd) {
        rejects.add("bad_changed_epoch", { nid, changed: s.changed }, nid);
        continue;
      }
      endYmd = changedYmd;
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
          // S1's election-type vocab contains coverage tiers (single/family/waived),
          // not S2 enrollment event types. Only the TYPE is dropped — the election
          // itself must still load with enrollmentType null. (A previous `continue`
          // here skipped the whole election: 61,823 elections never reached id_map,
          // which broke t17's election→employer fallback for shopless spans.)
          // A --type-map override can still force-map specific tids when needed.
          typedButIrrelevant++;
        } else {
          enrollmentType = code;
        }
      }
      if (enrollmentType != null) {
        typed++;
        perType[enrollmentType] = (perType[enrollmentType] ?? 0) + 1;
      }
    }
    if (rowEndDatedFromChanged) endDatedFromChanged++;

    const policyNid = targetNidOf(f, "field_sirius_trust_policy");
    const data: Record<string, unknown> = { source: "s1-migration", s1Nid: nid };
    if (policyNid != null) data.s1PolicyNid = policyNid;
    if (active != null) data.s1Active = active;
    if (rowEndDatedFromChanged) data.endDatedFromChanged = true;

    resolved.push({ nid, contentHash: s.contentHash, workerId, employerId, startYmd, endYmd, benefitIds, relationshipIds, enrollmentType, data });
    }
    resolvedCount += resolved.length;
    // rejected rows are fully handled — count them toward progress now
    progressDone += toProcess.length - resolved.length;
    progress.update(progressDone);

    // ---- batched current-row read (mapped targets + provenance orphans) ----
    // One IN-query set per page fetches the full migration-owned field set so
    // the reconcile below is an in-memory compare (no per-row reads).
    const compareIds = new Set<string>();
    for (const r of resolved) {
      const mapped = electionMap.get(r.nid)?.s2Id;
      if (mapped) compareIds.add(mapped);
      else {
        const orphan = provenanceByNid.get(r.nid);
        if (orphan) compareIds.add(orphan);
      }
    }
    const currentById = new Map<string, CurrentRow>();
    for (const ids of chunk([...compareIds], 500)) {
      const res = (await db.execute(sql`
        SELECT id, worker_id, employer_id, start_ymd::text AS start_ymd, end_ymd::text AS end_ymd,
               enrollment_type, benefit_ids, relationship_ids, data
          FROM worker_trust_elections
         WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: CurrentRow[] };
      for (const row of res.rows) currentById.set(row.id, row);
    }

    // ---- write pass (page-scoped) ----
    const expectations: Array<{ nid: number; s2Id: string; want: ResolvedElection }> = [];
    /** fingerprint advances for pre-existing/orphan mappings — applied after
     * the page verify pass so a verify failure keeps the row re-processable. */
    const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];

    for (const r of resolved) {
      progress.update(++progressDone);
      const mapped = electionMap.get(r.nid)?.s2Id;
      // crash-repair: row exists (provenance) but id_map lost the mapping
      const orphanId = mapped ? undefined : provenanceByNid.get(r.nid);
      const targetId = mapped ?? orphanId;
      if (targetId) {
        const current = currentById.get(targetId);
        if (!current) {
          rejects.add("mapped_row_missing", { nid: r.nid }, r.nid);
          continue;
        }
        if (orphanId) {
          if (!DRY_RUN) {
            const winner = await putMapping("election", r.nid, orphanId, { stub: false, loader: LOADER });
            if (winner !== orphanId) console.error(`RACE: election nid ${r.nid} already mapped to ${winner}`);
          }
          adoptedByProvenance++;
        }
        adopted++;
        if (rowMatches(current, r)) {
          reconciledDriftFree++;
          summary.unchanged++;
        } else if (DRY_RUN) {
          updated++;
          summary.updated++;
          continue; // no write happened — verify would false-fail
        } else {
          try {
            await withNotificationsSuppressed(() =>
              withChargePluginsSuppressed(() =>
                storage.workerTrustElections.updateForMigration(targetId, {
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
            updated++;
            summary.updated++;
          } catch (e) {
            rejects.add("election_update_failed", { nid: r.nid, code: classifyError(e) }, r.nid);
            continue;
          }
        }
        expectations.push({ nid: r.nid, s2Id: targetId, want: r });
        if (!DRY_RUN) pendingAdvance.push({ s1Id: r.nid, fingerprint: r.contentHash });
        continue;
      }
      if (DRY_RUN) {
        created++;
        summary.created++;
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
        // Stamped at insert (t-policies pilot pattern): the row was just
        // written from exactly this staged content.
        const winner = await putMapping("election", r.nid, row.id, {
          stub: false,
          loader: LOADER,
          fingerprint: r.contentHash,
          logicVersion: LOGIC_VERSION,
        });
        created++;
        summary.created++;
        expectations.push({ nid: r.nid, s2Id: winner, want: r });
      } catch (e) {
        rejects.add("election_create_failed", { nid: r.nid, code: classifyError(e) }, r.nid);
      }
    }

    // ---- verify pass (page-scoped, batched; exact field equality) ----
    progress.phase("verify", expectations.length);
    interface VerifyRow {
      id: string;
      worker_id: string;
      employer_id: string;
      start_ymd: string;
      end_ymd: string | null;
      enrollment_type: string | null;
      benefit_ids: string[] | null;
      relationship_ids: string[] | null;
    }
    const verifyById = new Map<string, VerifyRow>();
    for (const batch of chunk(expectations, 500)) {
      progress.add(batch.length);
      const res = (await db.execute(sql`
        SELECT id, worker_id, employer_id, start_ymd::text AS start_ymd, end_ymd::text AS end_ymd,
               enrollment_type, benefit_ids, relationship_ids
          FROM worker_trust_elections
         WHERE id IN (${sql.join(batch.map((e) => sql`${e.s2Id}`), sql`, `)})
      `)) as unknown as { rows: VerifyRow[] };
      for (const row of res.rows) verifyById.set(row.id, row);
    }
    const verifyFailedNids = new Set<number>();
    for (const ex of expectations) {
      const row = verifyById.get(ex.s2Id);
      const w = ex.want;
      const mismatches: string[] = [];
      if (!row) {
        mismatches.push("row_missing");
      } else {
        if (row.worker_id !== w.workerId) mismatches.push("workerId");
        if (row.employer_id !== w.employerId) mismatches.push("employerId");
        if (row.start_ymd !== w.startYmd) mismatches.push("startYmd");
        if ((row.end_ymd ?? null) !== w.endYmd) mismatches.push("endYmd");
        if ((row.enrollment_type ?? null) !== w.enrollmentType) mismatches.push("enrollmentType");
        if (JSON.stringify(row.benefit_ids ?? []) !== JSON.stringify(w.benefitIds)) mismatches.push("benefitIds");
        if (JSON.stringify(row.relationship_ids ?? []) !== JSON.stringify(w.relationshipIds))
          mismatches.push("relationshipIds");
      }
      if (mismatches.length > 0) {
        verifyFailures++;
        verifyFailedNids.add(ex.nid);
        if (verifySamples.length < 25) verifySamples.push({ nid: ex.nid, fields: mismatches });
      }
    }

    // ---- advance consumed fingerprints (verify-passed rows only) ----
    if (!DRY_RUN) {
      const toAdvance = pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id));
      await advanceFingerprints("election", toAdvance, LOGIC_VERSION);
    }
  }
  progress.stop();

  // ---- deletion sweep: mapped elections whose staged source vanished are
  // deleted in S2 (S1 wins; suppressed side effects) and unmapped. Guarded
  // against an empty/truncated staging table — a sweep there would delete
  // EVERY migrated election. ----
  const findings: SyncFinding[] = [];
  if ((report.staged as number) > 0) {
    const sweep = await sweepDeletions({
      entity: "election",
      loaders: [LOADER],
      sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = ${BUNDLE}`,
      dryRun: DRY_RUN,
      policy: async (c) => ({
        action: "delete",
        apply: async () => {
          await withNotificationsSuppressed(() =>
            withChargePluginsSuppressed(async () => {
              // idempotent: delete() of an already-gone row returns false
              await storage.workerTrustElections.delete(c.s2Id);
            }),
          );
        },
      }),
    });
    summary.deleted += sweep.deleted;
    summary.reportOnly += sweep.reportOnly;
    findings.push(...sweep.findings);
    report.sweep = { candidates: sweep.candidates, alreadyHandled: sweep.alreadyHandled, deleted: sweep.deleted };
  } else {
    report.sweep = { skipped: "staging empty — refusing to sweep (would delete every migrated election)" };
  }

  report.pages = pages;
  report.resolved = resolvedCount;
  report.fastPathSkips = fastPathSkips;
  report.typedElections = typed;
  report.untypedElections = untyped;
  report.typedButIrrelevant = typedButIrrelevant;
  report.perEnrollmentType = perType;
  report.endDatedFromChanged = endDatedFromChanged;
  report.created = created;
  report.updated = updated;
  report.reconciledDriftFree = reconciledDriftFree;
  report.adopted = adopted;
  report.adoptedByProvenance = adoptedByProvenance;
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  if (verifySamples.length > 0) report.verifyFailureSamples = verifySamples;

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
    await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);
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
