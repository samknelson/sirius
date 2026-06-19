/**
 * One-off: verify the configurable buildup lag in the "BAO - Buildup" trust
 * eligibility plugin
 * (server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup.ts).
 *
 * Rule under test: 3 consecutive qualifying months, then coverage begins on
 * the 6th month. With lagMonths = 3 (the default), qualifying in Jan/Feb/Mar
 * means:
 *   - coverage month JUNE  (lag 3 -> benefit month March) => ELIGIBLE
 *   - coverage month MAY   (lag 3 -> benefit month Feb)   => NOT YET (only 2)
 *   - coverage month APRIL (lag 3 -> benefit month Jan)   => NOT YET (only 1)
 *
 * This pins the "3 months buildup + 2 months lag = coverage on month 6"
 * behavior the lag was added to express.
 *
 * Everything goes through the storage layer (no raw SQL). Idempotent: the
 * worker is looked up by display name and hours use upsertWorkerHours.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/verify-bao-buildup-lag.ts
 */

import { storage } from "../../server/storage/database";
import { fetchBuildupStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup";

const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no industry => default threshold 100)
const EMPLOYMENT_STATUS_ID = "46487fff-698d-4031-b9da-1846a09ef986"; // Active
const WORKER_NAME = "[BUILDUP LAG TEST] Jan-Feb-Mar Qualifier";
const LAG_MONTHS = 3;

// Qualifying hours in Jan/Feb/Mar 2026 only.
const QUALIFYING = [
  { year: 2026, month: 1, hours: 160 },
  { year: 2026, month: 2, hours: 168 },
  { year: 2026, month: 3, hours: 152 },
];

interface Check {
  label: string;
  asOf: { year: number; month: number };
  expectSuccess: boolean;
}

const checks: Check[] = [
  { label: "April 2026 coverage", asOf: { year: 2026, month: 4 }, expectSuccess: false },
  { label: "May 2026 coverage", asOf: { year: 2026, month: 5 }, expectSuccess: false },
  { label: "June 2026 coverage", asOf: { year: 2026, month: 6 }, expectSuccess: true },
];

async function findOrCreateWorker(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact.id;
  const created = await storage.workers.createWorker(name);
  return created.id;
}

async function main(): Promise<void> {
  const workerId = await findOrCreateWorker(WORKER_NAME);

  for (const h of QUALIFYING) {
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

  let failures = 0;
  console.log(`Worker ${workerId} — qualifying Jan/Feb/Mar 2026, lagMonths=${LAG_MONTHS}`);

  for (const check of checks) {
    const status = await fetchBuildupStatus(workerId, check.asOf, {
      lagMonths: LAG_MONTHS,
      employerId: EMPLOYER_ID,
    });
    const ok = status.success === check.expectSuccess;
    if (!ok) failures++;
    console.log("");
    console.log(`  ${check.label}`);
    console.log(`    eligible : ${status.success} (expected ${check.expectSuccess})`);
    console.log(`    reason   : ${status.reason}`);
    console.log(`    result   : ${ok ? "OK" : "MISMATCH"}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} check(s) did not match expectations.`);
    process.exit(1);
  }
  console.log("Buildup lag verified: Jan/Feb/Mar qualifying => coverage begins June.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
