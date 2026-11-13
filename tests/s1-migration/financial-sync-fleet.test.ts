import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { FLEET, PROFILES, validateSyncConfig } from "../../scripts/s1-migration/sync-config";
import { parseFinancialSyncApprovals } from "../../scripts/s1-migration/lib/financial-sync-contract";
import { SCHEDULED_SYNC_ARGS } from "../../scripts/s1-migration/lib/daily-automation";

const fake = vi.hoisted(() => ({
  spawn: vi.fn(), query: vi.fn(), end: vi.fn(), release: vi.fn(), record: vi.fn(),
  resultPath: "", balanceIdentity: {} as unknown, moneyIdentity: {} as unknown,
  moneyFailure: false,
  electionsFailure: false, stageFailure: false, wmb: vi.fn(),
}));
vi.mock("child_process", () => ({ spawnSync: fake.spawn }));
vi.mock("../../server/storage/db", () => ({
  pool: { connect: async () => ({ query: fake.query, release: fake.release }), query: fake.query, end: fake.end },
}));
vi.mock("../../server/storage/drain-storage-side-effects", () => ({
  drainStorageSideEffects: async () => {},
}));
vi.mock("../../shared/database-url", () => ({
  resolveDatabaseUrl: () => "fixture", describeDatabaseTarget: () => "fixture",
}));
vi.mock("../../server/services/s1-write-fence", () => ({
  acquireExclusiveAppWriteFence: async () => ({ release: async () => {} }),
}));
vi.mock("../../scripts/s1-migration/lib/script-env", () => ({
  getRawProcessEnv: () => ({}),
  getEnvironmentVariable: (key: string) => key === "S1_RESULT_JSON_PATH" ? fake.resultPath : undefined,
}));
vi.mock("../../scripts/s1-migration/lib/staging", () => ({
  ensureStagingSchema: async () => {}, recordRun: fake.record, updateRunReport: async () => {},
}));
vi.mock("../../scripts/s1-migration/lib/timezone-contract", () => ({
  MIGRATION_SYSTEM_TIME_ZONE: "America/Los_Angeles",
  assertMigrationTimeZone: async () => ({
    runtimeTimeZone: "America/Los_Angeles", dbSessionTimeZone: "America/Los_Angeles",
    runtimeOffsets: { standard: -480, daylight: -420 },
  }),
}));
vi.mock("../../scripts/s1-migration/lib/employer-rate-sync", () => ({
  buildEmployerRateSnapshot: () => ({ rowCount: 0, migrationOwnedRows: 0, digest: "fixture" }),
  evaluateEmployerRateDurability: () => ({ status: "pass", failures: [] }),
}));
vi.mock("../../scripts/s1-migration/lib/wmb-event-phase", () => ({
  emptyWmbPhase: () => ({ status: "skipped" }),
  runWmbEventPhase: fake.wmb,
}));

const cleanIdentity = () => ({ blocked: 0, mismatched: 0, counts: { attribution_mismatches: 0 } });
let directory: string;
const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  directory = mkdtempSync(join(tmpdir(), "financial-fleet-test-"));
  fake.resultPath = join(directory, "aggregate.json");
  fake.balanceIdentity = cleanIdentity();
  fake.moneyIdentity = cleanIdentity();
  fake.moneyFailure = false;
  fake.electionsFailure = false;
  fake.stageFailure = false;
  fake.wmb.mockResolvedValue({ status: "pass" });
  fake.query.mockImplementation(async (text: string) => ({ rows: text.includes("pg_try_advisory_lock") ? [{ got: true }] : [] }));
  fake.record.mockResolvedValue(1);
  fake.end.mockResolvedValue(undefined);
  fake.spawn.mockImplementation((_command: string, args: string[], options: { env: Record<string, string> }) => {
    const script = basename(args[1]);
    let result: unknown;
    if (script === "stage.ts") {
      result = { contractVersion: 2, step: "stage", mode: "daily", status: fake.stageFailure ? "fail" : "pass",
        mismatches: 0, acceptedLiveDrifts: 0, countEvidence: [{
          source: "sirius_worker", sourceCountBefore: 2, sourceCountAfter: 2,
          identitiesScanned: 2, stagedCount: 2, integrity: "pass", status: "pass",
          sourceDrift: false, acceptedLiveDrift: false, identityVerified: true,
        }] };
    } else if (script === "verify-balance-parity.ts") {
      // Deliberately claim PASS and equal totals: sync must independently
      // reject a wrong person/coordinate in the included identity evidence.
      result = { result: "PASS", financialIdentity: fake.balanceIdentity,
        aggregate: { ar: { driftCents: 0 }, payments: { driftCents: 0 } } };
    } else if (script === "verify-month-parity.ts") {
      result = { result: "PASS" };
    } else {
      const step = FLEET.find(step => step.script === script)!;
      expect(step).toBeDefined();
      if (fake.moneyFailure && step.id === "payments") return { status: 1 };
      result = {
        loader: step.loader, logicVersion: step.logicVersion, dryRun: false,
        forceReconcile: args.includes("--force-reconcile"),
        summary: { created: 0, updated: 0, unchanged: 2, deleted: 0, deactivated: 0, reportOnly: 0, rejected: 0 },
        rejectGate: fake.electionsFailure && step.id === "elections"
          ? { status: "fail", counts: { employer_ref_missing: 1 }, allowed: [],
              disallowed: [{ reason: "employer_ref_missing", count: 1 }] }
          : { status: "pass", counts: {}, allowed: [], disallowed: [] },
        verify: { status: "pass", failures: 0 }, findings: [], blockingFindings: [],
        runtime: { timeZone: { runtimeTimeZone: "America/Los_Angeles", dbSessionTimeZone: "America/Los_Angeles" } },
        detail: { financialIdentity: fake.moneyIdentity, accountId: "fund",
          durabilitySnapshot: { rowCount: 0, migrationOwnedRows: 0, digest: "fixture" } },
      };
    }
    writeFileSync(options.env.S1_RESULT_JSON_PATH, JSON.stringify(result));
    return { status: (fake.stageFailure && script === "stage.ts") ||
      (fake.electionsFailure && script === "load-elections.ts") ? 1 : 0 };
  });
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = 0;
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

