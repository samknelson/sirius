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
 * Idempotency: worker_msh has no siriusId column and S1 has no per-assignment
 * id, so adoption is by natural key — an existing row for (worker, industry)
 * with the same ms is adopted; same industry but a DIFFERENT ms fails loud
 * (industry_ms_conflict) rather than guessing. Provenance is carried in
 * data.s1WorkerNid / data.s1Tid.
 *
 * Usage: npx tsx scripts/s1-migration/load-member-statuses.ts \
 *          [--dry-run] [--allow-rejects reason1,reason2]
 * Output is aggregate counts only (no PII).
 */
import { storage } from "../../server/storage/database";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings } from "./lib/idmap";
import { RejectLog, loadStaged, epochToYmd } from "./lib/loader-utils";

const LOADER = "t6-member-statuses";
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

/** T6 sentinel for workers with no usable node.changed (should be rare). */
const SENTINEL_DATE_YMD = "2000-01-01";

/** All reasons are row-skipping (fatal for that assignment). */
const FATAL_REASONS = [
  "worker_unmapped",
  "ms_term_unmapped",
  "ms_option_missing",
  "duplicate_industry_assignment",
  "industry_ms_conflict",
  "msh_create_failed",
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

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  const options = createUnifiedOptionsStorage();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

  const workers = await loadStaged("sirius_worker");
  report.stagedWorkers = workers.length;

  // assignments = (worker nid, tid) pairs, delta order ignored, exact dupes collapsed
  const assignments: Array<{ nid: number; tid: number; changed: number | null }> = [];
  let workersWithMs = 0;
  for (const w of workers) {
    const tids = [...new Set(tidsOf(w.fields, "field_sirius_member_status"))];
    if (tids.length === 0) continue;
    workersWithMs++;
    for (const tid of tids) assignments.push({ nid: w.nid, tid, changed: w.changed });
  }
  report.workersWithMs = workersWithMs;
  report.assignments = assignments.length;

  // bulk crosswalks
  const workerMap = await getMappings("worker", [...new Set(assignments.map((a) => a.nid))]);
  const termMap = await getMappings("term", [...new Set(assignments.map((a) => a.tid))]);

  // options_worker_ms id → industryId (authoritative industry source)
  const msRows: Array<{ id: string; name: string; industryId: string }> = await options.list("worker-ms");
  const msById = new Map(msRows.map((r) => [r.id, r]));

  // resolve every assignment BEFORE writing (duplicate-industry detection is per worker)
  interface Resolved {
    nid: number;
    tid: number;
    workerId: string;
    msId: string;
    industryId: string;
    dateYmd: string;
  }
  const perWorker = new Map<number, Resolved[]>();
  for (const a of assignments) {
    const w = workerMap.get(a.nid);
    if (!w) {
      rejects.add("worker_unmapped", { nid: a.nid }, a.nid);
      continue;
    }
    const t = termMap.get(a.tid);
    if (!t) {
      rejects.add("ms_term_unmapped", { nid: a.nid, tid: a.tid }, a.nid);
      continue;
    }
    const ms = msById.get(t.s2Id);
    if (!ms) {
      // id_map points at a worker-ms row that no longer exists (or maps to a
      // different options type) — crosswalk corruption, never guess.
      rejects.add("ms_option_missing", { nid: a.nid, tid: a.tid, s2Id: t.s2Id }, a.nid);
      continue;
    }
    const dateYmd = a.changed != null && a.changed > 0 ? epochToYmd(a.changed) : SENTINEL_DATE_YMD;
    const list = perWorker.get(a.nid) ?? [];
    list.push({ nid: a.nid, tid: a.tid, workerId: w.s2Id, msId: ms.id, industryId: ms.industryId, dateYmd });
    perWorker.set(a.nid, list);
  }

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
    if (rejects.has("duplicate_industry_assignment", nid)) perWorker.delete(nid);
  }

  // ---------------- write pass ----------------
  let created = 0;
  let adopted = 0;
  const expected: Array<Resolved> = [];
  for (const [nid, list] of perWorker) {
    // existing rows for this worker (adopt-by-natural-key)
    const existing: Array<{ id: string; msId: string; industryId: string }> = DRY_RUN
      ? []
      : await storage.workerMsh.getWorkerMsh(list[0].workerId);
    for (const r of list) {
      const byIndustry = existing.filter((e) => e.industryId === r.industryId);
      const same = byIndustry.find((e) => e.msId === r.msId);
      if (same) {
        adopted++;
        expected.push(r);
        continue;
      }
      if (byIndustry.length > 0) {
        rejects.add("industry_ms_conflict", { nid, tid: r.tid, industryId: r.industryId }, nid);
        continue;
      }
      if (DRY_RUN) {
        created++;
        continue;
      }
      try {
        await withNotificationsSuppressed(() =>
          storage.workerMsh.createWorkerMsh({
            workerId: r.workerId,
            date: r.dateYmd,
            msId: r.msId,
            industryId: r.industryId,
            data: { s1WorkerNid: r.nid, s1Tid: r.tid, source: "s1-migration" },
          }),
        );
        created++;
        expected.push(r);
      } catch {
        // NEVER store raw error text — diagnostics can embed row values.
        rejects.add("msh_create_failed", { nid, tid: r.tid }, nid);
      }
    }
  }
  report.created = created;
  report.adopted = adopted;

  // ---------------- verify pass ----------------
  let verifyFailures = 0;
  if (!DRY_RUN) {
    // group expectations per worker, re-read once per worker
    const byWorker = new Map<string, Resolved[]>();
    for (const e of expected) (byWorker.get(e.workerId) ?? byWorker.set(e.workerId, []).get(e.workerId)!).push(e);
    for (const [workerId, exps] of byWorker) {
      const rows: Array<{ msId: string; industryId: string }> = await storage.workerMsh.getWorkerMsh(workerId);
      for (const e of exps) {
        if (!rows.some((row) => row.msId === e.msId && row.industryId === e.industryId)) {
          console.error(`VERIFY: worker nid ${e.nid} missing worker_msh row for tid ${e.tid}`);
          verifyFailures++;
        }
      }
    }
  }

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

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
  console.error(err);
  process.exit(1);
});
