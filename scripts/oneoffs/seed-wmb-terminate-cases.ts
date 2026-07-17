/**
 * One-off: seed test workers whose benefit coverage is active through
 * June 2026 with NOTHING computed for July 2026 yet, and whose hours make
 * them ineligible to continue in July — so a July "continue" WMB scan
 * should decide `delete` and the trust-wmb-terminate denorm plugin should
 * record `terminate` events in `trust_wmb_events`.
 *
 * Rule context (MLK benefit under the EVENT CENTER Plan policy):
 *   - continue rule = "BAO - Threshold" (sitespecific-bao-threshold): the
 *     single month examined for as-of July 2026 is April 2026 (3-month
 *     look-back); hours must be >= 100 (TEST HOTEL has no industry, so the
 *     default threshold applies).
 *   - the election rule ("start,continue") is satisfied by an active
 *     election that covers MLK.
 *
 * Each worker gets:
 *   - an Active employment status + hours at TEST HOTEL:
 *       Oct 2025 .. Mar 2026 at 150h (buildup history justifying coverage),
 *       April 2026 per scenario (below/above/no hours),
 *       May/Jun 2026 at 150h (recent hours are irrelevant to the July
 *       continue decision, which only looks at April).
 *   - an active trust election (EVENT CENTER Plan, MLK, started 2026-01-01),
 *   - MLK coverage rows (trust_wmb) for Jan..Jun 2026 — and NO July row.
 *
 * Scenarios:
 *   1. [WMB TERM TEST] Low April    — 40h in April  => July continue FAILS.
 *   2. [WMB TERM TEST] Zero April   — no April row  => July continue FAILS.
 *   3. [WMB TERM TEST] OK April     — 150h in April => July continue PASSES
 *      (control: should be continued, no terminate event).
 *
 * Everything goes through the storage layer (no raw SQL). Idempotent:
 * workers are reused by display name, hours use upsertWorkerHours, the
 * election is only created when absent, and coverage rows are skipped when
 * they already exist.
 *
 * After running, trigger a WMB scan for July 2026 for these workers (or the
 * whole month) from the admin WMB scan queue, then let the denorm_stale
 * cron (or a manual rebuild) materialize the terminate events.
 *
 * Usage: npx tsx scripts/oneoffs/seed-wmb-terminate-cases.ts
 */

import { storage } from "../../server/storage/database";
import { fetchThresholdStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-threshold";

// Known fixtures in this database.
const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no industry => default threshold 100)
const EMPLOYMENT_STATUS_ID = "46487fff-698d-4031-b9da-1846a09ef986"; // Active
const POLICY_ID = "a5b9e6dd-c9ce-47bb-b7cf-7370e160b227"; // EVENT CENTER Plan
const MLK_BENEFIT_ID = "10e16e6e-1ce8-4068-a55a-6351e72be9f5"; // MLK

// July 2026 is the month under test; its continue rule examines April 2026.
const JULY = { year: 2026, month: 7 };

type MonthHours = { year: number; month: number; hours: number };

interface Scenario {
  name: string;
  /** April 2026 hours; null = no hours row at all. */
  aprilHours: number | null;
  /** Expected July-continue verdict from the threshold rule. */
  expectContinueEligible: boolean;
}

const scenarios: Scenario[] = [
  { name: "[WMB TERM TEST] Low April", aprilHours: 40, expectContinueEligible: false },
  { name: "[WMB TERM TEST] Zero April", aprilHours: null, expectContinueEligible: false },
  { name: "[WMB TERM TEST] OK April", aprilHours: 150, expectContinueEligible: true },
];

/** Oct 2025 .. Mar 2026 at 150h, plus May/Jun 2026 at 150h. */
function baseHours(): MonthHours[] {
  return [
    { year: 2025, month: 10, hours: 150 },
    { year: 2025, month: 11, hours: 150 },
    { year: 2025, month: 12, hours: 150 },
    { year: 2026, month: 1, hours: 150 },
    { year: 2026, month: 2, hours: 150 },
    { year: 2026, month: 3, hours: 150 },
    { year: 2026, month: 5, hours: 150 },
    { year: 2026, month: 6, hours: 150 },
  ];
}

// Coverage months: Jan..Jun 2026 (active through June, nothing for July).
const COVERAGE_MONTHS = [1, 2, 3, 4, 5, 6].map((month) => ({ year: 2026, month }));

async function findOrCreateWorker(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact.id;
  const created = await storage.workers.createWorker(name);
  return created.id;
}

async function ensureElection(workerId: string): Promise<string> {
  const existing = await storage.workerTrustElections.getActiveByWorker(workerId);
  if (existing) return existing.id;
  const created = await storage.workerTrustElections.create(workerId, {
    employerId: EMPLOYER_ID,
    policyId: POLICY_ID,
    startYmd: "2026-01-01",
    benefitIds: [MLK_BENEFIT_ID],
    relationshipIds: [],
  });
  return created.id;
}

async function main(): Promise<void> {
  let failures = 0;

  for (const scenario of scenarios) {
    const workerId = await findOrCreateWorker(scenario.name);

    const hours = baseHours();
    if (scenario.aprilHours !== null) {
      hours.push({ year: 2026, month: 4, hours: scenario.aprilHours });
    }
    for (const h of hours) {
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

    const electionId = await ensureElection(workerId);

    let created = 0;
    let existing = 0;
    for (const cm of COVERAGE_MONTHS) {
      const already = await storage.trust.wmb.workerBenefitExists(
        workerId,
        MLK_BENEFIT_ID,
        cm.month,
        cm.year,
      );
      if (already) {
        existing++;
        continue;
      }
      await storage.trust.wmb.createWorkerBenefit({
        workerId,
        month: cm.month,
        year: cm.year,
        employerId: EMPLOYER_ID,
        benefitId: MLK_BENEFIT_ID,
      });
      created++;
    }

    // Verify the July continue verdict the threshold rule will reach.
    const status = await fetchThresholdStatus(workerId, JULY, {
      employerId: EMPLOYER_ID,
    });
    const ok = status.success === scenario.expectContinueEligible;
    if (!ok) failures++;

    console.log("");
    console.log(scenario.name);
    console.log(`  worker            : ${workerId}`);
    console.log(`  election          : ${electionId}`);
    console.log(`  coverage rows     : ${created} created, ${existing} already present (Jan-Jun 2026)`);
    console.log(`  July target month : ${status.targetMonth}/${status.targetYear} hours=${status.hours} threshold=${status.threshold}`);
    console.log(`  July continue OK  : ${status.success} (expected ${scenario.expectContinueEligible})`);
    console.log(`  reason            : ${status.reason}`);
    console.log(`  result            : ${ok ? "OK" : "MISMATCH"}`);
  }

  console.log("");
  console.log(failures === 0 ? "All scenarios verified." : `${failures} scenario(s) MISMATCHED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
