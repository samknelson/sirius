import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkerBenefitPresence: vi.fn(),
  getWorkerCoverageHistoryScans: vi.fn(),
  getWorkerHoursMonthly: vi.fn(),
  getWorkerHoursCurrent: vi.fn(),
  getWorkerMsh: vi.fn(),
  getWorker: vi.fn(),
  listByWorker: vi.fn(),
  getEmployer: vi.fn(),
  getEmployerPolicyHistory: vi.fn(),
  getByName: vi.fn(),
  search: vi.fn(),
  getMonthlyAccountHistoryByEntityAndAccount: vi.fn(),
  getBaoEeAccountIdsByWorker: vi.fn(),
}));

vi.mock("../../server/storage/database", () => ({
  storage: {
    trust: { wmb: { getWorkerBenefitPresence: mocks.getWorkerBenefitPresence } },
    wmbScanQueue: { getWorkerCoverageHistoryScans: mocks.getWorkerCoverageHistoryScans },
    workerHours: {
      getWorkerHoursMonthly: mocks.getWorkerHoursMonthly,
      getWorkerHoursCurrent: mocks.getWorkerHoursCurrent,
    },
    workerMsh: { getWorkerMsh: mocks.getWorkerMsh },
    workers: { getWorker: mocks.getWorker },
    workerTrustElections: { listByWorker: mocks.listByWorker },
    employers: { getEmployer: mocks.getEmployer },
    employerPolicyHistory: { getEmployerPolicyHistory: mocks.getEmployerPolicyHistory },
    variables: { getByName: mocks.getByName },
    pluginConfigs: { search: mocks.search },
    ledger: { entries: {
      getMonthlyAccountHistoryByEntityAndAccount: mocks.getMonthlyAccountHistoryByEntityAndAccount,
      getBaoEeAccountIdsByWorker: mocks.getBaoEeAccountIdsByWorker,
    } },
  },
}));

import {
  aggregateEmployerHours,
  buildWorkerMonthlyCoverageHistory,
  classifyBenefitPresence,
  deriveChargeHistory,
  scanDecisionForMonth,
} from "../../server/services/sitespecific/bao/worker-monthly-coverage-history";

