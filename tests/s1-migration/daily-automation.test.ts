import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertNoForbiddenScheduledFlags,
  assertScheduledDailyReport,
  DAILY_SYNC_COMMAND,
  SCHEDULED_SYNC_ARGS,
  sanitizeDailySummary,
  summaryMessage,
} from "../../scripts/s1-migration/lib/daily-automation";

const passing = {
  command: "sync",
  mode: "daily",
  profile: "production",
  result: "PASS",
  durationSec: 123,
  forceReconcile: false,
  skipStage: false,
  skipSeeders: true,
  keepGoing: false,
  gates: { stage: "pass", fleet: "pass", findingsMode: "pass", parity: "pass" },
  fleetTotals: { created: 1, unchanged: 20, rejected: 0 },
  findingsByKind: {},
};

describe("scheduled S1 daily automation", () => {
  it("runs at 00:01 Pacific on weekdays with a weekday late check", () => {
    const setup = readFileSync("scripts/s1-migration/aws/configure-daily-sync.sh", "utf8");
    expect(setup).toContain('DAILY_EXPRESSION="cron(1 0 ? * MON-FRI *)"');
    expect(setup).toContain('LATE_EXPRESSION="cron(0 9 ? * MON-FRI *)"');
    expect(setup).toContain("--schedule-expression-timezone America/Los_Angeles");
    expect(setup).toContain('AssignPublicIp: "ENABLED"');
    expect(setup).toContain("assignPublicIp=ENABLED");
  });

  it("pins the wrapper command and refuses operator-only flags", () => {
    expect(DAILY_SYNC_COMMAND).toEqual(["npx", "tsx", "scripts/s1-migration/run-scheduled-daily.ts"]);
    expect(SCHEDULED_SYNC_ARGS).toEqual([
      "tsx",
      "scripts/s1-migration/sync.ts",
      "--mode",
      "daily",
      "--profile",
      "production",
      "--skip-seeders",
    ]);
    expect(() => assertNoForbiddenScheduledFlags([])).not.toThrow();
    for (const flag of [
      "--skip-stage",
      "--force-reconcile",
      "--allow-rejects",
      "--allow-findings",
      "--keep-going",
      "--dry-run",
    ]) {
      expect(() => assertNoForbiddenScheduledFlags([flag])).toThrow(/operator-only/);
    }
  });

  it("builds an aggregate-only clean completion summary", () => {
    const summary = sanitizeDailySummary(passing);
    expect(summary.status).toBe("success");
    expect(summary.counters).toEqual({ created: 1, unchanged: 20, rejected: 0 });
    expect(summaryMessage(summary, new Date("2026-09-16T12:00:00Z"))).not.toContain("database");
  });

  it("separates report-only findings from hard failure", () => {
    expect(sanitizeDailySummary({
      ...passing,
      findingsByKind: { deleted_in_s1: 3, pending_retention: 1 },
    }).status).toBe("findings");
    expect(sanitizeDailySummary({ ...passing, result: "FAIL" }).status).toBe("failure");
  });

  it("fails closed on an unsafe or malformed report", () => {
    expect(() => assertScheduledDailyReport({ ...passing, skipStage: true })).toThrow(/skipStage/);
    expect(() => assertScheduledDailyReport({ ...passing, skipSeeders: false })).toThrow(/skipSeeders/);
    const { skipSeeders: _omitted, ...withoutSkipSeeders } = passing;
    expect(() => assertScheduledDailyReport(withoutSkipSeeders)).toThrow(/skipSeeders/);
    expect(() => assertScheduledDailyReport({ ...passing, forceReconcile: true })).toThrow(/forceReconcile/);
    expect(() => assertScheduledDailyReport({ ...passing, profile: "dev" })).toThrow(/profile/);
    expect(() => assertScheduledDailyReport({ ...passing, gates: { ...passing.gates, fleet: "fail" } }))
      .toThrow(/fleet gate/);
    expect(() => assertScheduledDailyReport({ ...passing, gates: { ...passing.gates, parity: "skipped" } }))
      .toThrow(/parity gate/);
    expect(() => assertScheduledDailyReport({ ...passing, gates: {} })).toThrow(/stage gate/);
    expect(() => assertScheduledDailyReport({ ...passing, result: "FAIL", gates: { fleet: "fail" } }))
      .not.toThrow();
  });
});
