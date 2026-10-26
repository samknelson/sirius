import { describe, expect, it } from "vitest";
import { extendComplianceSnapshot } from "../../server/services/compliance-enqueue-snapshot";

const saved = {
  scope: { year: 2026, month: 10, monthsBack: 6, wizardType: "monthly", ledgerAccountIds: ["00000000-0000-0000-0000-000000000001"], companyId: null },
  runAt: "2026-10-01T12:00:00.000Z", wizardName: "Monthly report", accountName: "Legal",
  employerByContact: { existing: "employer" },
  valuesByEmployer: { employer: { employer_name: "Employer", missing_periods: "Oct 2026", delinquent_periods: "Oct 2026: 25.00", delinquent_total: "25.00", period_window: "May 2026 – Oct 2026" } },
};

describe("extending an employer compliance message", () => {
  it("captures a report when first binding an unbound message", () => {
    expect(extendComplianceSnapshot(undefined, saved, ["employer"])).toBe(saved);
  });
  it("preserves the original report date, figures and earlier recipients", () => {
    const next = { ...saved, runAt: "2026-10-20T12:00:00.000Z", employerByContact: { added: "employer" },
      valuesByEmployer: { employer: { ...saved.valuesByEmployer.employer, delinquent_total: "99.00" } } };
    const result = extendComplianceSnapshot(saved, next, ["employer"]);
    expect(result.runAt).toBe(saved.runAt);
    expect(result.valuesByEmployer).toEqual(saved.valuesByEmployer);
    expect(result.employerByContact).toEqual({ existing: "employer", added: "employer" });
  });
  it("rejects a different scope, absent report values, and ambiguous contacts", () => {
    expect(() => extendComplianceSnapshot(saved, { ...saved, scope: { ...saved.scope, month: 9 } }, ["employer"])).toThrow(/different compliance report/);
    expect(() => extendComplianceSnapshot(saved, saved, ["other"])).toThrow(/saved report does not include/);
    expect(() => extendComplianceSnapshot(saved, { ...saved, employerByContact: { existing: "other" } }, ["employer"])).toThrow(/another employer/);
  });
  it("refuses malformed saved context rather than overwriting it", () => {
    expect(() => extendComplianceSnapshot(null, saved, ["employer"])).toThrow(/different compliance report/);
  });
});
