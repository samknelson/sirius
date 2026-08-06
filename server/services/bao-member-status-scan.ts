import { storage } from "../storage";
import { logger } from "../logger";
import { getClient } from "../storage/transaction-context";
import { sql } from "drizzle-orm";

/**
 * BAO member status scan.
 *
 * Automatically assigns hours-based member statuses for BAO workers, leaving
 * manually-managed statuses untouched:
 *
 * - **Event Center Worker - 100 hours** (code `EC100`): set as of the date of
 *   a worker's first hours with an employer in the Event Center industry, when
 *   the worker has NO status in that industry yet.
 * - **Event Center Worker - 80 hours** (code `EC80`): upgrade from the
 *   100-hour status once 5 years have passed since that first-hours date, only
 *   if the worker is still employed (their latest hours record carries an
 *   employed employment status).
 * - **UNITE HERE Worker - 60 hours** (code `H60`): set as of the date of a
 *   worker's first hours with an employer in the Hospitality industry, when
 *   the worker has NO status in that industry yet.
 *
 * The scan only ever SETS those three statuses. It never removes or overwrites
 * the manually-managed ones — Event Center Worker - 60 hours (`EC60`,
 * grandfathered), PA Worker (`P100`), UNITE HERE Worker - 40 Hours (`H40`) —
 * if a worker currently holds one of those in the relevant industry, the scan
 * leaves them alone. Each target industry is derived from the status option's
 * own industry link, never from hardcoded industry names.
 *
 * Writes go through `storage.workerMsh` with `data.source = "auto-scan"`, so
 * denorm recomputes and events fire normally.
 */

/** Auto-managed status codes (the scan sets these). */
const AUTO_CODES = ["EC100", "EC80", "H60"] as const;
/** Manually-managed status codes (the scan never touches holders of these). */
const MANUAL_CODES = ["EC60", "P100", "H40"] as const;

const FIVE_YEARS = 5;

export interface BaoScanResult {
  workersScanned: number;
  ec100Set: number;
  ec80Upgraded: number;
  h60Set: number;
  skippedManual: number;
  alreadyCurrent: number;
  errors: number;
  /** Test-mode detail: what would change, per worker. */
  pending: Array<{ workerId: string; industry: string; code: string; date: string }>;
}

interface StatusOption {
  id: string;
  code: string;
  industryId: string;
}

