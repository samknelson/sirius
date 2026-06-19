/**
 * One-off: seed workers + monthly hours + active trust elections that exercise
 * the *current* rules of the "BAO - Buildup" trust eligibility plugin
 * (server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup.ts), so the
 * plugin can be tested live in the app.
 *
 * New rules being exercised:
 *   - lagMonths = 3 (default): the last qualifying month is THREE months before
 *     the coverage (as-of) month. So qualifying in Jan/Feb/Mar grants coverage
 *     in June. This is what `evaluate()` now passes for a real election
 *     (previously elections used lag 0 / benefit month = as-of month).
 *   - buildupMonths = 3   (3 consecutive months >= threshold => buildup complete)
 *   - breakMonths   = 12  (12 consecutive months <  threshold => break => ineligible)
 *   - threshold     = 100 (TEST HOTEL has no industry, so the default is used)
 *   - The buildup rule is START-ONLY (applies_to = "start"), so a brand-new
 *     election with no prior benefit history is scanned as a "start" and the
 *     buildup plugin runs.
 *
 * Each worker gets an active election under the policy that actually carries the
 * buildup rule:
 *   - policy   = "EVENT CENTER Plan" (a5b9e6dd...) — its MLK rule (7a60598e...,
 *     applies_to "start") is the BAO buildup plugin.
 *   - benefit  = "MLK" (10e16e6e...) — the benefit the buildup rule is attached to.
 *   - employer = "TEST HOTEL" (9a80c1c5...) — no industry => default threshold 100.
 *
 * Coverage (as-of) month under test = June 2026 => benefit (last qualifying)
 * month = March 2026.
 *
 * Everything goes through the storage layer (no raw SQL), per project rules, and
 * the script is idempotent:
 *   - workers are looked up by unique display name and reused;
 *   - hours use upsertWorkerHours (ON CONFLICT) keyed on
 *     (worker, employer, year, month, day);
 *   - an election is only created if the worker has no active election.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/seed-buildup-elections.ts
 */

import { storage } from "../../server/storage/database";
import { fetchBuildupStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup";

// Known fixtures in this database.
const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no industry => default threshold 100)
const EMPLOYMENT_STATUS_ID = "46487fff-698d-4031-b9da-1846a09ef986"; // Active
const POLICY_ID = "a5b9e6dd-c9ce-47bb-b7cf-7370e160b227"; // EVENT CENTER Plan (carries the buildup rule)
const MLK_BENEFIT_ID = "10e16e6e-1ce8-4068-a55a-6351e72be9f5"; // benefit the buildup rule is attached to

// Coverage month under test, and the configurable lag the buildup plugin now
// applies for elections.
const AS_OF = { year: 2026, month: 6 }; // June 2026
const LAG_MONTHS = 3; // => last qualifying (benefit) month = March 2026

type MonthHours = { year: number; month: number; hours: number };

/** Build a descending run of `count` months ending at (and including) `end`. */
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
  /** Buildup verdict expected at AS_OF (June 2026). */
  expectSuccess: boolean;
  expectReasonIncludes: string;
  hours: MonthHours[];
  /** Optional extra as-of months to print (e.g. to show the lag in action). */
  alsoEvaluate?: Array<{ year: number; month: number }>;
}

const scenarios: Scenario[] = [
  {
    // Textbook new rule: qualify Jan/Feb/Mar => coverage in June.
    name: "[BUILDUP ELECTION] Eligible Jan-Mar",
    expectSuccess: true,
    expectReasonIncludes: "Buildup complete",
    hours: [
      { year: 2026, month: 1, hours: 160 },
      { year: 2026, month: 2, hours: 168 },
      { year: 2026, month: 3, hours: 152 },
    ],
  },
  {
    // Lag not yet met: hours only ramped up Apr/May/Jun. As-of June the benefit
    // month is March, so the recent qualifying months don't count yet => not
    // eligible in June, but eligible once coverage reaches September.
    name: "[BUILDUP ELECTION] Lag not met (Apr-Jun)",
    expectSuccess: false,
    expectReasonIncludes: "No completed buildup",
    hours: [
      { year: 2026, month: 1, hours: 40 },
      { year: 2026, month: 2, hours: 40 },
      { year: 2026, month: 3, hours: 40 },
      { year: 2026, month: 4, hours: 160 },
      { year: 2026, month: 5, hours: 168 },
      { year: 2026, month: 6, hours: 152 },
    ],
    // September 2026 => benefit month June => Apr/May/Jun buildup complete.
    alsoEvaluate: [{ year: 2026, month: 9 }],
  },
  {
    // Never 3 consecutive >= threshold, never 12 consecutive below.
    name: "[BUILDUP ELECTION] No buildup",
    expectSuccess: false,
    expectReasonIncludes: "No completed buildup",
    hours: [
      { year: 2026, month: 1, hours: 45 },
      { year: 2026, month: 2, hours: 165 },
      { year: 2026, month: 3, hours: 35 },
      { year: 2026, month: 4, hours: 150 },
      { year: 2026, month: 5, hours: 40 },
      { year: 2026, month: 6, hours: 160 },
    ],
  },
  {
    // 12 consecutive months below threshold ending at the benefit month (March
    // 2026) => break complete => ineligible.
    name: "[BUILDUP ELECTION] Break",
    expectSuccess: false,
    expectReasonIncludes: "Break complete",
    hours: monthsBack({ year: 2026, month: 3 }, 12, 20),
  },
];

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

    const electionId = await ensureElection(workerId);

    const status = await fetchBuildupStatus(workerId, AS_OF, {
      lagMonths: LAG_MONTHS,
      employerId: EMPLOYER_ID,
    });

    const ok =
      status.success === scenario.expectSuccess &&
      status.reason.includes(scenario.expectReasonIncludes);
    if (!ok) failures++;

    console.log("");
    console.log(`${scenario.name}`);
    console.log(`  worker        : ${workerId}`);
    console.log(`  election      : ${electionId}`);
    console.log(`  threshold     : ${status.threshold}`);
    console.log(
      `  benefit month : ${status.threemonthsprevMonth}/${status.threemonthsprevYear} (as-of ${AS_OF.month}/${AS_OF.year}, lag ${LAG_MONTHS})`,
    );
    console.log(
      `  eligible      : ${status.success} (expected ${scenario.expectSuccess})`,
    );
    console.log(`  reason        : ${status.reason}`);
    console.log(`  result        : ${ok ? "OK" : "MISMATCH"}`);

    for (const extra of scenario.alsoEvaluate ?? []) {
      const s2 = await fetchBuildupStatus(workerId, extra, {
        lagMonths: LAG_MONTHS,
        employerId: EMPLOYER_ID,
      });
      console.log(
        `  also as-of ${extra.month}/${extra.year} (benefit ${s2.threemonthsprevMonth}/${s2.threemonthsprevYear}): eligible=${s2.success} — ${s2.reason}`,
      );
    }
  }

  console.log("");
  console.log(
    "Seeded workers, hours and elections. View them in the app under the BAO/trust election pages,",
  );
  console.log(
    "or run a benefits scan to evaluate the elections (the buildup rule runs on the START scan).",
  );
  if (failures > 0) {
    console.error(`\n${failures} scenario(s) did not match expectations.`);
    process.exit(1);
  }
  console.log("\nAll buildup scenarios produced the expected outcome.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
