/**
 * N4 loader — sirius_employee → worker_ids (custom worker IDs). Closes N4.
 *
 * Ruling (02-mapping §13c, 06 v5 §8): S1's `sirius_employee` bundle (541 rows,
 * live) is a worker↔employer employment link carrying an employer-assigned
 * employee code (EIN-shaped), used by some employers to submit import files
 * without SSNs. These migrate into S2's existing custom worker IDs feature
 * using ONE ID TYPE PER EMPLOYER (e.g. "Aramark Anaheim Convention Center
 * Employee ID"), mirroring the BPS Employee ID precedent. No schema change:
 * the (type_id, value) UNIQUE constraint enforces per-employer uniqueness by
 * construction, and codes surface on the worker-detail "Additional IDs" panel
 * and worker lists for free.
 *
 * Resolution:
 *   - worker: `field_sirius_worker` target nid → worker id_map (T2).
 *   - employer: `field_grievance_shop` target nid (module-namespace trap,
 *     06 §6) → employer id_map.
 *   - code: `field_sirius_id` value (Q15 on this bundle: the employee code).
 *   - ID type: per employer, ensured idempotently via
 *     options_worker_id_type.sirius_id = "s1-employee-shop-<shopNid>" (stable
 *     across reruns and renames), name "<employer name> Employee ID".
 *
 * Profiling facts honored: 541 rows = 541 distinct (worker, shop) pairs
 * across 540 workers — one worker holds codes at two shops, which becomes two
 * rows under two types (fine). Duplicate codes within one employer violate
 * the (type, value) constraint and are surfaced as `duplicate_code` rejects,
 * never silently skipped. (A duplicate whose twin was fast-path-skipped this
 * run is caught by the existing-row clash check instead and surfaces as
 * code_owned_by_other_worker — same gate, different reason label.)
 *
 * Sync semantics (Task 293 — RUNBOOK §10): RECONCILING. Consumed fingerprint
 * = the staged node's content hash (worker/shop retargets and code edits all
 * change the node). S1-wins on fingerprint mismatch: workerId, typeId, and
 * value all converge via updateWorkerId. Deletion sweep: employee-id rows are
 * SAFE CHILD ROWS — S1-deleted sirius_employee nodes hard-delete the S2
 * worker_ids row (loader-scoped mappings only; adopted operator rows were
 * mapped by this loader and are swept too — ruled acceptable, the adopt
 * asserted S1 ownership of the code). Per-employer ID TYPES are never swept
 * (harmless when empty, shared feature surface).
 *
 * REJECT POLICY (fail loud): every reject reason present in the run must be
 * explicitly allowed via `--allow-rejects r1,r2,...` or the run exits 1
 * (after the full report). Dev synthetic staging lacks the field tables, so
 * dev runs need `--allow-rejects worker_ref_missing`. Production: run with NO
 * allowances first; every allowance must be a conscious ruling.
 *
 * Writes go through storage (workerIds / unified options) under notification
 * suppression. Idempotent via id_map entity "employee-id". Failures are
 * reported as SANITIZED codes (storage_error) — never raw error text (HIPAA).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-employee-ids.ts [--dry-run]
 *       [--force-reconcile] [--allow-rejects r1,r2] [--allow-findings k1,k2]
 *
 * Output is AGGREGATES ONLY (plus S1 nids / opaque ids) — safe inside the
 * HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints } from "./lib/idmap";
import { RejectLog, loadStaged, strOf, targetNidOf, type StagedNode } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
} from "./lib/sync";

const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "n4-employee-ids";
/** BUMP whenever transform logic changes so unchanged S1 rows reprocess. */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

/** All reasons are row-skipping (fatal) — the verify pass skips exactly
 * these. Kept explicit so a future annotation-style reason can't silently
 * widen the verify allowlist. */
const FATAL_REASONS = [
  "worker_ref_missing",
  "worker_unmapped",
  "shop_ref_missing",
  "employer_unmapped",
  "code_missing",
  "duplicate_code",
  "code_owned_by_other_worker",
  "id_type_create_failed",
  "worker_id_create_failed",
  "worker_id_update_failed",
] as const;

/** Stable sirius_id for the per-employer ID type — reruns find it even if an
 * operator renames the type in the UI. */
