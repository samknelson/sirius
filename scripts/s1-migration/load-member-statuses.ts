/**
 * T6 loader — worker member-status eligibility groups → worker_msh.
 * Load-order step: after T4 (options) and T3/T1 (contacts/workers).
 *
 * Rules (03-transformations T6, 06-strategy-revision §4.6 v5):
 *   - Source: worker bundle `field_sirius_member_status` (multi-value tids,
 *     max 4 in prod; delta order is NOT meaningful and is ignored).
 *   - Each tid resolves through s1_staging.id_map (entity `term`, written by
 *     T4) to an options_worker_ms row; the row's industry_id is authoritative
 *     (Q37 — never parse industries out of term names).
 *   - Exactly ONE current worker_msh row per (worker, industry). Production
 *     co-assignments always cross industries; two terms landing on the same
 *     industry is a fatal reject (duplicate_industry_assignment).
 *   - NO history reconstruction and NO worker_wsh rows (06 §4.8a: work status
 *     is vestigial; employment status derives from hour types via T20).
 *   - Row date: the worker node's `changed` date (stable, real provenance);
 *     sentinel 2000-01-01 when the node has no changed timestamp. T6 is
 *     current-state-only, so any post-migration status entry supersedes it.
 *
 * Sync semantics (Task 293 — RUNBOOK §10): RECONCILING, anchored on a NEW
 * id_map entity `worker-ms` (s1_id = WORKER nid, s2_id = worker id) since S1
 * has no per-assignment id. Consumed fingerprint = hash of the worker's
 * RESOLVED assignment set ({tid, msId, industryId}, tid-sorted) —
 * deliberately NOT node.changed (any unrelated worker edit would churn every
 * status row) and NOT the row date (frozen as first-load provenance; on a
 * status CHANGE the row date moves to the worker node's changed date).
 * S1-wins on mismatch, scoped to MIGRATION-OWNED rows (data.source ===
 * "s1-migration"):
 *   - same industry, different ms → update msId (+date) on the owned row;
 *     foreign rows still fail loud (industry_ms_conflict).
 *   - industry gone from source → delete the owned row; foreign rows are
 *     counted (extraIndustryRows), never touched. Removal is SKIPPED for a
 *     worker with any reject this run — an unresolved assignment must not
 *     cascade into deleting its still-valid row.
 *   - worker node deleted in S1 → sweep deletes the worker's owned msh rows
 *     (safe child rows; the worker itself is t3t1's report-only finding).
 * Workers with zero staged statuses but an existing `worker-ms` mapping
 * reconcile to an empty owned set (mapping kept). Adopted-by-natural-key
 * foreign rows are never removed later (not owned) — conservative, ruled.
 *
 * Idempotency: adoption by natural key — an existing row for
 * (worker, industry) with the same ms is adopted; same industry but a
 * DIFFERENT ms on a foreign row fails loud rather than guessing. Provenance
 * is carried in data.s1WorkerNid / data.s1Tid / data.source.
 *
 * Usage: npx tsx scripts/s1-migration/load-member-statuses.ts \
 *          [--dry-run] [--force-reconcile] [--allow-rejects r1,r2] [--allow-findings k1,k2]
 * Output is aggregate counts only (no PII).
 */
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints } from "./lib/idmap";
import { RejectLog, loadStaged, epochToYmd } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  contentHashOf,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
} from "./lib/sync";

const LOADER = "t6-member-statuses";
const ID_MAP_ENTITY = "worker-ms";
/** BUMP whenever transform logic changes so unchanged S1 rows reprocess. */
const LOGIC_VERSION = 1;
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

/** T6 sentinel for workers with no usable node.changed (should be rare). */
const SENTINEL_DATE_YMD = "2000-01-01";

/** Migration ownership marker on worker_msh.data. */
const OWNED_SOURCE = "s1-migration";

/** All reasons are row-skipping (fatal for that assignment). */
const FATAL_REASONS = [
  "worker_unmapped",
  "ms_term_unmapped",
  "ms_option_missing",
  "bad_changed_epoch",
  "duplicate_industry_assignment",
  "duplicate_existing_rows",
  "industry_ms_conflict",
  "msh_create_failed",
  "msh_update_failed",
  "msh_delete_failed",
] as const;