async function loadStatusOptions(): Promise<Map<string, StatusOption>> {
  const client = getClient();
  const codes = [...AUTO_CODES, ...MANUAL_CODES];
  const res = await client.execute(sql`
    SELECT id, code, industry_id
    FROM options_worker_ms
    WHERE code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
  `);
  const map = new Map<string, StatusOption>();
  for (const row of res.rows as any[]) {
    map.set(row.code, { id: row.id, code: row.code, industryId: row.industry_id });
  }
  return map;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Add N years to a YYYY-MM-DD string (Feb 29 clamps to Feb 28). */
function addYears(dateYmd: string, years: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  // Date rollover (Feb 29 -> Mar 1) clamps back to the last day of Feb.
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().split("T")[0];
}

export async function scanBaoMemberStatuses(mode: "live" | "test"): Promise<BaoScanResult> {
  const options = await loadStatusOptions();

  const ec100 = options.get("EC100");
  const ec80 = options.get("EC80");
  const h60 = options.get("H60");
  if (!ec100 || !ec80 || !h60) {
    throw new Error(
      "BAO member status configuration incomplete: missing status option(s) " +
        AUTO_CODES.filter((c) => !options.get(c)).join(", "),
    );
  }
  if (ec80.industryId !== ec100.industryId) {
    throw new Error("EC100 and EC80 status options are linked to different industries");
  }

  // Target industries, derived from the auto-managed options themselves.
  const ecIndustryId = ec100.industryId;
  const hIndustryId = h60.industryId;

  // Manually-managed status ids present in this deployment (some codes may
  // legitimately be absent, e.g. H40 on older option sets).
  const manualMsIds = new Set(
    MANUAL_CODES.map((c) => options.get(c)?.id).filter((id): id is string => !!id),
  );

  const client = getClient();

  // First hours date per (worker, target industry): earliest hours row with
  // positive hours at an employer linked to that industry.
  const firstHoursRes = await client.execute(sql`
    SELECT wh.worker_id, e.industry_id,
           MIN(make_date(wh.year, wh.month, wh.day)) AS first_date
    FROM worker_hours wh
    INNER JOIN employers e ON e.id = wh.employer_id
    WHERE e.industry_id IN (${ecIndustryId}, ${hIndustryId})
      AND wh.hours IS NOT NULL AND wh.hours > 0
    GROUP BY wh.worker_id, e.industry_id
  `);
  // workerId -> industryId -> first-hours YYYY-MM-DD
  const firstHours = new Map<string, Map<string, string>>();
  for (const row of firstHoursRes.rows as any[]) {
    let byIndustry = firstHours.get(row.worker_id);
    if (!byIndustry) firstHours.set(row.worker_id, (byIndustry = new Map()));
    byIndustry.set(row.industry_id, String(row.first_date).split("T")[0]);
  }

  // Current member status per (worker, target industry) — same latest-entry
  // tie-breaking the worker_msh storage uses.
  const currentRes = await client.execute(sql`
    SELECT DISTINCT ON (worker_id, industry_id) worker_id, industry_id, ms_id
    FROM worker_msh
    WHERE industry_id IN (${ecIndustryId}, ${hIndustryId})
    ORDER BY worker_id, industry_id, date DESC, created_at DESC NULLS LAST, id DESC
  `);
  const currentMs = new Map<string, string>(); // `${workerId}:${industryId}` -> msId
  for (const row of currentRes.rows as any[]) {
    currentMs.set(`${row.worker_id}:${row.industry_id}`, row.ms_id);
  }

  // Still-employed flag: the worker's latest hours record (across employers)
  // carries an employed employment status.
  const employedRes = await client.execute(sql`
    SELECT latest.worker_id, es.employed
    FROM (
      SELECT DISTINCT ON (worker_id) worker_id, employment_status_id
      FROM worker_hours
      ORDER BY worker_id, year DESC, month DESC, day DESC
    ) latest
    INNER JOIN options_employment_status es ON es.id = latest.employment_status_id
  `);
  const stillEmployed = new Set<string>();
  for (const row of employedRes.rows as any[]) {
    if (row.employed === true) stillEmployed.add(row.worker_id);
  }

  const today = new Date().toISOString().split("T")[0];

  const result: BaoScanResult = {
    workersScanned: firstHours.size,
    ec100Set: 0,
    ec80Upgraded: 0,
    h60Set: 0,
    skippedManual: 0,
    alreadyCurrent: 0,
    errors: 0,
    pending: [],
  };

  async function setStatus(
    workerId: string,
    industryId: string,
    industryLabel: string,
    option: StatusOption,
    date: string,
  ): Promise<void> {
    if (mode === "test") {
      result.pending.push({ workerId, industry: industryLabel, code: option.code, date });
      return;
    }
    await storage.workerMsh.createWorkerMsh({
      workerId,
      date,
      msId: option.id,
      industryId,
      data: { source: "auto-scan" },
    });
  }

  for (const [workerId, byIndustry] of firstHours) {
    try {
      // --- Event Center industry ---
      const ecFirst = byIndustry.get(ecIndustryId);
      if (ecFirst) {
        const current = currentMs.get(`${workerId}:${ecIndustryId}`) ?? null;
        const anniversary = addYears(ecFirst, FIVE_YEARS);
        const upgradeDue = anniversary <= today && stillEmployed.has(workerId);

        if (current && manualMsIds.has(current)) {
          result.skippedManual++;
        } else if (current === null) {
          await setStatus(workerId, ecIndustryId, "Event Center", ec100, ecFirst);
          result.ec100Set++;
          if (upgradeDue) {
            await setStatus(workerId, ecIndustryId, "Event Center", ec80, anniversary);
            result.ec80Upgraded++;
          }
        } else if (current === ec100.id) {
          if (upgradeDue) {
            await setStatus(workerId, ecIndustryId, "Event Center", ec80, anniversary);
            result.ec80Upgraded++;
          } else {
            result.alreadyCurrent++;
          }
        } else {
          // EC80 or some other status the scan doesn't manage: leave alone.
          result.alreadyCurrent++;
        }
      }

      // --- Hospitality industry ---
      const hFirst = byIndustry.get(hIndustryId);
      if (hFirst) {
        const current = currentMs.get(`${workerId}:${hIndustryId}`) ?? null;
        if (current && manualMsIds.has(current)) {
          result.skippedManual++;
        } else if (current === null) {
          await setStatus(workerId, hIndustryId, "Hospitality", h60, hFirst);
          result.h60Set++;
        } else {
          result.alreadyCurrent++;
        }
      }
    } catch (error) {
      result.errors++;
      logger.error("Error scanning BAO worker member status", {
        service: "bao-member-status-scan",
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("BAO member status scan completed", {
    service: "bao-member-status-scan",
    mode,
    workersScanned: result.workersScanned,
    ec100Set: result.ec100Set,
    ec80Upgraded: result.ec80Upgraded,
    h60Set: result.h60Set,
    skippedManual: result.skippedManual,
    alreadyCurrent: result.alreadyCurrent,
    errors: result.errors,
  });

  return result;
}
