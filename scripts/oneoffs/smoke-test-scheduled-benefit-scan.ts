/**
 * Smoke tests for the scheduled benefit-scan sweep (task: scheduled benefit
 * scan queue cron): the coverage-month pair calculator, the friendly-fields →
 * cron-expression translation, settings validation, and the population
 * resolvers (against stubbed storage, so no database is required).
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-scheduled-benefit-scan.ts
 */
import {
  computeCoverageMonthPair,
  deriveSweepCronSchedule,
  addCoverageMonths,
  getZonedDateParts,
  type CoverageMonthRef,
} from "../../server/services/benefit-scan-schedule";
import {
  getScanPopulationResolver,
  listScanPopulationTypes,
} from "../../server/services/benefit-scan-populations";

let passed = 0;
let failed = 0;

/** Stable stringify (sorted object keys) so key order never affects equality. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function check(name: string, actual: unknown, expected: unknown): void {
  const a = canon(actual);
  const e = canon(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`);
  }
}

function checkThrows(name: string, fn: () => unknown, contains?: string): void {
  try {
    fn();
    failed++;
    console.error(`  FAIL ${name} — expected an error, none thrown`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (contains && !msg.includes(contains)) {
      failed++;
      console.error(`  FAIL ${name} — error "${msg}" does not contain "${contains}"`);
    } else {
      passed++;
      console.log(`  PASS ${name}`);
    }
  }
}

const LA = "America/Los_Angeles";
/** Build an instant that is `HH:MM` local time in LA on the given date. */
function laInstant(iso: string): Date {
  // ISO with explicit offset keeps tests deterministic; LA is -08:00 in
  // winter, -07:00 in DST.
  return new Date(iso);
}

const pair = (a: CoverageMonthRef, b: CoverageMonthRef) => [a, b];

console.log("Coverage-month pair calculator");
// Worked example from the task: run Jan 3 (before switch) → [Dec, Jan].
check(
  "Jan 3 2026, anchor 15 → [Dec 2025, Jan 2026]",
  computeCoverageMonthPair(laInstant("2026-01-03T02:00:00-08:00"), LA, 15),
  pair({ month: 12, year: 2025 }, { month: 1, year: 2026 }),
);
// Worked example: run Jan 16 (day > 15) → [Jan, Feb].
check(
  "Jan 16 2026, anchor 15 → [Jan 2026, Feb 2026]",
  computeCoverageMonthPair(laInstant("2026-01-16T02:00:00-08:00"), LA, 15),
  pair({ month: 1, year: 2026 }, { month: 2, year: 2026 }),
);
// Anchor edge: day == anchor is NOT after the switch.
check(
  "Jan 15 2026, anchor 15 (== anchor) → [Dec 2025, Jan 2026]",
  computeCoverageMonthPair(laInstant("2026-01-15T23:00:00-08:00"), LA, 15),
  pair({ month: 12, year: 2025 }, { month: 1, year: 2026 }),
);
// Year rollover forward: late-December run covers into next year.
check(
  "Dec 20 2026, anchor 15 → [Dec 2026, Jan 2027]",
  computeCoverageMonthPair(laInstant("2026-12-20T02:00:00-08:00"), LA, 15),
  pair({ month: 12, year: 2026 }, { month: 1, year: 2027 }),
);
// Anchor extremes.
check(
  "Feb 2 2026, anchor 1 → [Feb 2026, Mar 2026]",
  computeCoverageMonthPair(laInstant("2026-02-02T02:00:00-08:00"), LA, 1),
  pair({ month: 2, year: 2026 }, { month: 3, year: 2026 }),
);
check(
  "Feb 28 2026, anchor 28 → [Jan 2026, Feb 2026]",
  computeCoverageMonthPair(laInstant("2026-02-28T02:00:00-08:00"), LA, 28),
  pair({ month: 1, year: 2026 }, { month: 2, year: 2026 }),
);
// DST spring-forward day (Mar 8 2026 in LA): date math still resolves Mar 8.
check(
  "DST day Mar 8 2026 01:59 PST, anchor 15 → [Feb, Mar]",
  computeCoverageMonthPair(laInstant("2026-03-08T01:59:00-08:00"), LA, 15),
  pair({ month: 2, year: 2026 }, { month: 3, year: 2026 }),
);
check(
  "DST day Mar 8 2026 03:00 PDT, anchor 5 → [Mar, Apr]",
  computeCoverageMonthPair(laInstant("2026-03-08T03:00:00-07:00"), LA, 5),
  pair({ month: 3, year: 2026 }, { month: 4, year: 2026 }),
);
// Time-zone boundary: an instant that is Feb 1 UTC but still Jan 31 in LA
// must be evaluated as Jan 31 in the configured zone.
check(
  "Jan 31 2026 23:30 LA (= Feb 1 UTC), anchor 15 → [Jan, Feb]",
  computeCoverageMonthPair(new Date("2026-02-01T07:30:00Z"), LA, 15),
  pair({ month: 1, year: 2026 }, { month: 2, year: 2026 }),
);
check(
  "same instant evaluated in UTC, anchor 15 → [Jan, Feb] (Feb 1 <= 15 → [M-1, M])",
  computeCoverageMonthPair(new Date("2026-02-01T07:30:00Z"), "UTC", 15),
  pair({ month: 1, year: 2026 }, { month: 2, year: 2026 }),
);
checkThrows("invalid anchor 0 rejected", () =>
  computeCoverageMonthPair(new Date(), LA, 0), "switchAnchorDay");
