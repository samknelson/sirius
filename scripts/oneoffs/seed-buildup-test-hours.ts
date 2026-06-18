/**
 * One-off: seed worker_hours rows that exercise the three outcomes of the
 * "BAO - Buildup" trust eligibility plugin
 * (server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup.ts).
 *
 * The plugin (with its defaults) decides eligibility by walking a worker's
 * monthly hours backward from the benefit month:
 *   - threshold      = 100 hours / month (employers here have no industry, so
 *                      the default threshold is used)
 *   - buildupMonths  = 3   (3 consecutive months >= threshold => ELIGIBLE)
 *   - breakMonths    = 12  (12 consecutive months <  threshold => INELIGIBLE)
 *
 * We create three clearly-labelled test workers, each demonstrating one
 * outcome when evaluated as an election (benefit month = as-of month) for
 * June 2026:
 *   1. SUCCEED — 3 straight months at/above threshold => buildup complete.
 *   2. FAIL    — hours that never reach a 3-month buildup and never reach a
 *                12-month break => "No completed buildup".
 *   3. BREAK   — 12 straight months below threshold => "Break complete".
 *
 * Everything goes through the storage layer (no raw SQL), as required by the
 * project rules. The script is idempotent:
 *   - workers are looked up by their unique display name and reused if present;
 *   - hours use upsertWorkerHours (ON CONFLICT) keyed on
 *     (worker, employer, year, month, day), so re-running overwrites the same
 *     rows instead of creating duplicates.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/seed-buildup-test-hours.ts
 */

import { storage } from "../../server/storage/database";
import { fetchBuildupStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup";

// Known fixtures in this database (see `employers` / `options_employment_status`).
const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no industry => default threshold 100)
const EMPLOYMENT_STATUS_ID = "46487fff-698d-4031-b9da-1846a09ef986"; // Active

// Evaluate as an election for June 2026 (benefit month = as-of month).
const AS_OF = { year: 2026, month: 6 };

type MonthHours = { year: number; month: number; hours: number };

/** Build a descending run of months ending at (and including) `end`. */
function monthsBack(
  end: { year: number; month: number },
  count: number,
  hours: number,
): MonthHours[] {
  const out: MonthHours[] = [];
  let ord = end.year * 12 + (end.month - 1);
  for (let i = 0; i < count; i++) {
    out.push({ year: Math.floor(ord / 12), month: (ord % 12) + 1, hours });
    ord--;
  }
  return out;
}

interface Scenario {
  name: string;
  expectSuccess: boolean;
  expectReasonIncludes: string;
  hours: MonthHours[];
}

const scenarios: Scenario[] = [
  {
    name: "[BUILDUP TEST] Succeed",
    expectSuccess: true,
    expectReasonIncludes: "Buildup complete",
    // Apr/May/Jun 2026 all at/above the 100-hour threshold => buildup complete.
    hours: [
      { year: 2026, month: 4, hours: 160 },
      { year: 2026, month: 5, hours: 168 },
      { year: 2026, month: 6, hours: 152 },
    ],
  },
  {
    name: "[BUILDUP TEST] Fail",
    expectSuccess: false,
    expectReasonIncludes: "No completed buildup",
    // Alternating high/low: never 3 consecutive >= threshold, never 12 below.
    hours: [
      { year: 2026, month: 6, hours: 160 },
      { year: 2026, month: 5, hours: 40 },
      { year: 2026, month: 4, hours: 150 },
      { year: 2026, month: 3, hours: 35 },
      { year: 2026, month: 2, hours: 165 },
      { year: 2026, month: 1, hours: 45 },
    ],
  },
  {
    name: "[BUILDUP TEST] Break",
    expectSuccess: false,
    expectReasonIncludes: "Break complete",
    // 12 consecutive months below threshold (Jul 2025 .. Jun 2026) => break.
    hours: monthsBack({ year: 2026, month: 6 }, 12, 20),
  },
];

async function findOrCreateWorker(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact.id;
  const created = await storage.workers.createWorker(name);
  return created.id;
}

async function main(): Promise<void> {
  let failures = 0;

  for (const scenario of scenarios) {
    const workerId = await findOrCreateWorker(scenario.name);

    for (const h of scenario.hours) {
      await storage.workerHours.upsertWorkerHours({
        workerId,
        employerId: EMPLOYER_ID,
        employmentStatusId: EMPLOYMENT_STATUS_ID,
        year: h.year,
        month: h.month,
        hours: h.hours,
        home: true,
      });
    }

    const status = await fetchBuildupStatus(workerId, AS_OF, {
      isElection: true,
      employerId: EMPLOYER_ID,
    });

    const ok =
      status.success === scenario.expectSuccess &&
      status.reason.includes(scenario.expectReasonIncludes);
    if (!ok) failures++;

    console.log("");
    console.log(`${scenario.name}  (worker ${workerId})`);
    console.log(`  months seeded : ${scenario.hours.length}`);
    console.log(`  threshold     : ${status.threshold}`);
    console.log(`  eligible      : ${status.success} (expected ${scenario.expectSuccess})`);
    console.log(`  reason        : ${status.reason}`);
    console.log(`  result        : ${ok ? "OK" : "MISMATCH"}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} scenario(s) did not match expectations.`);
    process.exit(1);
  }
  console.log("All buildup scenarios produced the expected outcome.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
