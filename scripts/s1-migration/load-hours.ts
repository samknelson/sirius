/**
 * T20 loader — sirius_payperiod (staged) → S2 worker_hours. Milestone 1.
 *
 * Reads s1_staging.records (bundle=sirius_payperiod), writes through
 * storage.workerHours.upsertWorkerHours inside a notification-suppressed
 * scope. Idempotent: re-runs upsert the same (worker, employer, year, month)
 * keys.
 *
 * Extraction rules per 06-strategy-revision v5 §4.12 / 03-transformations T20:
 *   - hours  = $.totals.hours.total, ALWAYS parsed as decimal
 *   - hour-type tid = the single key of $.totals.hours.by_type (multi-key rows
 *     are rejected and reported); tid → options_employment_status by name
 *   - legacy-format rows (entries is an ARRAY) are skipped with reason
 *     `legacy_json_format`, nids logged (N18: exactly 10 in production)
 *   - month attribution: field_sirius_date_start's calendar month (OPEN-5
 *     CLOSED 2026-08-04: production has 0 boundary-spanning payperiods;
 *     `boundarySpanningPeriods_OPEN5` stays as a tripwire that must read 0)
 *   - negative hours totals load as-is and are counted (OPEN-3 CLOSED
 *     2026-08-05: import as-is — BPA-era corrections, kept for pension
 *     vesting; no charges generate from negative hours)
 *   - $.entries keys are provenance — aggregated in the run report; row-level
 *     provenance stays derivable from staging (worker_hours has no data column)
 *   - multiple payperiods in one (worker, employer, month) SUM their hours;
 *     the employment status comes from the latest date_start (ties → higher
 *     nid); months mixing hour types are counted in the report
 *
 * Reference resolution goes through s1_staging.id_map. Until T4 (workers) and
 * T7 (employers) exist, `--stub-missing` creates minimal S2 rows through
 * storage (marked stub=true in id_map) so the pipeline verifies end-to-end in
 * dev. Without the flag, unresolved references are counted skips; the report
 * carries distinct-nid counts plus ≤20 sample nids per side (same pattern as
 * skipNids) so unresolved refs are triaged from the report alone — classify
 * each nid as staged-but-unmapped (loader gap) vs not-staged (deleted in S1)
 * via 07-prod-query-pack §P7.
 *
 * Charge plugins: worker_hours upserts trigger hour-driven charge plugins
 * (bao-hourly, ECHP, ...). During a production migration these must NOT run —
 * ledger history arrives via its own loader, so replay would double-bill.
 * Pass --migration-mode to run every write inside a charge-plugin-suppressed
 * scope. Without it, the loader preflights: if any charge plugin is runnable
 * (component enabled + enabled config), it ABORTS before writing anything.
 * The stale-key cleanup below is a write path too — it runs after the same
 * preflight and inside the same loaderScope suppression.
 *
 * SYNC (Task 295 — S1-wins dual-run reconciliation, RUNBOOK §10):
 *   Upsert re-aggregation already converges changed payperiods; what it
 *   cannot see is a month whose staged payperiods VANISHED (deleted in S1)
 *   or MOVED (retargeted worker/employer/month) — the old (worker, employer,
 *   year, month) row would stay stale forever. worker_hours has no
 *   provenance column, so the loader keeps a sidecar
 *   (s1_staging.hours_keys): every key it writes is stamped last_seen_at per
 *   run. After a fully-verified run, keys NOT stamped this run (stale) have
 *   their day=1 worker_hours row deleted through storage and the key
 *   removed. Only ever-stamped keys can be deleted, so operator-entered
 *   hours rows are untouchable by construction. Deleted rows are pure
 *   aggregates of staged data — a resolution regression (mapping removed,
 *   group skipped, row cleaned) self-heals on the next run after the
 *   mapping is repaired.
 *   --adopt-hours-keys (one-time per pre-sidecar target): seed keys from
 *   existing day=1 worker_hours rows whose worker AND employer map in
 *   id_map, with an epoch stamp. PRECONDITION: no manual hours entry for
 *   migrated pairs has happened on that target.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-hours.ts [--dry-run] [--stub-missing] \
 *     [--migration-mode] [--adopt-hours-keys]
 *
 * Output is AGGREGATES ONLY (plus S1 nids, which are opaque ids) — safe inside
 * the HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
// IMPORTANT: import via the charge package barrel, NOT ./charge/executor —
// the barrel's side-effect imports register every charge plugin. Importing
// the executor module directly leaves the registry empty, and the preflight
// below would falsely report "no runnable plugins".
import { hasRunnableChargePlugins, getAllChargePlugins } from "../../server/plugins/ledger/charge";
import {
  ensureStagingSchema,
  recordRun,
  stagingNow,
  ensureHoursKeysTable,
  upsertHoursKeys,
  pagedStaleHoursKeys,
  deleteHoursKeys,
  adoptHoursKeysFromWorkerHours,
  type HoursKey,
} from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { LOADER_PAGE_SIZE, stagedCountOf, chunk, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import { buildLoaderResult, emitLoaderResult, loaderExitCode, emptySummary } from "./lib/sync";

const LOADER = "t20-hours";
const LOGIC_VERSION = 1;
const DRY_RUN = process.argv.includes("--dry-run");
const STUB_MISSING = process.argv.includes("--stub-missing");
const MIGRATION_MODE = process.argv.includes("--migration-mode");
const ADOPT_HOURS_KEYS = process.argv.includes("--adopt-hours-keys");

/**
 * Run `fn` in a notification-suppressed scope, additionally suppressing
 * charge-plugin execution when --migration-mode is set.
 */
