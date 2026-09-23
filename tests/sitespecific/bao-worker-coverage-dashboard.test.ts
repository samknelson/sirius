import { describe, expect, it } from "vitest";
import type { IStorage } from "../../server/storage";
import {
  accountIsFinancial,
  buildWorkerCoverageSummary,
  causalEvidence,
  currentCoverageFromScan,
  monthView,
  reportingDeadline,
  shiftCoverageMonth,
  sumMoneyAmounts,
  thresholdRowStatus,
} from "../../server/services/sitespecific/bao/worker-coverage-dashboard";

describe("BAO worker coverage dashboard server summary", () => {
  it("maps work and coverage months across year boundaries and applies the inclusive deadline", () => {
    expect(shiftCoverageMonth(1, 2027, -3)).toEqual({ month: 10, year: 2026 });
    expect(reportingDeadline(monthView(12, 2026))).toBe("2027-01-20");
    expect(thresholdRowStatus(49.75, 50, "2027-01-20", "2027-01-20")).toBe("pending");
    expect(thresholdRowStatus(49.75, 50, "2027-01-20", "2027-01-21")).toBe("below");
    expect(thresholdRowStatus(50, 50, "2027-01-20", "2027-01-01")).toBe("met");
  });

  it("adds signed decimal balances exactly and omits nonfinancial unit accounts", () => {
    expect(sumMoneyAmounts(["12.10", "-0.30", "0.20"])).toBe("12.00");
    expect(sumMoneyAmounts(["1.125", "0.375"], 3)).toBe("1.500");
    expect(sumMoneyAmounts(["1.00"], 0)).toBe("1");
    expect(() => sumMoneyAmounts(["1.125"], 2)).toThrow(/exceeds the currency precision/);
    expect(accountIsFinancial({ currencyCode: "USD", data: null })).toBe(true);
    expect(accountIsFinancial({ currencyCode: "USD", data: { unit: "hours" } })).toBe(false);
    expect(accountIsFinancial({ currencyCode: "EUR", data: { unit: "EUR" } })).toBe(true);
  });

  it("marks only established BAO blocking evidence as a cause", () => {
    expect(causalEvidence({ actions: [
      { pluginResults: [{ pluginKey: "unrelated-rule", eligible: false }] },
    ] }, false)).toEqual({ hours: null, balance: null });
    expect(causalEvidence({ actions: [
      { eligible: false, action: "none", pluginResults: [
        { pluginKey: "sitespecific-bao-threshold", eligible: false },
        { pluginKey: "sitespecific-bao-ee-contributions", eligible: true },
      ] },
    ] }, false)).toEqual({ hours: true, balance: false });
    expect(causalEvidence({ actions: [
      { eligible: false, action: "none", pluginResults: [
        { pluginKey: "sitespecific-bao-ee-contributions", eligible: false },
      ] },
    ] }, false)).toEqual({ hours: null, balance: true });
    expect(causalEvidence({ actions: [
      { eligible: false, action: "none", pluginResults: [
        { pluginKey: "election", eligible: false },
        { pluginKey: "sitespecific-bao-threshold", eligible: false },
      ] },
      { eligible: false, action: "create", pluginResults: [
        { pluginKey: "sitespecific-bao-ee-contributions", eligible: false },
      ] },
    ] }, false)).toEqual({ hours: null, balance: null });
    expect(causalEvidence({ actions: [
      { eligible: false, action: "none", pluginResults: [
        { pluginKey: "sitespecific-bao-threshold", eligible: false },
      ] },
    ] }, true)).toEqual({ hours: null, balance: null });
  });

  it("does not treat non-success, queued, failed, or invalidated scans as fresh coverage", () => {
    const currentRows: Array<{ year: number; month: number }> = [];
    for (const status of ["pending", "processing", "failed", "invalidated", "skipped"]) {
      expect(currentCoverageFromScan({
        status,
        completedAt: new Date("2027-01-10T10:00:00Z"),
        resultSummary: { actions: [] },
      }, currentRows, 2027, 1)).toEqual({ coverage: "stale", fresh: false });
    }
    expect(currentCoverageFromScan(undefined, currentRows, 2027, 1)).toEqual({
      coverage: "unavailable",
      fresh: false,
    });
    expect(currentCoverageFromScan({
      status: "success",
      completedAt: new Date("2027-01-10T10:00:00Z"),
      resultSummary: { actions: [] },
    }, [{ year: 2027, month: 1 }], 2027, 1)).toEqual({ coverage: "covered", fresh: false });
    expect(currentCoverageFromScan({
      status: "success",
      completedAt: new Date("2027-01-10T10:00:00Z"),
      resultSummary: { actions: [] },
    }, [], 2027, 1)).toEqual({ coverage: "not-covered", fresh: true });
  });

  it("confirms recorded coverage without a scan and while a rescan is queued", () => {
    const currentRows = [{ year: 2027, month: 1 }];
    expect(currentCoverageFromScan(undefined, currentRows, 2027, 1))
      .toEqual({ coverage: "covered", fresh: false });
    expect(currentCoverageFromScan({
      status: "pending",
      completedAt: null,
      resultSummary: null,
    }, currentRows, 2027, 1)).toEqual({ coverage: "covered", fresh: false });
    expect(currentCoverageFromScan({
      status: "failed",
      completedAt: null,
      resultSummary: null,
    }, currentRows, 2027, 1)).toEqual({ coverage: "covered", fresh: false });
  });

  it("uses current-month WMB plus a successful current-month scan, preserving fractional hours", async () => {
    const storage = {
      workerTrustElections: { listByWorker: async () => [] },
      workers: { getWorker: async () => ({ denormHomeEmployerId: null }) },
      employerPolicyHistory: { getEmployerPolicyHistory: async () => [] },
      employers: { getEmployer: async () => undefined },
      policies: { getPolicyById: async () => undefined },
      variables: { getByName: async () => undefined },
      pluginConfigs: { search: async () => [] },
      wmbScanQueue: {
        getWorkerQueueEntry: async () => ({
          status: "success",
          completedAt: new Date("2027-01-10T10:00:00Z"),
          resultSummary: { actions: [] },
        }),
      },
      trust: { wmb: { getWorkerBenefitPresence: async () => [
        { year: 2027, month: 1, benefitId: "current-benefit" },
        { year: 2026, month: 12, benefitId: "historical-only" },
      ] } },
      ledger: {
        ea: { getByEntityWithBalance: async () => [
          { accountId: "usd", balance: "0.10" },
          { accountId: "usd-credit", balance: "-0.25" },
          { accountId: "eu", balance: "8.00" },
          { accountId: "hours", balance: "100.00" },
        ] },
        accounts: { getAll: async () => [
          { id: "usd", currencyCode: "USD", data: null },
          { id: "usd-credit", currencyCode: "USD", data: null },
          { id: "eu", currencyCode: "EUR", data: null },
          { id: "hours", currencyCode: "USD", data: { unit: "hours" } },
        ] },
      },
    } as unknown as IStorage;
    const summary = await buildWorkerCoverageSummary(
      storage,
      "worker-1",
      new Date("2027-01-15T12:00:00Z"),
      "UTC",
      async (_worker, asOf) => ({
        success: true,
        reason: "",
        threshold: 100,
        thresholdResolved: true,
        asofMonth: asOf.month,
        asofYear: asOf.year,
        targetMonth: asOf.month === 1 ? 10 : asOf.month - 3,
        targetYear: asOf.month === 1 ? asOf.year - 1 : asOf.year,
        hours: 99.75,
      }),
    );

    expect(summary.current.coverage).toBe("covered");
    expect(summary.workerId).toBe("worker-1");
    expect(summary.current.hours).toMatchObject({ reported: 99.75, required: 100 });
    expect(summary.balance.totals).toEqual([
      { currency: "EUR", amount: "8.00", formatted: expect.any(String) },
      { currency: "USD", amount: "-0.15", formatted: expect.any(String) },
    ]);
    expect(summary.future.map((row) => row.coverageMonth.label)).toEqual([
      "February 2027",
      "March 2027",
    ]);
    expect(summary.current.causes).toEqual({ hours: null, balance: null });
    expect(summary.balance.omittedAccounts).toEqual([
      { accountId: "hours", unit: "hours" },
    ]);
  });
});