const typeSiriusId = (shopNid: number) => `s1-employee-shop-${shopNid}`;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();

  // Heartbeat from process start — staged load + bulk id_map lookups emit
  // liveness ticks until the row total is known.
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const rows = await loadStaged("sirius_employee");
  report.stagedEmployees = rows.length;

  // bulk id_map lookups
  const idMap = await getMappings("employee-id", rows.map((r) => r.nid));
  const workerNids = new Set<number>();
  const shopNids = new Set<number>();
  for (const r of rows) {
    const w = targetNidOf(r.fields, "field_sirius_worker");
    const s = targetNidOf(r.fields, "field_grievance_shop");
    if (w != null) workerNids.add(w);
    if (s != null) shopNids.add(s);
  }
  const workerMap = await getMappings("worker", [...workerNids]);
  const employerMap = await getMappings("employer", [...shopNids]);

  const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");
  const options = createUnifiedOptionsStorage();

  const stats = { matched: 0, created: 0, updated: 0, adopted: 0, typesCreated: 0, typesReused: 0 };
  /** shopNid → ensured type id (per-run cache). */
  const typeIdByShopNid = new Map<number, string>();
  /** (typeId|value) → nid seen this run — duplicate codes within one employer. */
  const seenTypeValue = new Map<string, number>();
  /** nid → expected row shape (for the verify pass). */
  const expected = new Map<number, { workerId: string; typeId: string; value: string }>();

  const summary = emptySummary();
  let fastPathSkips = 0;
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const verifyFailedNids = new Set<number>();
  /** rows actually processed this run (changed/new) — verify scope */
  const processedRows: StagedNode[] = [];

  async function ensureTypeForShop(shopNid: number, employerS2Id: string): Promise<string | null> {
    const cached = typeIdByShopNid.get(shopNid);
    if (cached) return cached;
    const bySirius = await storage.workerIds.getTypeIdBySiriusId(typeSiriusId(shopNid));
    if (bySirius) {
      typeIdByShopNid.set(shopNid, bySirius);
      stats.typesReused++;
      return bySirius;
    }
    const employer = await storage.employers.getEmployer(employerS2Id);
    const name = `${employer?.name ?? `Employer ${shopNid}`} Employee ID`;
    if (DRY_RUN) {
      const placeholder = `dry-run-type-${shopNid}`;
      typeIdByShopNid.set(shopNid, placeholder);
      stats.typesCreated++;
      return placeholder;
    }
    const created = await withNotificationsSuppressed(() =>
      options.create("worker-id-type", { name, siriusId: typeSiriusId(shopNid), sequence: 0 }),
    );
    typeIdByShopNid.set(shopNid, created.id);
    stats.typesCreated++;
    return created.id;
  }

  progress.setTotal(rows.length);
  progress.phase(null);
  for (const r of rows) {
    progress.add(1);
    const mapped = idMap.get(r.nid);
    const fp = r.contentHash;
    if (classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }
    processedRows.push(r);
    // ---- resolve + validate EVERYTHING before any write for this row ----
    const workerNid = targetNidOf(r.fields, "field_sirius_worker");
    if (workerNid == null) {
      rejects.add("worker_ref_missing", { nid: r.nid }, r.nid);
      continue;
    }
    const worker = workerMap.get(workerNid);
    if (!worker) {
      rejects.add("worker_unmapped", { nid: r.nid, workerNid }, r.nid);
      continue;
    }
    const shopNid = targetNidOf(r.fields, "field_grievance_shop");
    if (shopNid == null) {
      rejects.add("shop_ref_missing", { nid: r.nid }, r.nid);
      continue;
    }
    const employer = employerMap.get(shopNid);
    if (!employer) {
      rejects.add("employer_unmapped", { nid: r.nid, shopNid }, r.nid);
      continue;
    }
    const value = strOf(r.fields, "field_sirius_id");
    if (!value) {
      rejects.add("code_missing", { nid: r.nid }, r.nid);
      continue;
    }

    let typeId: string | null;
    try {
      typeId = await ensureTypeForShop(shopNid, employer.s2Id);
    } catch {
      rejects.add("id_type_create_failed", { nid: r.nid, shopNid, code: "storage_error" }, r.nid);
      continue;
    }
    if (!typeId) {
      rejects.add("id_type_create_failed", { nid: r.nid, shopNid }, r.nid);
      continue;
    }

    // duplicate code within one employer (the (type,value) UNIQUE would trip)
    const tvKey = `${typeId}|${value}`;
    const firstNid = seenTypeValue.get(tvKey);
    if (firstNid != null && firstNid !== r.nid) {
      rejects.add("duplicate_code", { nid: r.nid, shopNid, firstNid }, r.nid);
      continue;
    }
    seenTypeValue.set(tvKey, r.nid);

    // ---- matched: full reconcile (workerId/typeId/value — S1 wins); new: create ----
    const mapped2 = mapped;
    if (mapped2) {
      stats.matched++;
      expected.set(r.nid, { workerId: worker.s2Id, typeId, value });
      if (DRY_RUN) {
        summary.updated++; // classification says changed; counts approximate under --dry-run
        continue;
      }
      const row = await storage.workerIds.getWorkerId(mapped2.s2Id);
      if (!row) {
        console.error(`VERIFY: employee-id nid ${r.nid} maps to missing worker_ids row ${mapped2.s2Id}`);
        verifyFailedNids.add(r.nid);
        continue;
      }
      if (row.value !== value || row.typeId !== typeId || row.workerId !== worker.s2Id) {
        try {
          await withNotificationsSuppressed(() =>
            storage.workerIds.updateWorkerId(mapped2.s2Id, { workerId: worker.s2Id, typeId: typeId!, value }),
          );
          stats.updated++;
          summary.updated++;
        } catch {
          rejects.add("worker_id_update_failed", { nid: r.nid, code: "storage_error" }, r.nid);
          continue; // no fingerprint advance — retries next run
        }
      } else {
        summary.unchanged++; // reconciled, proven drift-free
      }
      pendingAdvance.push({ s1Id: r.nid, fingerprint: fp });
      continue;
    }

    if (DRY_RUN) {
      stats.created++;
      summary.created++;
      continue;
    }

    // pre-existing (type,value) row not from this loader (e.g. operator-added)
    const clash = await storage.workerIds.getWorkerIdByTypeAndValue(typeId, value);
    if (clash) {
      if (clash.workerId === worker.s2Id) {
        // same worker already carries this code — adopt the row
        await putMapping("employee-id", r.nid, clash.id, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
        stats.matched++;
        stats.adopted++;
        summary.updated++; // mapping written; row itself already matched S1
        expected.set(r.nid, { workerId: worker.s2Id, typeId, value });
      } else {
        rejects.add("code_owned_by_other_worker", { nid: r.nid, shopNid }, r.nid);
      }
      continue;
    }

    try {
      const created = await withNotificationsSuppressed(() =>
        storage.workerIds.createWorkerId({ workerId: worker.s2Id, typeId, value }),
      );
      const winner = await putMapping("employee-id", r.nid, created.id, {
        stub: false,
        loader: LOADER,
        fingerprint: fp,
        logicVersion: LOGIC_VERSION,
      });
      if (winner !== created.id) {
        console.error(`RACE: employee-id nid ${r.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
      }
      stats.created++;
      summary.created++;
      expected.set(r.nid, { workerId: worker.s2Id, typeId, value });
    } catch {
      rejects.add("worker_id_create_failed", { nid: r.nid, code: "storage_error" }, r.nid);
    }
  }
  report.employeeIds = stats;

  // ---------------- verify pass ----------------
  // Scoped to rows PROCESSED this run (fast-path rows were verified when
  // last processed; --force-reconcile re-verifies the whole population).
  progress.phase("verify", processedRows.length);
  let verifyFailures = verifyFailedNids.size; // missing-row hits from the loop
  if (!DRY_RUN) {
    const vMap = await getMappings("employee-id", processedRows.map((r) => r.nid));
    for (const r of processedRows) {
      progress.add(1);
      if (rejects.hasAnyIn(r.nid, FATAL_REASONS)) continue;
      if (verifyFailedNids.has(r.nid)) continue; // already counted above
      const m = vMap.get(r.nid);
      if (!m) {
        console.error(`VERIFY: employee-id nid ${r.nid} has no id_map entry`);
        verifyFailures++;
        verifyFailedNids.add(r.nid);
        continue;
      }
      const row = await storage.workerIds.getWorkerId(m.s2Id);
      if (!row) {
        console.error(`VERIFY: employee-id nid ${r.nid} maps to missing worker_ids row ${m.s2Id}`);
        verifyFailures++;
        verifyFailedNids.add(r.nid);
        continue;
      }
      const exp = expected.get(r.nid);
      if (exp && (row.workerId !== exp.workerId || row.typeId !== exp.typeId || row.value !== exp.value)) {
        console.error(`VERIFY: employee-id nid ${r.nid} row does not match expected resolution`);
        verifyFailures++;
        verifyFailedNids.add(r.nid);
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — after verify
  // so failed rows stay retryable ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      "employee-id",
      pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id)),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweep: sirius_employee nodes deleted in S1 ----
  // Employee-id rows are SAFE CHILD ROWS (ruled): hard-delete the S2
  // worker_ids row and drop the mapping. deleteWorkerId returns false on a
  // missing row (idempotent retry-safe).
  const sweep = await sweepDeletions({
    entity: "employee-id",
    loaders: [LOADER],
    sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = 'sirius_employee'`,
    dryRun: DRY_RUN,
    policy: async (c) => ({
      action: "delete",
      apply: async () => {
        await withNotificationsSuppressed(() => storage.workerIds.deleteWorkerId(c.s2Id));
      },
    }),
  });
  summary.deleted += sweep.deleted;
  report.sweep = { candidates: sweep.candidates, deleted: sweep.deleted, alreadyHandled: sweep.alreadyHandled };

  progress.stop();

  report.fastPathSkips = fastPathSkips;
  report.rejectSamples = rejects.samples;

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
        `Every expected reject class must be explicitly allowed via --allow-rejects (dev synthetic gap: worker_ref_missing).`,
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
