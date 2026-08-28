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
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { fetchThresholdStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-threshold";

// Fixtures are resolved (or created) by name so the script works on any
// database: an industry-less employer forces the default-threshold path.
const EMPLOYER_NAME = "[THRESHOLD TEST] Employer (no industry)";

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

  // Industry-less employer => resolveBaoThreshold falls back to the default.
  const employers = await storage.employers.searchEmployers?.(EMPLOYER_NAME).catch(() => undefined);
  let employerId =
    (Array.isArray(employers) ? employers.find((e: any) => e.name === EMPLOYER_NAME)?.id : undefined) ??
    (await storage.employers.getAllEmployers()).find((e: any) => e.name === EMPLOYER_NAME)?.id;
  if (!employerId) {
    employerId = (await storage.employers.createEmployer({ name: EMPLOYER_NAME } as any)).id;
  }

  const options = createUnifiedOptionsStorage();
  const statuses = (await options.list("employment-status")) as Array<{ id: string; name: string }>;
  const employmentStatusId = (
    statuses.find((s) => s.name.toLowerCase() === "active") ?? statuses[0]
  )?.id;
  if (!employmentStatusId) throw new Error("no options_employment_status rows — seed the database first");

  for (const scenario of scenarios) {
    const workerId = await findOrCreateWorker(scenario.name);

    await storage.workerHours.upsertWorkerHours({
      workerId,
      employerId,
      employmentStatusId,
      year: TARGET.year,
      month: TARGET.month,
      hours: scenario.januaryHours,
      home: true,
    });

    const status = await fetchThresholdStatus(workerId, AS_OF, {
      employerId,
    });

    const lookbackOk =
      status.targetYear === TARGET.year && status.targetMonth === TARGET.month;
    // The fixture employer has no industry, so the default threshold (100) must be used.
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