checkThrows("invalid time zone rejected", () =>
  computeCoverageMonthPair(new Date(), "Not/AZone", 15));

console.log("getZonedDateParts / addCoverageMonths");
check("zoned parts LA", getZonedDateParts(new Date("2026-02-01T07:30:00Z"), LA), {
  year: 2026, month: 1, day: 31,
});
check("addCoverageMonths -1 across year", addCoverageMonths({ month: 1, year: 2026 }, -1), {
  year: 2025, month: 12,
});
check("addCoverageMonths +1 across year", addCoverageMonths({ month: 12, year: 2026 }, 1), {
  year: 2027, month: 1,
});

console.log("deriveSweepCronSchedule");
check(
  "weekly Monday 02:30 LA",
  deriveSweepCronSchedule({ frequency: "weekly", dayOfWeek: 1, runTime: "02:30", timeZone: LA }),
  { schedule: "30 2 * * 1", timezone: LA },
);
check(
  "monthly day 5 23:15 UTC",
  deriveSweepCronSchedule({ frequency: "monthly", dayOfMonth: 5, runTime: "23:15", timeZone: "UTC" }),
  { schedule: "15 23 5 * *", timezone: "UTC" },
);
checkThrows("weekly without dayOfWeek", () =>
  deriveSweepCronSchedule({ frequency: "weekly", runTime: "02:00", timeZone: LA }), "day_of_week");
checkThrows("monthly without dayOfMonth", () =>
  deriveSweepCronSchedule({ frequency: "monthly", runTime: "02:00", timeZone: LA }), "day_of_month");
checkThrows("bad runTime", () =>
  deriveSweepCronSchedule({ frequency: "weekly", dayOfWeek: 1, runTime: "24:00", timeZone: LA }), "runTime");
checkThrows("bad timeZone", () =>
  deriveSweepCronSchedule({ frequency: "weekly", dayOfWeek: 1, runTime: "02:00", timeZone: "Nope" }), "time zone");

console.log("Population resolvers (stubbed storage — coverage-month driven, run-date independent)");
const calls: Array<{ fn: string; month?: number; year?: number }> = [];
const stubStorage = {
  wmbScanQueue: {
    async getWorkerIdsWithActiveElectionInMonth(month: number, year: number) {
      calls.push({ fn: "elections", month, year });
      return ["w-el-1", "w-el-2"];
    },
    async getWorkerIdsWithBenefitInMonth(month: number, year: number) {
      calls.push({ fn: "benefits", month, year });
      return ["w-b-1"];
    },
    async getAllWorkerIds() {
      calls.push({ fn: "all" });
      return ["w1", "w2", "w3"];
    },
  },
} as any;

check(
  "registry lists the three built-in populations",
  listScanPopulationTypes().map((p) => p.id).sort(),
  ["active_elections", "all_workers", "previous_month_benefit"],
);

const activeElections = getScanPopulationResolver("active_elections")!;
const prevBenefit = getScanPopulationResolver("previous_month_benefit")!;
const allWorkers = getScanPopulationResolver("all_workers")!;

check(
  "active_elections resolves for coverage month C itself",
  await activeElections.resolve(stubStorage, { month: 12, year: 2025 }),
  ["w-el-1", "w-el-2"],
);
check("…queried Dec 2025", calls.pop(), { fn: "elections", month: 12, year: 2025 });

check(
  "previous_month_benefit resolves C-1 (coverage Jan 2026 → Dec 2025)",
  await prevBenefit.resolve(stubStorage, { month: 1, year: 2026 }),
  ["w-b-1"],
);
check("…queried Dec 2025", calls.pop(), { fn: "benefits", month: 12, year: 2025 });

check(
  "all_workers ignores the coverage month",
  await allWorkers.resolve(stubStorage, { month: 7, year: 2026 }),
  ["w1", "w2", "w3"],
);

check("unknown population type → undefined", getScanPopulationResolver("nope"), undefined);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
