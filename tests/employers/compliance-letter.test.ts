import { describe, expect, it, vi } from "vitest";
import {
  compliancePeriods, complianceScopeSchema, summarizeCompliance,
  complianceRecordId, parseComplianceRecordId,
} from "../../shared/employer-compliance";
import {
  buildComplianceMonths, loadComplianceReport, loadComplianceLetterValues,
} from "../../server/services/employer-compliance";
import type { IStorage } from "../../server/storage";
import type { EmployerWithUploads } from "../../server/storage/wizard_employer_monthly";

vi.mock("../../server/plugins/wizards/registry", () => ({
  wizardPluginRegistry: { get: (id: string) => id === "monthly" ? { name: "Monthly" } : undefined },
}));

const employerId = "11111111-1111-4111-8111-111111111111";
const otherEmployerId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const scope = complianceScopeSchema.parse({
  wizardType: "monthly", year: 2026, month: 10, ledgerAccountIds: [accountId],
});
const upload = (month: number, status: string, date: string) => ({
  month, year: 2026, status, id: `${month}-${status}`, currentStep: null, createdAt: new Date(date),
}) as EmployerWithUploads["uploads"][number];

function fixture() {
  const storage = {
    wizardEmployerMonthly: {
      listAllEmployersWithUploadsForRange: vi.fn().mockResolvedValue([
        { employer: { id: employerId, name: "First Employer", isActive: true, siriusId: "1" },
          uploads: [upload(5, "completed", "2026-06-01"), upload(5, "draft", "2026-06-02"), upload(6, "cancelled", "2026-07-01"), upload(7, "completed", "2026-08-01")] },
        { employer: { id: otherEmployerId, name: "Second Employer", isActive: true, siriusId: "2" }, uploads: [] },
      ]),
    },
    employerCompanies: { getByEmployerIdsWithCompanyName: vi.fn().mockResolvedValue(new Map()) },
    ledger: {
      accounts: { get: vi.fn().mockResolvedValue({ id: accountId, name: "Trust" }) },
      entries: {
        getBalancesByEntityAndAccount: vi.fn().mockResolvedValue([{ entityId: employerId, accountId, total: "-500.00" }]),
        // These are the signed, statement-month sums returned by ledger
        // storage across ALL selected accounts, including payments/offsets.
        getMonthlyDeltasByEntityAndAccount: vi.fn().mockResolvedValue([
          { entityId: employerId, ym: "2026-05", total: "45.00" },
          { entityId: employerId, ym: "2026-06", total: "-10.00" },
          { entityId: employerId, ym: "2026-07", total: "0.00" },
          { entityId: employerId, ym: "2026-10", total: "55.00" },
          { entityId: otherEmployerId, ym: "2026-10", total: "999.00" },
        ]),
      },
    },
  };
  return { raw: storage, storage: storage as unknown as IStorage };
}

describe("report-backed compliance letters", () => {
  it("keeps the October six-month window and year-boundary windows chronological", () => {
    expect(compliancePeriods(scope).map(({ month }) => month)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(compliancePeriods({ year: 2026, month: 2, monthsBack: 3 })).toEqual([
      { year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 },
    ]);
    expect(compliancePeriods({ ...scope, monthsBack: 24 })).toHaveLength(24);
  });

  it("uses the latest upload and excludes completed/cancelled periods, not drafts or absent ones", () => {
    const cells = buildComplianceMonths([
      upload(5, "draft", "2026-06-02"), upload(5, "completed", "2026-06-01"),
      upload(6, "cancelled", "2026-07-01"), upload(7, "completed", "2026-08-01"),
      upload(8, "in_progress", "2026-09-01"),
    ], compliancePeriods(scope), undefined, true);
    expect(summarizeCompliance(cells).missing.map(({ month }) => month)).toEqual([5, 8, 9, 10]);
    expect(cells[0].wizardId).toBe("5-draft");
  });

  it("letters and the report agree, with only positive monthly nets in the total (not all-time balance)", async () => {
    const { storage, raw } = fixture();
    const report = await loadComplianceReport(storage, scope);
    const summary = summarizeCompliance(report.rows[0].months);
    const values = await loadComplianceLetterValues(storage, scope, employerId);
    expect(summary.delinquentTotal).toBe("100.00");
    expect(report.rows[0].totalBalance).toBe("-500.00");
    expect(values).toMatchObject({
      employer_name: "First Employer",
      missing_periods: "May 2026, Aug 2026, Sep 2026, Oct 2026",
      delinquent_periods: "May 2026: 45.00; Oct 2026: 55.00",
      delinquent_total: "100.00",
      period_window: "May 2026 – Oct 2026",
    });
    expect(raw.ledger.entries.getMonthlyDeltasByEntityAndAccount).toHaveBeenLastCalledWith(
      "employer", [employerId], [accountId],
      ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    );
    expect((await loadComplianceLetterValues(storage, scope, otherEmployerId)).delinquent_total).toBe("999.00");
  });

  it("uses neutral wording for empty results but refuses unavailable employers, accounts and types", async () => {
    const { storage, raw } = fixture();
    raw.ledger.entries.getMonthlyDeltasByEntityAndAccount.mockResolvedValue([]);
    const empty = await loadComplianceLetterValues(storage, { ...scope, monthsBack: 1, month: 7 }, employerId);
    expect(empty.missing_periods).toBe("No missing reporting periods.");
    expect(empty.delinquent_periods).toBe("No delinquent statement periods.");
    expect(empty.delinquent_total).toBe("0.00");
    await expect(loadComplianceLetterValues(storage, scope, accountId)).rejects.toThrow("unavailable");
    await expect(loadComplianceLetterValues(storage, { ...scope, wizardType: "typo" }, employerId)).rejects.toThrow("Unknown");
    await expect(loadComplianceLetterValues(storage, { ...scope, ledgerAccountIds: [] }, employerId)).rejects.toThrow("Select");
    raw.ledger.accounts.get.mockResolvedValue(undefined);
    await expect(loadComplianceLetterValues(storage, scope, employerId)).rejects.toThrow("Unknown");
  });

  it("the transient report address carries its employer and scope and rejects malformed periods", () => {
    const record = { ...scope, employerId };
    expect(parseComplianceRecordId(complianceRecordId(record))).toEqual(record);
    expect(() => parseComplianceRecordId("%garbage")).toThrow();
    for (const invalid of [{ month: 13 }, { monthsBack: 0 }, { monthsBack: 25 }, { monthsBack: "oops" }, { ledgerAccountIds: ["bad"] }]) {
      expect(complianceScopeSchema.safeParse({ ...scope, ...invalid }).success).toBe(false);
    }
  });
});