/** Multi-value tid extraction: scalar, array, or {value|tid} wrapped. */
function tidsOf(fields: Record<string, unknown>, key: string): number[] {
  const raw = fields[key];
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: number[] = [];
  for (const v of list) {
    let cand: unknown = v;
    if (cand && typeof cand === "object") {
      const o = cand as Record<string, unknown>;
      cand = o.tid ?? o.value ?? o.target_id;
    }
    const n = typeof cand === "number" ? cand : typeof cand === "string" && /^\d+$/.test(cand) ? Number(cand) : null;
    if (n != null) out.push(n);
  }
  return out;
}

function isOwned(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as Record<string, unknown>).source === OWNED_SOURCE;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  const options = createUnifiedOptionsStorage();

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();

  // Heartbeat from process start: the staged-worker load + bulk crosswalks
  // below are the dominant wall-clock on the real target — total is unknown
  // until perWorker is built, so pre-scan ticks are liveness-only.
  const progress = makeProgressLogger(LOADER, 0, { verb: "workers" });
  progress.phase("pre-scan");

  const workers = await loadStaged("sirius_worker");
  report.stagedWorkers = workers.length;

  // tids per staged worker (empty lists KEPT — a mapped worker whose statuses
  // were all removed in S1 must reconcile to an empty owned set)
  const tidsByNid = new Map<number, number[]>();
  let workersWithMs = 0;
  for (const w of workers) {
    const tids = [...new Set(tidsOf(w.fields, "field_sirius_member_status"))];
    if (tids.length > 0) workersWithMs++;
    tidsByNid.set(w.nid, tids);
  }
  report.workersWithMs = workersWithMs;

  // bulk crosswalks
  const allTids = [...new Set([...tidsByNid.values()].flat())];
  const wmsMap = await getMappings(ID_MAP_ENTITY, workers.map((w) => w.nid));
  const relevantNids = workers.filter((w) => (tidsByNid.get(w.nid) ?? []).length > 0 || wmsMap.has(w.nid)).map((w) => w.nid);
  const workerMap = await getMappings("worker", relevantNids);
  const termMap = await getMappings("term", allTids);

  // options_worker_ms id → industryId (authoritative industry source)
  const msRows: Array<{ id: string; name: string; industryId: string }> = await options.list("worker-ms");
  const msById = new Map(msRows.map((r) => [r.id, r]));

  interface Resolved {
    nid: number;
    tid: number;
    workerId: string;
    msId: string;
    industryId: string;
    dateYmd: string;
  }

  const summary = emptySummary();
  let fastPathSkips = 0;
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const verifyFailedNids = new Set<number>();
  /** nid → fp for workers processed this run (changed/new). */
  const processed = new Map<number, string>();
  /** nid → resolved desired assignments (only for processed workers). */
  const perWorker = new Map<number, Resolved[]>();
  /** nid → workerId for processed workers (covers empty desired sets). */
  const workerIdByNid = new Map<number, string>();

  // ---------------- classification + resolution ----------------
  progress.phase("classify");
  let assignments = 0;
  for (const w of workers) {
    const tids = tidsByNid.get(w.nid) ?? [];
    const mapped = wmsMap.get(w.nid);
    if (tids.length === 0 && !mapped) continue; // nothing to do, nothing owned

    // fingerprint over the RESOLVED assignment set (tid-sorted); unresolved
    // tids participate so a later crosswalk repair reprocesses the worker
    const specs = [...tids]
      .sort((a, b) => a - b)
      .map((tid) => {
        const t = termMap.get(tid);
        const ms = t ? msById.get(t.s2Id) : undefined;
        return ms ? { tid, msId: ms.id, industryId: ms.industryId } : { tid, unresolved: true };
      });
    const fp = contentHashOf(specs);
    if (classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }

    const wm = workerMap.get(w.nid);
    const workerId = wm?.s2Id ?? mapped?.s2Id ?? null;
    if (!workerId) {
      rejects.add("worker_unmapped", { nid: w.nid }, w.nid);
      continue;
    }
    processed.set(w.nid, fp);
    workerIdByNid.set(w.nid, workerId);

    const list: Resolved[] = [];
    for (const tid of tids) {
      assignments++;
      const t = termMap.get(tid);
      if (!t) {
        rejects.add("ms_term_unmapped", { nid: w.nid, tid }, w.nid);
        continue;
      }
      const ms = msById.get(t.s2Id);
      if (!ms) {
        // id_map points at a worker-ms row that no longer exists (or maps to a
        // different options type) — crosswalk corruption, never guess.
        rejects.add("ms_option_missing", { nid: w.nid, tid, s2Id: t.s2Id }, w.nid);
        continue;
      }
      const changedYmd = w.changed != null && w.changed > 0 ? epochToYmd(w.changed) : SENTINEL_DATE_YMD;
      if (!changedYmd) {
        // changed passed the >0 guard but is not a sane epoch (e.g. absurd future value)
        rejects.add("bad_changed_epoch", { nid: w.nid, tid, changed: w.changed }, w.nid);
        continue;
      }
      list.push({ nid: w.nid, tid, workerId, msId: ms.id, industryId: ms.industryId, dateYmd: changedYmd });
    }
    perWorker.set(w.nid, list);
  }
  report.assignments = assignments;

  // duplicate-industry detection (prod invariant: co-assignments cross industries)
  for (const [nid, list] of perWorker) {
    const seen = new Map<string, number>();
    for (const r of list) {
      const prevTid = seen.get(r.industryId);
      if (prevTid != null) {
        rejects.add("duplicate_industry_assignment", { nid, tids: [prevTid, r.tid], industryId: r.industryId }, nid);
      } else {
        seen.set(r.industryId, r.tid);
      }
    }
    if (rejects.has("duplicate_industry_assignment", nid)) perWorker.set(nid, []); // no writes, stays retryable (reject blocks advance)
  }

  // ---------------- write pass ----------------
  progress.setTotal(processed.size);
  progress.phase(null);
  const stats = { rowsCreated: 0, statusMoves: 0, rowsRemoved: 0, adopted: 0 };
  const expected: Array<Resolved> = [];
  for (const [nid, fp] of processed) {
    progress.add(1);
    const list = perWorker.get(nid) ?? [];
    const workerId = workerIdByNid.get(nid)!;
    const mapped = wmsMap.get(nid);
    let writes = 0;
    // existing rows for this worker (adopt-by-natural-key + ownership checks)
    const existing: Array<{ id: string; msId: string; industryId: string; data: unknown }> = DRY_RUN
      ? []
      : await storage.workerMsh.getWorkerMsh(workerId);
    const desiredIndustries = new Set(list.map((r) => r.industryId));
    for (const r of list) {
      const byIndustry = existing.filter((e) => e.industryId === r.industryId);
      if (byIndustry.length > 1) {
        // Target already violates the one-current-row-per-(worker,industry)
        // invariant — never adopt into a duplicated state; manual repair.
        rejects.add("duplicate_existing_rows", { nid, tid: r.tid, industryId: r.industryId, rows: byIndustry.length }, nid);
        continue;
      }
      const same = byIndustry.find((e) => e.msId === r.msId);
      if (same) {
        stats.adopted++;
        expected.push(r);
        continue;
      }
      if (byIndustry.length > 0) {
        const row = byIndustry[0];
        if (isOwned(row.data)) {
          // S1-wins: the member status MOVED within this industry
          try {
            await withNotificationsSuppressed(() =>
              storage.workerMsh.updateWorkerMsh(row.id, {
                msId: r.msId,
                date: r.dateYmd,
                data: { ...(row.data as Record<string, unknown>), s1WorkerNid: r.nid, s1Tid: r.tid, source: OWNED_SOURCE },
              }),
            );
            stats.statusMoves++;
            writes++;
            expected.push(r);
          } catch {
            rejects.add("msh_update_failed", { nid, tid: r.tid }, nid);
          }
        } else {
          rejects.add("industry_ms_conflict", { nid, tid: r.tid, industryId: r.industryId }, nid);
        }
        continue;
      }
      if (DRY_RUN) {
        stats.rowsCreated++;
        continue;
      }
      try {
        await withNotificationsSuppressed(() =>
          storage.workerMsh.createWorkerMsh({
            workerId: r.workerId,
            date: r.dateYmd,
            msId: r.msId,
            industryId: r.industryId,
            data: { s1WorkerNid: r.nid, s1Tid: r.tid, source: OWNED_SOURCE },
          }),
        );
        stats.rowsCreated++;
        writes++;
        expected.push(r);
      } catch {
        // NEVER store raw error text — diagnostics can embed row values.
        rejects.add("msh_create_failed", { nid, tid: r.tid }, nid);
      }
    }
    // Removal: migration-owned rows for industries GONE from the source.
    // Skipped when the worker has any reject this run — an unresolved
    // assignment must not cascade into deleting its still-valid row.
    if (!DRY_RUN && !rejects.hasAnyIn(nid, FATAL_REASONS)) {
      for (const e of existing) {
        if (!desiredIndustries.has(e.industryId) && isOwned(e.data)) {
          try {
            await withNotificationsSuppressed(() => storage.workerMsh.deleteWorkerMsh(e.id));
            stats.rowsRemoved++;
            writes++;
          } catch {
            rejects.add("msh_delete_failed", { nid, industryId: e.industryId }, nid);
          }
        }
      }
    }
    // per-worker summary accounting + mapping bookkeeping
    if (rejects.hasAnyIn(nid, FATAL_REASONS)) continue; // no mapping/advance — retries next run
    if (DRY_RUN) {
      if (mapped) summary.updated++; // approximate under --dry-run
      else summary.created++;
      continue;
    }
    if (!mapped) {
      await putMapping(ID_MAP_ENTITY, nid, workerId, {
        stub: false,
        loader: LOADER,
        fingerprint: fp,
        logicVersion: LOGIC_VERSION,
      });
      summary.created++;
    } else {
      if (writes > 0) summary.updated++;
      else summary.unchanged++;
      pendingAdvance.push({ s1Id: nid, fingerprint: fp });
    }
  }
  report.msh = stats;

  // ---------------- verify pass ----------------
  let verifyFailures = 0;
  let extraIndustryRows = 0;
  if (!DRY_RUN) {
    // group expectations per worker, re-read once per worker
    const byWorker = new Map<string, Resolved[]>();
    for (const e of expected) (byWorker.get(e.workerId) ?? byWorker.set(e.workerId, []).get(e.workerId)!).push(e);
    progress.phase("verify", byWorker.size);
    for (const [workerId, exps] of byWorker) {
      progress.add(1);
      const rows: Array<{ msId: string; industryId: string; data: unknown }> = await storage.workerMsh.getWorkerMsh(workerId);
      for (const e of exps) {
        // exact cardinality: EXACTLY one row for the industry, carrying our ms
        const industryRows = rows.filter((row) => row.industryId === e.industryId);
        if (industryRows.length !== 1 || industryRows[0].msId !== e.msId) {
          console.error(
            `VERIFY: worker nid ${e.nid} tid ${e.tid} — expected exactly 1 worker_msh row for its industry with the mapped ms, found ${industryRows.length}`,
          );
          verifyFailures++;
          verifyFailedNids.add(e.nid);
        }
      }
      // informational: FOREIGN rows in industries the source has no assignment
      // for (legit post-migration data on a live target — never touched).
      // Owned rows outside the desired set were removed above; any survivor
      // is a verify failure via the removal-reject path, not counted here.
      const expectedIndustries = new Set(exps.map((e) => e.industryId));
      extraIndustryRows += rows.filter((row) => !expectedIndustries.has(row.industryId) && !isOwned(row.data)).length;
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — after verify
  // so failed workers stay retryable ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      ID_MAP_ENTITY,
      pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id)),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweep: worker nodes deleted in S1 ----
  // The worker's MIGRATION-OWNED msh rows are safe child rows — delete them
  // and drop the anchor mapping. The worker row itself is t3t1's report-only
  // deleted_in_s1 finding, never touched here.
  const sweep = await sweepDeletions({
    entity: ID_MAP_ENTITY,
    loaders: [LOADER],
    sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = 'sirius_worker'`,
    dryRun: DRY_RUN,
    policy: async (c) => ({
      action: "delete",
      apply: async () => {
        const rows: Array<{ id: string; data: unknown }> = await storage.workerMsh.getWorkerMsh(c.s2Id);
        for (const row of rows) {
          if (isOwned(row.data)) {
            await withNotificationsSuppressed(() => storage.workerMsh.deleteWorkerMsh(row.id));
          }
        }
      },
    }),
  });
  summary.deleted += sweep.deleted;
  report.sweep = { candidates: sweep.candidates, deleted: sweep.deleted, alreadyHandled: sweep.alreadyHandled };

  progress.stop();

  report.fastPathSkips = fastPathSkips;
  report.rejectSamples = rejects.samples;
  report.extraIndustryRows = extraIndustryRows;

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings: sweep.findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(`FAIL: ${result.blockingFindings.length} blocking sync finding(s) — resolve or acknowledge via --allow-findings.`);
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
