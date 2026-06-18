/**
 * One-off: verify the three outcomes of the "BAO - Threshold" trust
 * eligibility plugin
 * (server/plugins/trust/eligibility/plugins/sitespecific-bao-threshold.ts).
 *
 * The plugin examines exactly ONE month — the month three months before the
 * evaluated month — and compares that month's total hours to the worker's
 * resolved threshold. With its default, the threshold is 100 hours (the
 * employer used here has no industry, so the default-fallback path is taken).
 *
 * We evaluate as of April 2026, so the examined month is January 2026, and
 * create three clearly-labelled test workers:
 *   1. ABOVE   — 123 hrs in January 2026 (>= 100)         => ELIGIBLE.
 *   2. BELOW   — 80 hrs in January 2026  (<  100)         => INELIGIBLE.
 *   3. DEFAULT — exactly 100 hrs in January 2026, with no member-status
 *                threshold configured, so the default of 100 is applied and
 *                the boundary (meet-or-exceed) passes => ELIGIBLE via default.
 *
 * Everything goes through the storage layer (no raw SQL), as required by the
 * project rules. The script is idempotent:
 *   - workers are looked up by their unique display name and reused if present;
 *   - hours use upsertWorkerHours (ON CONFLICT) keyed on
 *     (worker, employer, year, month, day), so re-running overwrites the same
 *     rows instead of creating duplicates.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/verify-bao-threshold.ts
 */

import { storage } from "../../server/storage/database";
import { fetchThresholdStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-threshold";

// Known fixtures in this database (see `employers` / `options_employment_status`).
const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no industry => default threshold 100)
const EMPLOYMENT_STATUS_ID = "46487fff-698d-4031-b9da-1846a09ef986"; // Active

// Evaluate as of April 2026 => examined month is January 2026.
const AS_OF = { year: 2026, month: 4 };
const TARGET = { year: 2026, month: 1 };

interface Scenario {
  name: string;
  januaryHours: number;
  expectEligible: boolean;
}

const scenarios: Scenario[] = [
  { name: "[THRESHOLD TEST] Above", januaryHours: 123, expectEligible: true },
  { name: "[THRESHOLD TEST] Below", januaryHours: 80, expectEligible: false },
  { name: "[THRESHOLD TEST] Default boundary", januaryHours: 100, expectEligible: true },
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

    await storage.workerHours.upsertWorkerHours({
      workerId,
      employerId: EMPLOYER_ID,
      employmentStatusId: EMPLOYMENT_STATUS_ID,
      year: TARGET.year,
      month: TARGET.month,
      hours: scenario.januaryHours,
      home: true,
    });

    const status = await fetchThresholdStatus(workerId, AS_OF, {
      employerId: EMPLOYER_ID,
    });

    const lookbackOk =
      status.targetYear === TARGET.year && status.targetMonth === TARGET.month;
    // TEST HOTEL has no industry, so the default threshold (100) must be used.
    const defaultOk = status.thresholdResolved === false && status.threshold === 100;
    const eligibleOk = status.success === scenario.expectEligible;
    const ok = lookbackOk && defaultOk && eligibleOk;
    if (!ok) failures++;

    console.log("");
    console.log(`${scenario.name}  (worker ${workerId})`);
    console.log(`  examined month : ${status.targetMonth}/${status.targetYear} (expected 1/2026)`);
    console.log(`  threshold      : ${status.threshold} (resolved=${status.thresholdResolved})`);
    console.log(`  hours found    : ${status.hours}`);
    console.log(`  eligible       : ${status.success} (expected ${scenario.expectEligible})`);
    console.log(`  reason         : ${status.reason}`);
    console.log(`  result         : ${ok ? "OK" : "MISMATCH"}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} scenario(s) did not match expectations.`);
    process.exit(1);
  }
  console.log("All BAO threshold scenarios produced the expected outcome.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