async function runFleet(extra: string[] = [], scheduled = false) {
  process.argv = scheduled ? ["node", ...SCHEDULED_SYNC_ARGS.slice(1)] :
    ["node", "sync.ts", "--mode", "daily", "--profile", "production", "--skip-seeders", ...extra];
  await import("../../scripts/s1-migration/sync");
  await vi.waitFor(() => expect(fake.end).toHaveBeenCalledOnce());
  return JSON.parse(readFileSync(fake.resultPath, "utf8"));
}
const calls = () => fake.spawn.mock.calls.map(([, args]) => args as string[]);

describe("actual daily fleet financial wiring", () => {
  it("continues the scheduled fleet after elections rejects without accepting the failure", async () => {
    fake.electionsFailure = true;
    const report = await runFleet([], true);
    expect(calls().map(args => basename(args[1])).filter(script =>
      FLEET.some(step => step.script === script))).toEqual(
      FLEET.filter(step => !step.id.startsWith("seed-")).map(step => step.script),
    );
    expect(report).toMatchObject({ keepGoing: true, result: "FAIL",
      gates: { stage: "pass", fleet: "fail", parity: "pass" } });
    expect(report.fleetAbortedAt).toBeUndefined();
    const reason = "elections: process exit 1; disallowed rejects: employer_ref_missing=1";
    expect(report.failures).toContain(reason);
    expect(report.fleet.find((step: { id: string }) => step.id === "elections"))
      .toMatchObject({ status: "fail", failures: ["process exit 1", "disallowed rejects: employer_ref_missing=1"] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(reason));
    expect(fake.record).toHaveBeenCalledWith(expect.any(Date), expect.anything(),
      expect.objectContaining({ result: "FAIL", failures: expect.arrayContaining([reason]) }));
    expect(fake.wmb).toHaveBeenCalledWith(expect.objectContaining({ importSucceeded: false }));
    expect(fake.release).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("does not start any fleet loader after scheduled staging fails", async () => {
    fake.stageFailure = true;
    const report = await runFleet([], true);
    expect(calls().map(args => basename(args[1]))).toEqual(["stage.ts"]);
    expect(report).toMatchObject({ result: "FAIL", gates: { stage: "fail", fleet: "fail" } });
    expect(fake.wmb).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("retains manual fail-fast behavior after elections rejects", async () => {
    fake.electionsFailure = true;
    const report = await runFleet();
    expect(report).toMatchObject({ keepGoing: false, fleetAbortedAt: "elections", result: "FAIL" });
    expect(calls().map(args => basename(args[1]))).not.toContain("load-benefit-history.ts");
    expect(process.exitCode).toBe(1);
  });

  it("executes the scheduled argument path in order, checks parity and retains identity aggregates", async () => {
    const report = await runFleet();
    expect(report).toMatchObject({ result: "PASS", financialLinkApprovals: { payment: false, ar: false },
      financialIdentity: { status: "pass" }, gates: { financialIdentity: "pass", parity: "pass" } });
    const scripts = calls().map(args => basename(args[1]));
    expect(scripts[0]).toBe("stage.ts");
    expect(scripts.indexOf("load-payments.ts")).toBeLessThan(scripts.indexOf("load-hours.ts"));
    expect(scripts.indexOf("load-hours.ts")).toBeLessThan(scripts.indexOf("load-ledger.ts"));
    expect(calls().find(args => args[1].endsWith("load-hours.ts"))).toContain("--migration-mode");
    expect(scripts).toContain("verify-balance-parity.ts");
    expect(scripts.filter(script => script === "verify-month-parity.ts")).toHaveLength(3);
    expect(scripts.some(script => script.startsWith("repair-"))).toBe(false);
    expect(calls().flat()).not.toContain("--approve-financial-links");
    expect(calls().flat()).not.toContain("--force-reconcile");
    for (const id of ["payments", "ledger"]) {
      expect(report.fleet.find((step: { id: string }) => step.id === id).financialIdentity.status).toBe("pass");
    }
    expect(process.exitCode).toBe(0);
  });

  it("forwards each deliberate approval only to its own stream at retained staging", async () => {
    const payment = "a".repeat(64), ar = "b".repeat(64);
    const report = await runFleet(["--skip-stage", "--financial-links-checkpoint", "reviewed",
      "--approve-payment-links", payment, "--approve-ledger-links", ar]);
    expect(report.result).toBe("PASS");
    for (const args of calls()) {
      const script = basename(args[1]);
      if (script === "load-payments.ts" || script === "load-ledger.ts") {
        expect(args.slice(args.indexOf("--approve-financial-links"))).toEqual([
          "--approve-financial-links", script === "load-payments.ts" ? payment : ar,
          "--financial-links-checkpoint", "reviewed",
        ]);
      } else expect(args).not.toContain("--approve-financial-links");
    }
    expect(JSON.stringify(report)).not.toContain(payment);
    expect(JSON.stringify(report)).not.toContain(ar);
    expect(calls().some(args => args[1].endsWith("stage.ts"))).toBe(false);
  });

  it.each([
    { blocked: 0, mismatched: 2, counts: { attribution_mismatches: 0 } },
    { blocked: 0, mismatched: 0, counts: { attribution_mismatches: 2 } },
    { blocked: 1, mismatched: 0, counts: { attribution_mismatches: 0 } },
    undefined,
  ])("fails aggregate parity even with zero fund drift and a child PASS: %j", async identity => {
    fake.balanceIdentity = identity;
    const report = await runFleet();
    expect(report.result).toBe("FAIL");
    expect(report.gates).toMatchObject({ financialIdentity: "fail", parity: "fail" });
    expect(process.exitCode).toBe(1);
  });

  it("retains failed money identity evidence and an actionable refusal", async () => {
    fake.moneyIdentity = { blocked: 0, mismatched: 1, counts: { attribution_mismatches: 2 } };
    const report = await runFleet();
    expect(report.result).toBe("FAIL");
    expect(report.fleetAbortedAt).toBe("payments");
    expect(report.fleet.at(-1)).toMatchObject({ financialIdentity: { mismatched: 1 },
      remediation: expect.stringContaining("read-only inventory") });
  });

  it("reports stale-evidence child refusal even when no envelope could be written", async () => {
    fake.moneyFailure = true;
    const report = await runFleet(["--skip-stage", "--financial-links-checkpoint", "reviewed",
      "--approve-payment-links", "a".repeat(64)]);
    expect(report.result).toBe("FAIL");
    expect(report.fleet.at(-1)).toMatchObject({
      status: "fail", remediation: expect.stringContaining("separately approve exact evidence"),
    });
    expect(calls().some(args => args[1].endsWith("load-ledger.ts"))).toBe(false);
  });
});

describe("operator financial approval input contract", () => {
  it("refuses invalid approval before the real orchestrator stages, locks or records anything", async () => {
    process.argv = ["node", "sync.ts", "--mode", "daily", "--approve-payment-links"];
    await import("../../scripts/s1-migration/sync");
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(fake.spawn).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.record).not.toHaveBeenCalled();
  });
  it.each([
    ["--approve-payment-links"],
    ["--approve-payment-links", "--skip-stage"],
    ["--financial-links-checkpoint", "reviewed"],
    ["--approve-payment-links", "a".repeat(64), "--financial-links-checkpoint", "reviewed"],
    ["--skip-stage", "--approve-payment-links", "wrong", "--financial-links-checkpoint", "reviewed"],
    ["--skip-stage", "--approve-payment-links", "a".repeat(64)],
    ["--approve-payment-links=" + "a".repeat(64)],
    ["--approve-financial-links", "a".repeat(64)],
    ["--skip-stage", "--approve-payment-links", "a".repeat(64), "--approve-payment-links", "b".repeat(64)],
  ])("refuses malformed/ignored or restaging approval inputs: %j", (...args) => {
    expect(() => parseFinancialSyncApprovals(args)).toThrow();
  });
  it("forbids standing approvals in profiles", () => {
    const previous = PROFILES.production.steps.payments.extraArgs;
    try {
      PROFILES.production.steps.payments.extraArgs = ["--approve-financial-links", "a".repeat(64)];
      expect(validateSyncConfig).toThrow(/never be configured defaults/);
    } finally { PROFILES.production.steps.payments.extraArgs = previous; }
  });
});