function loaderScope<T>(fn: () => Promise<T>): Promise<T> {
  return MIGRATION_MODE
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn))
    : withNotificationsSuppressed(fn);
}

/** S1 sirius_hour_type tid → S2 options_employment_status.name (v5 §4.12 —
 * the live 1600-series plus 1544; the five 900-series terms never occur). */
const HOUR_TYPE_TID_TO_STATUS_NAME: Record<string, string> = {
  "1544": "Active",
  "1682": "No Charge",
  "1637": "Terminated",
  "1634": "LOA",
  "1633": "FMLA",
  "1632": "Disability",
  "1635": "Military Leave",
  "1691": "Initial Eligibility",
  "1662": "Deceased",
  "1701": "Event Center Hours Purchasing",
  "1636": "COBRA",
};

interface StagedPayperiod {
  nid: number;
  title: string | null;
  fields: Record<string, unknown>;
}

interface ParsedRow {
  nid: number;
  workerNid: number;
  employerNid: number;
  year: number;
  month: number;
  dateStart: string;
  hours: number;
  hourTypeTid: string;
}

function asScalarRef(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return v[0];
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** Wall-time month extraction: first 7 chars of the date string (LA wall time
 * per 06 §5 — parsed literally, never timezone-shifted). Accepts both verbatim
 * D7 "YYYY-MM-DD HH:MM:SS" and the ISO form older extracts staged. */
function yearMonthOf(v: unknown): { year: number; month: number; ym: string } | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}/.test(v)) return null;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(5, 7));
  if (!year || month < 1 || month > 12) return null;
  return { year, month, ym: v.slice(0, 7) };
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureHoursKeysTable();
  // DB-clock watermark BEFORE any stamp: keys stamped by this run's flushes
  // are >= watermark; keys still below it afterwards are stale.
  const watermark = await stagingNow();

  // ---- charge-plugin preflight (fail loudly BEFORE any write) ----
  // worker_hours upserts trigger hour-driven charge plugins. In migration
  // mode all writes run charge-suppressed; without it, refuse to write while
  // any charge plugin is runnable — otherwise the load double-bills.
  if (!DRY_RUN && !MIGRATION_MODE) {
    if (getAllChargePlugins().length === 0) {
      // The preflight is only meaningful if the plugin registry actually
      // loaded. The barrel import above registers >0 plugins statically, so
      // an empty registry means a wiring regression — refuse to proceed.
      throw new Error(
        "ABORTING: charge plugin registry is empty — preflight cannot verify charge-plugin state. " +
          "This is a loader wiring bug (charge package barrel not imported). Nothing was written.",
      );
    }
    const { runnable, pluginIds } = await hasRunnableChargePlugins();
    if (runnable) {
      throw new Error(
        `ABORTING: charge plugins are enabled and runnable (${pluginIds.join(", ")}). ` +
          `Loading hours now would execute hour-driven charge plugins and double-bill. ` +
          `Re-run with --migration-mode (suppresses charge plugins for this load) ` +
          `or disable the charge plugin configs first. Nothing was written.`,
      );
    }
  }
  if (MIGRATION_MODE) {
    console.error("MIGRATION MODE: charge-plugin execution is suppressed for all writes in this run.");
  }

  // ---- one-time sidecar adoption for pre-sidecar targets (see header) ----
  let adoptedKeys = 0;
  if (ADOPT_HOURS_KEYS && !DRY_RUN) {
    adoptedKeys = await adoptHoursKeysFromWorkerHours();
    console.error(`ADOPT: seeded ${adoptedKeys} hours_keys from existing mapped-pair worker_hours rows (epoch stamp).`);
  }

  // ---- resolve the employment-status mapping up front; fail loudly ----
  const statusRes = await db.execute(sql`SELECT id, name FROM options_employment_status`);
  const statusByName = new Map(
    (statusRes as unknown as { rows: Array<{ id: string; name: string }> }).rows.map((r) => [
      r.name.toLowerCase(),
      r.id,
    ]),
  );
  const tidToStatusId = new Map<string, string>();
  const missingStatuses: string[] = [];
  for (const [tid, name] of Object.entries(HOUR_TYPE_TID_TO_STATUS_NAME)) {
    const id = statusByName.get(name.toLowerCase());
    if (id) tidToStatusId.set(tid, id);
    else missingStatuses.push(name);
  }
  if (missingStatuses.length > 0) {
    throw new Error(
      `options_employment_status is missing required statuses: ${missingStatuses.join(", ")} — seed them before loading hours`,
    );
  }

  // throttle per-row storage-op logging + heartbeat (aggregates only —
  // staged payperiod rows consumed / elapsed / rate; flush phases are the
  // silent write+verify stretches).
  throttleStorageOpLogs();
  const progress = makeProgressLogger("t20-hours", await stagedCountOf("sirius_payperiod"));
  progress.phase("pre-scan");

  // ---- parse & validate (keyset-paged staged read — Track C: production
  // payperiod JSON payloads never all materialize in memory at once) ----
  let stagedCount = 0;
  const skips: Record<string, number> = {};
  const skipNids: Record<string, number[]> = {}; // ≤20 sample nids per reason (counts stay exact)
  const skip = (reason: string, nid: number) => {
    skips[reason] = (skips[reason] ?? 0) + 1;
    const arr = (skipNids[reason] ??= []);
    if (arr.length < 20) arr.push(nid);
  };
  const provenanceCounts: Record<string, number> = {};
  const hourTypeCounts: Record<string, number> = {};
  let negativeHours = 0;
  let boundarySpanning = 0;

  // ---- aggregate per (worker, employer, year, month), worker-ordered.
  // Track C: the staged read streams ordered by (worker_key, nid) via an
  // expression index, so a worker's month-groups are COMPLETE the moment the
  // stream reaches the next worker and are flushed (resolved + written +
  // verified) immediately. Memory is bounded by one worker's groups plus one
  // flush buffer — never by total month-group cardinality.
  interface Group {
    workerNid: number;
    employerNid: number;
    year: number;
    month: number;
    hours: number;
    tids: Set<string>;
    latest: ParsedRow;
  }
  const groups = new Map<string, Group>(); // current worker's groups only
  let parsedCount = 0;
  const addToGroup = (p: ParsedRow) => {
    parsedCount++;
    const key = `${p.workerNid}|${p.employerNid}|${p.year}|${p.month}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        workerNid: p.workerNid,
        employerNid: p.employerNid,
        year: p.year,
        month: p.month,
        hours: p.hours,
        tids: new Set([p.hourTypeTid]),
        latest: p,
      });
    } else {
      g.hours += p.hours;
      g.tids.add(p.hourTypeTid);
      if (
        p.dateStart > g.latest.dateStart ||
        (p.dateStart === g.latest.dateStart && p.nid > g.latest.nid)
      ) {
        g.latest = p; // status = most recent payperiod's hour type (§4.8a)
      }
    }
  };

  // ---- flush machinery (bounded write/verify batches) ----
  let monthGroups = 0;
  let multiStatusMonths = 0;
  let written = 0;
  let verified = 0;
  let unresolvedWorker = 0;
  let unresolvedEmployer = 0;
  // Distinct unresolved refs + ≤20 sample nids per side (counts stay exact) —
  // aggregates and opaque S1 nids only, same disclosure rule as skipNids.
  const unresolvedWorkerNids = new Set<number>();
  const unresolvedWorkerSamples: number[] = [];
  const unresolvedEmployerNids = new Set<number>();
  const unresolvedEmployerSamples: number[] = [];
  let stubbedWorkers = 0;
  let stubbedEmployers = 0;
  let verifyMismatchCount = 0;
  const verifyMismatchSamples: string[] = []; // ≤20 samples; count stays exact
  // employer cache is global (distinct employers are few); worker mappings are per-flush.
  const employerMap = new Map<number, { s2Id: string; stub: boolean }>();
  const employerSeen = new Set<number>();

  const stagedTitle = async (bundle: string, nid: number): Promise<string | null> => {
    const res = await db.execute(sql`
      SELECT title FROM s1_staging.records WHERE bundle = ${bundle} AND nid = ${nid}
    `);
    return (res as unknown as { rows: Array<{ title: string | null }> }).rows[0]?.title ?? null;
  };

  const flush = async (batch: Group[]): Promise<void> => {
    if (batch.length === 0) return;
    progress.phase("flush"); // liveness during the write+verify stretch
    monthGroups += batch.length;
    for (const g of batch) if (g.tids.size > 1) multiStatusMonths++;

    // resolve references through id_map (batched per flush)
    const workerNids = [...new Set(batch.map((g) => g.workerNid))];
    const workerMap = await getMappings("worker", workerNids);
    const newEmployers = [...new Set(batch.map((g) => g.employerNid))].filter((n) => !employerSeen.has(n));
    if (newEmployers.length > 0) {
      for (const [nid, v] of await getMappings("employer", newEmployers)) employerMap.set(nid, v);
      for (const n of newEmployers) employerSeen.add(n);
    }

    if (STUB_MISSING && !DRY_RUN) {
      for (const nid of workerNids) {
        if (workerMap.has(nid)) continue;
        const name = (await stagedTitle("sirius_worker", nid)) ?? `S1 worker ${nid}`;
        const worker = await loaderScope(() => storage.workers.createWorker(name));
        const winner = await putMapping("worker", nid, worker.id, { stub: true, loader: "t20-hours" });
        if (winner !== worker.id) {
          console.error(`RACE: worker nid ${nid} already mapped; created S2 worker ${worker.id} is an ORPHAN — clean up manually`);
        }
        workerMap.set(nid, { s2Id: winner, stub: true, consumedFingerprint: null, logicVersion: null, lastSyncedAt: null, s1DeletedAt: null });
        stubbedWorkers++;
      }
      for (const nid of new Set(batch.map((g) => g.employerNid))) {
        if (employerMap.has(nid)) continue;
        const name = (await stagedTitle("grievance_shop", nid)) ?? `S1 employer ${nid}`;
        const employer = await loaderScope(() => storage.employers.createEmployer({ name }));
        const winner = await putMapping("employer", nid, employer.id, { stub: true, loader: "t20-hours" });
        if (winner !== employer.id) {
          console.error(`RACE: employer nid ${nid} already mapped; created S2 employer ${employer.id} is an ORPHAN — clean up manually`);
        }
        employerMap.set(nid, { s2Id: winner, stub: true });
        stubbedEmployers++;
      }
    }

    // write through storage, notifications suppressed
    const writtenKeys: Array<{ workerId: string; employerId: string; year: number; month: number; hours: number }> = [];
    for (const g of batch) {
      const worker = workerMap.get(g.workerNid);
      const employer = employerMap.get(g.employerNid);
      if (!worker) {
        unresolvedWorker++;
        if (!unresolvedWorkerNids.has(g.workerNid)) {
          unresolvedWorkerNids.add(g.workerNid);
          if (unresolvedWorkerSamples.length < 20) unresolvedWorkerSamples.push(g.workerNid);
        }
        continue;
      }
      if (!employer) {
        unresolvedEmployer++;
        if (!unresolvedEmployerNids.has(g.employerNid)) {
          unresolvedEmployerNids.add(g.employerNid);
          if (unresolvedEmployerSamples.length < 20) unresolvedEmployerSamples.push(g.employerNid);
        }
        continue;
      }
      if (DRY_RUN) {
        written++;
        continue;
      }
      const result = await loaderScope(() =>
        storage.workerHours.upsertWorkerHours({
          workerId: worker.s2Id,
          employerId: employer.s2Id,
          year: g.year,
          month: g.month,
          employmentStatusId: tidToStatusId.get(g.latest.hourTypeTid)!,
          hours: g.hours,
        }),
      );
      if (!result.data) {
        throw new Error(
          `upsertWorkerHours returned no row for S1 worker nid ${g.workerNid} ${g.year}-${g.month} — aborting (nothing is silently dropped)`,
        );
      }
      writtenKeys.push({ workerId: worker.s2Id, employerId: employer.s2Id, year: g.year, month: g.month, hours: g.hours });
      written++;
    }

    // stamp the sidecar for every key this run wrote — right after the
    // writes, independent of verify (desiredness ≠ verify success; a
    // verify-failed run never reaches the stale cleanup anyway).
    if (!DRY_RUN && writtenKeys.length > 0) {
      await upsertHoursKeys(writtenKeys.map((k) => ({ workerId: k.workerId, employerId: k.employerId, year: k.year, month: k.month })));
    }

    // verify: re-read every written key and compare hours exactly
    if (!DRY_RUN) {
      for (let i = 0; i < writtenKeys.length; i += 200) {
        const chunk = writtenKeys.slice(i, i + 200);
        const conditions = chunk.map(
          (k) =>
            sql`(worker_id = ${k.workerId} AND employer_id = ${k.employerId} AND year = ${k.year} AND month = ${k.month} AND day = 1)`,
        );
        const res = await db.execute(sql`
          SELECT worker_id, employer_id, year, month, hours FROM worker_hours
           WHERE ${sql.join(conditions, sql` OR `)}
        `);
        const found = new Map(
          (res as unknown as { rows: Array<{ worker_id: string; employer_id: string; year: number; month: number; hours: number | null }> }).rows.map(
            (r) => [`${r.worker_id}|${r.employer_id}|${r.year}|${r.month}`, r.hours],
          ),
        );
        for (const k of chunk) {
          const hours = found.get(`${k.workerId}|${k.employerId}|${k.year}|${k.month}`);
          if (hours != null && Math.abs(hours - k.hours) < 1e-9) verified++;
          else {
            verifyMismatchCount++;
            if (verifyMismatchSamples.length < 20)
              verifyMismatchSamples.push(`${k.year}-${String(k.month).padStart(2, "0")}`);
          }
        }
      }
    }
    progress.phase(null);
  };

  // ---- worker-ordered keyset paging over staged payperiods ----
  // Expression must match the index exactly; -1 buckets unparseable refs
  // (they all skip as missing_worker_ref) so the sort key is total.
  const WORKER_KEY_EXPR = sql`
    CASE
      WHEN jsonb_typeof(fields->'field_sirius_worker') = 'number'
        THEN (fields->>'field_sirius_worker')::bigint
      WHEN jsonb_typeof(fields->'field_sirius_worker') = 'array'
       AND jsonb_typeof(fields->'field_sirius_worker'->0) = 'number'
        THEN (fields->'field_sirius_worker'->>0)::bigint
      WHEN fields->>'field_sirius_worker' ~ '^[0-9]+$'
        THEN (fields->>'field_sirius_worker')::bigint
      ELSE '-1'::bigint
    END`;
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS records_payperiod_worker_nid_idx
      ON s1_staging.records ((${WORKER_KEY_EXPR}), nid)
      WHERE bundle = 'sirius_payperiod'
  `);
  progress.phase(null);

  const FLUSH_AT = 1000; // groups buffered across finished workers before a write flush
  let pending: Group[] = [];
  let currentWorkerKey: number | null = null;
  let lastKey = Number.MIN_SAFE_INTEGER;
  let lastNid = -1;
  for (;;) {
    const staged = await db.execute(sql`
      SELECT nid, title, fields, (${WORKER_KEY_EXPR}) AS worker_key FROM s1_staging.records
       WHERE bundle = 'sirius_payperiod' AND ((${WORKER_KEY_EXPR}), nid) > (${lastKey}, ${lastNid})
       ORDER BY (${WORKER_KEY_EXPR}), nid LIMIT ${LOADER_PAGE_SIZE}
    `);
    const rows = (staged as unknown as { rows: Array<StagedPayperiod & { worker_key: string | number }> }).rows.map((r) => ({
      ...r,
      nid: Number(r.nid),
      worker_key: Number(r.worker_key),
      fields: typeof r.fields === "string" ? JSON.parse(r.fields as unknown as string) : r.fields,
    }));
    if (rows.length === 0) break;
    lastKey = rows[rows.length - 1].worker_key;
    lastNid = rows[rows.length - 1].nid;
    stagedCount += rows.length;
    progress.update(stagedCount);

    for (const r of rows) {
    // Worker boundary: this worker's groups are complete — move to the flush buffer.
    if (currentWorkerKey !== null && r.worker_key !== currentWorkerKey) {
      pending.push(...groups.values());
      groups.clear();
      if (pending.length >= FLUSH_AT) {
        await flush(pending);
        pending = [];
      }
    }
    currentWorkerKey = r.worker_key;
    // Production stages this field as an object ({value, json_denorm_external_id}
    // — two payload columns, confirmed in profile/columns.tsv); tolerate a
    // scalar-staged shape too (single-column environments stage the value bare).
    const jsonField = r.fields["field_sirius_json"] as
      | { value?: unknown }
      | string
      | undefined;
    let json: any =
      typeof jsonField === "object" && jsonField !== null && "value" in jsonField
        ? jsonField.value
        : jsonField;
    if (typeof json === "string") {
      try {
        json = JSON.parse(json);
      } catch {
        skip("unparseable_json", r.nid);
        continue;
      }
    }
    if (!json || typeof json !== "object") {
      skip("missing_json", r.nid);
      continue;
    }
    if (Array.isArray(json.entries)) {
      // N18 legacy format — documented skip, never silently dropped.
      skip("legacy_json_format", r.nid);
      continue;
    }
    const total = json?.totals?.hours?.total;
    if (typeof total !== "number" || !Number.isFinite(total)) {
      skip("missing_hours_total", r.nid);
      continue;
    }
    const byType = json?.totals?.hours?.by_type;
    const typeKeys = byType && typeof byType === "object" ? Object.keys(byType) : [];
    if (typeKeys.length === 0) {
      skip("missing_hour_type", r.nid);
      continue;
    }
    if (typeKeys.length > 1) {
      skip("multi_hour_type", r.nid);
      continue;
    }
    const tid = typeKeys[0];
    if (!tidToStatusId.has(tid)) {
      skip(`unknown_hour_type_tid_${tid}`, r.nid);
      continue;
    }
    const workerNid = asScalarRef(r.fields["field_sirius_worker"]);
    const employerNid = asScalarRef(r.fields["field_grievance_shop"]);
    if (workerNid == null) {
      skip("missing_worker_ref", r.nid);
      continue;
    }
    if (employerNid == null) {
      skip("missing_employer_ref", r.nid);
      continue;
    }
    const start = yearMonthOf(r.fields["field_sirius_date_start"]);
    if (!start) {
      skip("missing_date_start", r.nid);
      continue;
    }
    const end = yearMonthOf(r.fields["field_sirius_date_end"]);
    if (end && end.ym !== start.ym) boundarySpanning++; // OPEN-5 CLOSED — tripwire, prod expects 0
    if (total < 0) negativeHours++; // OPEN-3 CLOSED — import as-is (ruled 2026-08-05), counted

    const entries = json?.entries;
    if (entries && typeof entries === "object") {
      for (const k of Object.keys(entries)) {
        const key = /^\d+$/.test(k) ? "nid_keyed" : k; // unknown keys are valid (open enum)
        provenanceCounts[key] = (provenanceCounts[key] ?? 0) + 1;
      }
    }
    hourTypeCounts[tid] = (hourTypeCounts[tid] ?? 0) + 1;

    addToGroup({
      nid: r.nid,
      workerNid,
      employerNid,
      year: start.year,
      month: start.month,
      dateStart: String(r.fields["field_sirius_date_start"]),
      hours: Number(total), // ALWAYS decimal — doublePrecision column
      hourTypeTid: tid,
    });
    }
    if (rows.length < LOADER_PAGE_SIZE) break;
  }
  // final worker + buffer
  pending.push(...groups.values());
  groups.clear();
  await flush(pending);
  pending = [];

  // ---- stale-key cleanup (SYNC, header): keys not stamped this run lost
  // their staged payperiods (deleted or retargeted in S1) — delete the
  // day=1 worker_hours row through storage and drop the key. Gated on a
  // fully-verified run: a run that failed verify (or wrote nothing it could
  // verify) must not treat its own gaps as S1 deletions. ----
  let staleKeys = 0;
  let staleDeleted = 0;
  let staleAlreadyGone = 0;
  let staleDeleteFailed = 0;
  let cleanupSkipped: string | null = null;
  if (DRY_RUN) {
    cleanupSkipped = "dry_run";
  } else if (verifyMismatchCount > 0 || written !== verified) {
    cleanupSkipped = "verify_failed";
  } else {
    progress.phase("stale-cleanup");
    for await (const batch of pagedStaleHoursKeys(watermark, 500)) {
      staleKeys += batch.length;
      const processed: HoursKey[] = [];
      for (const rows of chunk(batch, 200)) {
        const conditions = rows.map(
          (k) =>
            sql`(worker_id = ${k.workerId} AND employer_id = ${k.employerId} AND year = ${k.year} AND month = ${k.month} AND day = 1)`,
        );
        const res = await db.execute(sql`
          SELECT id, worker_id, employer_id, year, month FROM worker_hours
           WHERE ${sql.join(conditions, sql` OR `)}
        `);
        const found = new Map(
          (res as unknown as { rows: Array<{ id: string; worker_id: string; employer_id: string; year: number; month: number }> }).rows.map(
            (r) => [`${r.worker_id}|${r.employer_id}|${r.year}|${r.month}`, r.id],
          ),
        );
        for (const k of rows) {
          const rowId = found.get(`${k.workerId}|${k.employerId}|${k.year}|${k.month}`);
          if (!rowId) {
            staleAlreadyGone++;
            processed.push(k);
            continue;
          }
          try {
            const del = await loaderScope(() => storage.workerHours.deleteWorkerHours(rowId));
            if (del.success) {
              staleDeleted++;
              processed.push(k);
            } else {
              staleDeleteFailed++; // key kept — retried next run
            }
          } catch {
            staleDeleteFailed++; // key kept — retried next run
          }
        }
      }
      if (processed.length > 0) await deleteHoursKeys(processed);
    }
    progress.phase(null);
  }
  progress.stop();

  const report = {
    loader: "t20-hours",
    dryRun: DRY_RUN,
    migrationMode: MIGRATION_MODE,
    stagedPayperiods: stagedCount,
    parsed: parsedCount,
    skips,
    // Only nids (opaque ids) — never values. legacy_json_format nids are the
    // N18 documented-skip requirement.
    skipNids: Object.fromEntries(
      Object.entries(skipNids).map(([k, v]) => [k, v.slice(0, 20)]),
    ),
    monthGroups,
    written,
    verified,
    verifyMismatchCount,
    verifyMismatchMonths: verifyMismatchSamples,
    unresolvedWorker,
    unresolvedEmployer,
    // Triage inputs (07-prod-query-pack §P7): distinct S1 nids behind the
    // month-group counts above, plus ≤20 sample nids each (opaque ids only).
    unresolvedWorkerDistinctNids: unresolvedWorkerNids.size,
    unresolvedWorkerSampleNids: unresolvedWorkerSamples,
    unresolvedEmployerDistinctNids: unresolvedEmployerNids.size,
    unresolvedEmployerSampleNids: unresolvedEmployerSamples,
    stubbedWorkers,
    stubbedEmployers,
    negativeHours_OPEN3: negativeHours,
    boundarySpanningPeriods_OPEN5: boundarySpanning,
    multiStatusMonths,
    provenanceCounts,
    hourTypeCounts,
    adoptedKeys,
    staleHoursCleanup: cleanupSkipped
      ? { skipped: cleanupSkipped }
      : { staleKeys, deletedRows: staleDeleted, alreadyGone: staleAlreadyGone, deleteFailed: staleDeleteFailed },
  };

  // Envelope (RUNBOOK §10): upserts cannot split create vs update, so all
  // writes report as `updated`; skips are documented data-shape exclusions,
  // not gate-relevant rejects (no RejectLog → reject gate passes trivially).
  const summary = emptySummary();
  summary.updated = written;
  summary.deleted = staleDeleted;
  const verifyFailures =
    verifyMismatchCount + (!DRY_RUN && written !== verified && verifyMismatchCount === 0 ? 1 : 0) + staleDeleteFailed;
  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: false, // no fingerprint fast path exists for hours — every run re-aggregates
    summary,
    verifyFailures,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) {
    await recordRun(
      startedAt,
      { loader: LOADER, stubMissing: STUB_MISSING, migrationMode: MIGRATION_MODE, adoptHoursKeys: ADOPT_HOURS_KEYS },
      result as unknown as Record<string, unknown>,
    );
  }

  if (!DRY_RUN && (verifyMismatchCount > 0 || written !== verified)) {
    console.error(`VERIFY FAILED: wrote ${written}, verified ${verified}`);
  }
  if (staleDeleteFailed > 0) {
    console.error(`STALE CLEANUP: ${staleDeleteFailed} row deletion(s) failed — keys kept for retry next run.`);
  }
  const unresolved = unresolvedWorker + unresolvedEmployer;
  if (unresolved > 0) {
    console.error(
      `NOTE: ${unresolved} month-groups skipped on unresolved references — run worker/employer loaders (or --stub-missing in dev) and re-run.`,
    );
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