describe("worker monthly coverage history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkerBenefitPresence.mockResolvedValue([]);
    mocks.getWorkerCoverageHistoryScans.mockResolvedValue([]);
    mocks.getWorkerHoursMonthly.mockResolvedValue([]);
    mocks.getWorkerHoursCurrent.mockResolvedValue([]);
    mocks.getWorkerMsh.mockResolvedValue([]);
    mocks.getWorker.mockResolvedValue({ denormHomeEmployerId: null });
    mocks.listByWorker.mockResolvedValue([]);
    mocks.getEmployer.mockResolvedValue(undefined);
    mocks.getEmployerPolicyHistory.mockResolvedValue([]);
    mocks.getByName.mockResolvedValue(undefined);
    mocks.search.mockImplementation(async (kind: string) =>
      kind === "charge"
        ? [{ config: { id: "config-ee", enabled: false, pluginId: "sitespecific-bao-ee-contribution" }, subsidiary: { account: "ee-account" } }]
        : [],
    );
    mocks.getMonthlyAccountHistoryByEntityAndAccount.mockResolvedValue([]);
    mocks.getBaoEeAccountIdsByWorker.mockResolvedValue([]);
  });

  it("keeps recorded coverage active and distinguishes missing, stale, and successful negative scans", () => {
    const positive = [{ year: 2024, month: 4, benefitName: "Health", benefitTypeName: "Medical" }] as any;
    expect(scanDecisionForMonth([], positive, 2024, 4).status).toBe("active");
    expect(scanDecisionForMonth([], [], 2024, 4)).toMatchObject({ status: "unknown" });
    expect(scanDecisionForMonth([{
      id: "pending", year: 2024, month: 4, status: "pending",
      completedAt: null, resultSummary: null,
    }] as any, [], 2024, 4)).toMatchObject({ status: "unknown" });
    expect(scanDecisionForMonth([{
      id: "done", year: 2024, month: 4, status: "success",
      completedAt: new Date("2024-05-03T00:00:00Z"),
      resultSummary: { actions: [{ action: "none", eligible: false, pluginResults: [
        { pluginKey: "sitespecific-bao-threshold", eligible: false },
        { pluginKey: "sitespecific-bao-ee-contributions", eligible: false },
      ] }] },
    }] as any, [], 2024, 4)).toMatchObject({
      status: "inactive",
      reasons: ["Low Hours", "Unpaid Employee Contributions"],
    });
  });

  it("aggregates decimal hours across employer rows and preserves unknown employer names", () => {
    expect(aggregateEmployerHours([
      { employerId: "a", employer: { name: "Employer A" }, totalHours: "12.25" },
      { employerId: "a", employer: { name: "Employer A" }, totalHours: "4.5" },
      { employerId: "b", employer: { name: "Employer B" }, totalHours: "30" },
      { employerId: "missing", employer: null, totalHours: "1.25" },
    ] as any)).toEqual({
      employers: [
        { employerId: "a", employerName: "Employer A", reported: 16.75 },
        { employerId: "b", employerName: "Employer B", reported: 30 },
        { employerId: "missing", employerName: "Unknown employer (missing)", reported: 1.25 },
      ],
      reported: 48,
    });
    expect(aggregateEmployerHours([
      { employerId: "a", employer: { name: "Employer A" }, totalHours: null },
    ] as any)).toEqual({
      employers: [{ employerId: "a", employerName: "Employer A", reported: null }],
      reported: null,
    });
  });

  it("uses the latest queued run, not an older pending job or an obsolete successful scan", () => {
    const success = {
      id: "successful", year: 2024, month: 4, status: "success",
      queuedAt: new Date("2024-05-01T00:00:00Z"),
      completedAt: new Date("2024-05-02T00:00:00Z"), resultSummary: { actions: [] },
    };
    const olderPending = {
      ...success, id: "older", status: "pending",
      queuedAt: new Date("2024-04-30T00:00:00Z"), completedAt: null, resultSummary: null,
    };
    expect(scanDecisionForMonth([olderPending, success] as any, [], 2024, 4).status).toBe("inactive");
    const newerPending = { ...olderPending, queuedAt: new Date("2024-05-03T00:00:00Z") };
    expect(scanDecisionForMonth([success, newerPending] as any, [], 2024, 4).status).toBe("unknown");
    const newerFailed = { ...newerPending, status: "failed", completedAt: new Date("2024-05-04T00:00:00Z") };
    expect(scanDecisionForMonth([success, newerFailed] as any, [], 2024, 4).status).toBe("unknown");
  });

  it("returns an empty history when the worker has no recorded history evidence", async () => {
    const history = await buildWorkerMonthlyCoverageHistory(
      "worker",
      0,
      12,
      new Date("2024-04-15T12:00:00Z"),
    );
    expect(history).toEqual({ months: [], total: 0, showCharges: false, partial: false });
  });

  it("uses only medical and dental types and preserves other plan names", () => {
    expect(classifyBenefitPresence([
      { benefitName: "Medical PPO", benefitTypeName: "Medical" },
      { benefitName: "Medical HMO", benefitTypeName: "Medical", benefitTypeIcon: "Stethoscope", benefitTypeColor: "#123456" },
      { benefitName: "Dental", benefitTypeName: "Dental", benefitTypeIcon: "Tooth", benefitTypeColor: "#654321" },
      { benefitName: "Supplemental Medical Plan", benefitTypeName: "Supplemental" },
      { benefitName: "Vision", benefitTypeName: "Vision", benefitTypeIcon: "Eye", benefitTypeColor: "#246a73" },
    ] as any)).toEqual({
      medical: ["Medical HMO", "Medical PPO", "Supplemental Medical Plan"],
      dental: ["Dental"],
      other: ["Vision"],
      medicalBenefitIcons: [
        { name: "Medical HMO", icon: "Stethoscope", color: "#123456" },
        { name: "Medical PPO", icon: null, color: null },
        { name: "Supplemental Medical Plan", icon: null, color: null },
      ],
      dentalBenefitIcons: [{ name: "Dental", icon: "Tooth", color: "#654321" }],
      otherBenefitIcons: [{ name: "Vision", icon: "Eye", color: "#246a73" }],
    });
  });

  it("uses exact monthly charge arithmetic and remembers a balance after it is paid", () => {
    const history = deriveChargeHistory([
      { accountId: "ee", ym: "2024-01", balanceDelta: "12.35", chargeTotal: "12.35" },
      { accountId: "ee", ym: "2024-02", balanceDelta: "-12.35", chargeTotal: "0.00" },
      { accountId: "other", ym: "2024-02", balanceDelta: "0.00", chargeTotal: "99.00" },
    ]);
    expect(history.showCharges).toBe(true);
    expect(history.charges.get("2024-01")).toBe("12.35");
    expect(history.charges.get("2024-02")).toBe("99.00");
    expect(deriveChargeHistory([
      { accountId: "ee", ym: "2024-01", balanceDelta: "0.00", chargeTotal: "0.00" },
    ]).showCharges).toBe(false);
    expect(deriveChargeHistory([
      { accountId: "ee", ym: "2024-01", balanceDelta: "0.00", chargeTotal: "12.35", hadNonzeroBalance: true },
    ])).toMatchObject({ showCharges: true });
  });

  it("keeps historical EE charges when the contribution config moved to a new account", async () => {
    mocks.getBaoEeAccountIdsByWorker.mockResolvedValue(["old-ee-account"]);
    mocks.getMonthlyAccountHistoryByEntityAndAccount.mockResolvedValue([
      { accountId: "old-ee-account", ym: "2024-01", balanceDelta: "0.00", chargeTotal: "20.00", hadNonzeroBalance: true },
    ]);
    const history = await buildWorkerMonthlyCoverageHistory("worker", 0, 12, new Date("2024-03-15T12:00:00Z"));
    expect(mocks.getMonthlyAccountHistoryByEntityAndAccount).toHaveBeenCalledWith(
      "worker", "worker", ["ee-account", "old-ee-account"], ["config-ee"],
    );
    expect(history.showCharges).toBe(true);
    expect(history.months.find((row) => row.coverageMonth.label === "January 2024")?.charge).toBe("20.00");
  });

  it("uses the source work month's employer rather than today's home employer for historic requirements", async () => {
    mocks.getWorker.mockResolvedValue({ denormHomeEmployerId: "new-employer" });
    mocks.getEmployer.mockImplementation(async (id: string) => ({
      id, industryId: id === "old-employer" ? "old-industry" : "new-industry",
    }));
    mocks.getWorkerMsh.mockResolvedValue([
      { date: "2024-01-01", industryId: "old-industry", ms: { data: { sitespecific: { bao: { threshold: 80 } } } } },
      { date: "2024-01-01", industryId: "new-industry", ms: { data: { sitespecific: { bao: { threshold: 120 } } } } },
    ]);
    mocks.getWorkerHoursMonthly.mockResolvedValue([
      { year: 2024, month: 1, employerId: "old-employer", homeStatus: "all", totalHours: "82.25" },
      { year: 2024, month: 2, employerId: "new-employer", homeStatus: "all", totalHours: "123.5" },
    ]);
    const history = await buildWorkerMonthlyCoverageHistory("worker", 0, 12, new Date("2024-05-15T12:00:00Z"));
    expect(history.months.find((row) => row.coverageMonth.label === "April 2024")?.hours)
      .toEqual({ reported: 82.25, required: 80 });
    expect(history.months.find((row) => row.coverageMonth.label === "May 2024")?.hours)
      .toEqual({ reported: 123.5, required: 120 });
  });

  it("returns employer-level source hours and compares their aggregate with the applicable threshold", async () => {
    mocks.getEmployer.mockImplementation(async (id: string) => ({
      id,
      industryId: "industry",
      denormPolicyId: null,
    }));
    mocks.getWorkerMsh.mockResolvedValue([
      { date: "2023-10-01", industryId: "industry", ms: { data: { sitespecific: { bao: { threshold: 100 } } } } },
    ]);
    mocks.getWorkerHoursMonthly.mockResolvedValue([
      { year: 2023, month: 10, employerId: "employer-a", employer: { name: "Employer A" }, homeStatus: "all", totalHours: "63.25" },
      { year: 2023, month: 10, employerId: "employer-a", employer: { name: "Employer A" }, homeStatus: "all", totalHours: "5.5" },
      { year: 2023, month: 10, employerId: "employer-b", employer: { name: "Employer B" }, homeStatus: "none", totalHours: "48" },
    ]);
    const history = await buildWorkerMonthlyCoverageHistory(
      "worker", 0, 12, new Date("2024-01-15T12:00:00Z"),
    );
    expect(history.months[0]).toMatchObject({
      coverageMonth: { label: "January 2024" },
      workMonth: { label: "October 2023" },
      employerHours: [
        { employerId: "employer-a", employerName: "Employer A", reported: 68.75 },
        { employerId: "employer-b", employerName: "Employer B", reported: 48 },
      ],
      hours: { reported: 116.75, required: 100 },
    });
  });

  it("returns a continuous newest-first page across year rollover with source hours and period thresholds", async () => {
    mocks.getWorker.mockResolvedValue({ denormHomeEmployerId: "employer" });
    mocks.getEmployer.mockResolvedValue({ id: "employer", industryId: "industry", denormPolicyId: null });
    mocks.getWorkerMsh.mockResolvedValue([
      { date: "2024-02-01", industryId: "industry", ms: { data: { sitespecific: { bao: { threshold: 100 } } } } },
      { date: "2024-01-01", industryId: "industry", ms: { data: { sitespecific: { bao: { threshold: 80 } } } } },
    ]);
    mocks.getWorkerHoursCurrent.mockResolvedValue([
      { employerId: "employer", employmentStatus: { employed: true } },
    ]);
    mocks.getWorkerHoursMonthly.mockResolvedValue([
      { employerId: "employer", year: 2024, month: 1, totalHours: "82.25" },
      { employerId: "employer", year: 2023, month: 10, totalHours: "77.5" },
    ]);
    mocks.getWorkerBenefitPresence.mockResolvedValue([
      { year: 2024, month: 1, benefitName: "Medical PPO", benefitTypeName: "Medical", benefitTypeIcon: "Stethoscope", benefitTypeColor: "#123456" },
      { year: 2024, month: 1, benefitName: "Dental Plan", benefitTypeName: "Dental", benefitTypeIcon: "Tooth", benefitTypeColor: "#654321" },
      { year: 2024, month: 1, benefitName: "Vision", benefitTypeName: "Vision", benefitTypeIcon: "Eye", benefitTypeColor: "#246a73" },
    ]);
    mocks.getWorkerCoverageHistoryScans.mockResolvedValue([
      {
        id: "negative-dec", year: 2023, month: 12, status: "success",
        completedAt: new Date("2024-01-10T00:00:00Z"),
        resultSummary: { actions: [{ action: "none", eligible: false, pluginResults: [
          { pluginKey: "sitespecific-bao-threshold", eligible: false },
        ] }] },
      },
    ]);
    mocks.getMonthlyAccountHistoryByEntityAndAccount.mockResolvedValue([
      { accountId: "ee-account", ym: "2024-01", balanceDelta: "15.00", chargeTotal: "15.00" },
      { accountId: "ee-account", ym: "2024-02", balanceDelta: "-15.00", chargeTotal: "0.00" },
    ]);

    const history = await buildWorkerMonthlyCoverageHistory("worker", 0, 12, new Date("2024-04-15T12:00:00Z"));
    expect(history.total).toBe(5);
    expect(history.months.map((row) => row.coverageMonth.label)).toEqual([
      "April 2024", "March 2024", "February 2024", "January 2024", "December 2023",
    ]);
    expect(history.months[0]).toMatchObject({
      workMonth: { label: "January 2024" },
      hours: { reported: 82.25, required: 100 },
      status: "unknown",
    });
    expect(history.months[3]).toMatchObject({
      workMonth: { label: "October 2023" },
      hours: { reported: 77.5, required: 80 },
      status: "active",
      medical: ["Medical PPO"],
      dental: ["Dental Plan"],
      medicalBenefitIcons: [{ name: "Medical PPO", icon: "Stethoscope", color: "#123456" }],
      dentalBenefitIcons: [{ name: "Dental Plan", icon: "Tooth", color: "#654321" }],
      otherBenefitIcons: [{ name: "Vision", icon: "Eye", color: "#246a73" }],
      charge: "15.00",
    });
    expect(history.months[4]).toMatchObject({
      status: "inactive",
      reasons: ["Low Hours"],
    });
    expect(history.showCharges).toBe(true);
    expect(history.months[2].charge).toBe("0.00");
    expect(history.partial).toBe(false);
    expect(mocks.getMonthlyAccountHistoryByEntityAndAccount).toHaveBeenCalledWith(
      "worker",
      "worker",
      ["ee-account"],
      ["config-ee"],
    );
  });

  it("does not label inactive without specific failed plugin evidence", () => {
    const decision = scanDecisionForMonth([{
      id: "done", year: 2024, month: 1, status: "success",
      completedAt: new Date("2024-02-01T00:00:00Z"),
      resultSummary: { actions: [{ action: "none", eligible: false, pluginResults: [
        { pluginKey: "election", eligible: true },
        { pluginKey: "unrelated-rule", eligible: false },
      ] }] },
    }] as any, [], 2024, 1);
    expect(decision).toEqual({
      status: "inactive",
      reasons: ["No failed BAO eligibility rule was recorded for this month."],
    });
  });

  it("extracts and orders supported BAO failures, including election failure", () => {
    expect(scanDecisionForMonth([{
      id: "done", year: 2024, month: 1, status: "success",
      completedAt: new Date("2024-02-01T00:00:00Z"),
      resultSummary: { actions: [
        { action: "none", eligible: false, pluginResults: [
          { pluginKey: "election", eligible: false },
          { pluginKey: "sitespecific-bao-ee-contributions", eligible: false },
          { pluginKey: "sitespecific-bao-threshold", eligible: false },
          { pluginKey: "sitespecific-bao-buildup", eligible: false },
        ] },
        { action: "delete", eligible: false, pluginResults: [
          { pluginKey: "sitespecific-bao-threshold", eligible: false },
        ] },
      ] },
    }] as any, [], 2024, 1)).toEqual({
      status: "inactive",
      reasons: [
        "Buildup Incomplete",
        "Low Hours",
        "Unpaid Employee Contributions",
        "No Election",
      ],
    });
  });
});