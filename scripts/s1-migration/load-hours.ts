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
 *   - month attribution: field_sirius_date_start's calendar month (OPEN-5 is
 *     pending — boundary-spanning periods are counted and surfaced in the run
 *     report, not guessed at)
 *   - negative hours totals load as-is and are counted (OPEN-3 pending)
 *   - $.entries keys are provenance — aggregated in the run report; row-level
 *     provenance stays derivable from staging (worker_hours has no data column)
 *   - multiple payperiods in one (worker, employer, month) SUM their hours;
 *     the employment status comes from the latest date_start (ties → higher
 *     nid); months mixing hour types are counted in the report
 *
 * Reference resolution goes through s1_staging.id_map. Until T4 (workers) and
 * T7 (employers) exist, `--stub-missing` creates minimal S2 rows through
 * storage (marked stub=true in id_map) so the pipeline verifies end-to-end in
 * dev. Without the flag, unresolved references are counted skips.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-hours.ts [--dry-run] [--stub-missing]
 *
 * Output is AGGREGATES ONLY (plus S1 nids, which are opaque ids) — safe inside
 * the HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";

const DRY_RUN = process.argv.includes("--dry-run");
const STUB_MISSING = process.argv.includes("--stub-missing");

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

  // ---- read staged payperiods ----
  const staged = await db.execute(sql`
    SELECT nid, title, fields FROM s1_staging.records
     WHERE bundle = 'sirius_payperiod' ORDER BY nid
  `);
  const rows = (staged as unknown as { rows: StagedPayperiod[] }).rows.map((r) => ({
    ...r,
    nid: Number(r.nid),
    fields: typeof r.fields === "string" ? JSON.parse(r.fields as unknown as string) : r.fields,
  }));

  // ---- parse & validate ----
  const skips: Record<string, number> = {};
  const skipNids: Record<string, number[]> = {};
  const skip = (reason: string, nid: number) => {
    skips[reason] = (skips[reason] ?? 0) + 1;
    (skipNids[reason] ??= []).push(nid);
  };
  const provenanceCounts: Record<string, number> = {};
  const hourTypeCounts: Record<string, number> = {};
  let negativeHours = 0;
  let boundarySpanning = 0;

  const parsed: ParsedRow[] = [];
  for (const r of rows) {
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
    if (end && end.ym !== start.ym) boundarySpanning++; // OPEN-5 — surfaced, not guessed
    if (total < 0) negativeHours++; // OPEN-3 — loaded as-is, surfaced

    const entries = json?.entries;
    if (entries && typeof entries === "object") {
      for (const k of Object.keys(entries)) {
        const key = /^\d+$/.test(k) ? "nid_keyed" : k; // unknown keys are valid (open enum)
        provenanceCounts[key] = (provenanceCounts[key] ?? 0) + 1;
      }
    }
    hourTypeCounts[tid] = (hourTypeCounts[tid] ?? 0) + 1;

    parsed.push({
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

  // ---- aggregate per (worker, employer, year, month) ----
  interface Group {
    workerNid: number;
    employerNid: number;
    year: number;
    month: number;
    hours: number;
    tids: Set<string>;
    latest: ParsedRow;
    sourceNids: number[];
  }
  const groups = new Map<string, Group>();
  for (const p of parsed) {
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
        sourceNids: [p.nid],
      });
    } else {
      g.hours += p.hours;
      g.tids.add(p.hourTypeTid);
      g.sourceNids.push(p.nid);
      if (
        p.dateStart > g.latest.dateStart ||
        (p.dateStart === g.latest.dateStart && p.nid > g.latest.nid)
      ) {
        g.latest = p; // status = most recent payperiod's hour type (§4.8a)
      }
    }
  }
  const multiStatusMonths = [...groups.values()].filter((g) => g.tids.size > 1).length;

  // ---- resolve references through id_map ----
  const workerNids = [...new Set([...groups.values()].map((g) => g.workerNid))];
  const employerNids = [...new Set([...groups.values()].map((g) => g.employerNid))];
  const workerMap = await getMappings("worker", workerNids);
  const employerMap = await getMappings("employer", employerNids);

  let stubbedWorkers = 0;
  let stubbedEmployers = 0;
  if (STUB_MISSING && !DRY_RUN) {
    const stagedTitle = async (bundle: string, nid: number): Promise<string | null> => {
      const res = await db.execute(sql`
        SELECT title FROM s1_staging.records WHERE bundle = ${bundle} AND nid = ${nid}
      `);
      return (res as unknown as { rows: Array<{ title: string | null }> }).rows[0]?.title ?? null;
    };
    for (const nid of workerNids) {
      if (workerMap.has(nid)) continue;
      const name = (await stagedTitle("sirius_worker", nid)) ?? `S1 worker ${nid}`;
      const worker = await withNotificationsSuppressed(() => storage.workers.createWorker(name));
      const winner = await putMapping("worker", nid, worker.id, { stub: true, loader: "t20-hours" });
      if (winner !== worker.id) {
        console.error(`RACE: worker nid ${nid} already mapped; created S2 worker ${worker.id} is an ORPHAN — clean up manually`);
      }
      workerMap.set(nid, { s2Id: winner, stub: true });
      stubbedWorkers++;
    }
    for (const nid of employerNids) {
      if (employerMap.has(nid)) continue;
      const name = (await stagedTitle("grievance_shop", nid)) ?? `S1 employer ${nid}`;
      const employer = await withNotificationsSuppressed(() =>
        storage.employers.createEmployer({ name }),
      );
      const winner = await putMapping("employer", nid, employer.id, { stub: true, loader: "t20-hours" });
      if (winner !== employer.id) {
        console.error(`RACE: employer nid ${nid} already mapped; created S2 employer ${employer.id} is an ORPHAN — clean up manually`);
      }
      employerMap.set(nid, { s2Id: winner, stub: true });
      stubbedEmployers++;
    }
  }

  // ---- write through storage, notifications suppressed ----
  let written = 0;
  let unresolvedWorker = 0;
  let unresolvedEmployer = 0;
  const writtenKeys: Array<{ workerId: string; employerId: string; year: number; month: number; hours: number }> = [];
  for (const g of groups.values()) {
    const worker = workerMap.get(g.workerNid);
    const employer = employerMap.get(g.employerNid);
    if (!worker) {
      unresolvedWorker++;
      continue;
    }
    if (!employer) {
      unresolvedEmployer++;
      continue;
    }
    if (DRY_RUN) {
      written++;
      continue;
    }
    const result = await withNotificationsSuppressed(() =>
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
    writtenKeys.push({
      workerId: worker.s2Id,
      employerId: employer.s2Id,
      year: g.year,
      month: g.month,
      hours: g.hours,
    });
    written++;
  }

  // ---- verify: re-read every written key and compare hours exactly ----
  let verified = 0;
  const mismatches: string[] = [];
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
        else mismatches.push(`${k.year}-${String(k.month).padStart(2, "0")}`);
      }
    }
  }

  const report = {
    loader: "t20-hours",
    dryRun: DRY_RUN,
    stagedPayperiods: rows.length,
    parsed: parsed.length,
    skips,
    // Only nids (opaque ids) — never values. legacy_json_format nids are the
    // N18 documented-skip requirement.
    skipNids: Object.fromEntries(
      Object.entries(skipNids).map(([k, v]) => [k, v.slice(0, 20)]),
    ),
    monthGroups: groups.size,
    written,
    verified,
    verifyMismatchMonths: mismatches.slice(0, 20),
    unresolvedWorker,
    unresolvedEmployer,
    stubbedWorkers,
    stubbedEmployers,
    negativeHours_OPEN3: negativeHours,
    boundarySpanningPeriods_OPEN5: boundarySpanning,
    multiStatusMonths,
    provenanceCounts,
    hourTypeCounts,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: "t20-hours", stubMissing: STUB_MISSING }, report);

  if (!DRY_RUN && (mismatches.length > 0 || written !== verified)) {
    console.error(`VERIFY FAILED: wrote ${written}, verified ${verified}`);
    process.exit(1);
  }
  const unresolved = unresolvedWorker + unresolvedEmployer;
  if (unresolved > 0) {
    console.error(
      `NOTE: ${unresolved} month-groups skipped on unresolved references — run worker/employer loaders (or --stub-missing in dev) and re-run.`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
