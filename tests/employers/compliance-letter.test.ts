import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compliancePeriods, complianceScopeSchema, summarizeCompliance,
} from "../../shared/employer-compliance";
import {
  buildComplianceMonths, loadComplianceReport, loadComplianceLetterValues,
} from "../../server/services/employer-compliance";
import type { IStorage } from "../../server/storage";
import type { EmployerWithUploads } from "../../server/storage/wizard_employer_monthly";
import { registerTokenPlugin, tokenPluginRegistry } from "../../server/plugins/tokens/registry";
import { createTokenEvalContext, renderTokens, validateTokenExpressionForRoots } from "../../server/plugins/tokens/evaluate";
import "../../server/plugins/tokens/plugins/compliance";

vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));
const gates = vi.hoisted(() => ({ ledgerEnabled: true }));
vi.mock("../../server/plugins/_core/gating", () => ({
  isPluginComponentEnabledSync: (meta: { requiredComponent?: string }) =>
    meta.requiredComponent !== "ledger" || gates.ledgerEnabled,
}));

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
      accounts: {
        get: vi.fn().mockResolvedValue({ id: accountId, name: "Trust" }),
        getBySiriusId: vi.fn(async (id: string) =>
          id === "TRUST" ? { id: accountId, name: "Trust" } :
          id === "OTHER" ? { id: otherEmployerId, name: "Other Trust" } : undefined),
      },
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

  it("rejects malformed period and account scope", () => {
    for (const invalid of [{ month: 13 }, { monthsBack: 0 }, { monthsBack: 25 }, { monthsBack: "oops" }, { ledgerAccountIds: ["bad"] }]) {
      expect(complianceScopeSchema.safeParse({ ...scope, ...invalid }).success).toBe(false);
    }
  });

  it("retains report company fields and filtering while tokens still use the named employer", async () => {
    const { raw, storage } = fixture();
    raw.employerCompanies.getByEmployerIdsWithCompanyName.mockResolvedValue(new Map([
      [employerId, { companyId: "company-one", companyName: "Company One" }],
    ]));
    const report = await loadComplianceReport(storage, scope, { companyId: "company-one" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ employerId, companyId: "company-one", companyName: "Company One" });
    expect((await loadComplianceReport(storage, scope, { companyId: "__none__" })).rows.map(row => row.employerId)).toEqual([otherEmployerId]);
    expect((await loadComplianceLetterValues(storage, scope, otherEmployerId)).delinquent_total).toBe("999.00");
  });
});

// Use the existing evaluator and real registered compliance leaves, with a
// seeded employer root. No storage barrel, real DB, or template writes.
registerTokenPlugin({
  metadata: { id: "test.employer", name: "Employer", description: "Seeded employer",
    segmentName: "employer", inputTypes: ["root"], outputType: "employer" },
  async resolve(_entity, _args, ctx) { return ctx.roots.employer ?? null; },
});

const argumentsText = 'wizard="monthly", account="TRUST", date="2026-10"';
const token = (leaf: string, args = argumentsText) => `{{employer.${leaf}(${args})}}`;
function seeded(storage: IStorage, id = employerId) {
  return createTokenEvalContext(storage, undefined, {
    seeds: [{ name: "employer", entity: { kind: "employer", row: { id } } }],
  });
}
afterEach(() => { gates.ledgerEnabled = true; });

describe("compliance tokens in the existing template evaluator", () => {
  it("renders all individual leaves and the legacy message from one report for the seeded employer", async () => {
    const { raw, storage } = fixture();
    const result = await renderTokens([
      token("compliance_missing_periods"), token("compliance_delinquent_periods"),
      token("compliance_delinquent_total"), token("compliance_message"),
    ].join("\n"), seeded(storage));
    expect(result.output.split("\n")).toEqual([
      "May 2026, Aug 2026, Sep 2026, Oct 2026",
      "May 2026: 45.00; Oct 2026: 55.00",
      "100.00",
      "First Employer: Monthly (May 2026 – Oct 2026), accounts: Trust. Missing reporting periods: May 2026, Aug 2026, Sep 2026, Oct 2026. Delinquent statement periods: May 2026: 45.00; Oct 2026: 55.00. Total delinquent balance: 100.00.",
    ]);
    expect(raw.wizardEmployerMonthly.listAllEmployersWithUploadsForRange).toHaveBeenCalledTimes(1);
    const other = await renderTokens(token("compliance_delinquent_total"), seeded(storage, otherEmployerId));
    expect(other.output).toBe("999.00");
  });

  it("keeps the legacy contract and offers all three leaves without a new context or report kind", () => {
    expect(tokenPluginRegistry.list().filter(({ metadata }) =>
      metadata.id.startsWith("token.")).map(({ metadata }) => metadata.outputType)).toEqual([
      "value", "value", "value", "value",
    ]);
    for (const leaf of ["compliance_message", "compliance_missing_periods", "compliance_delinquent_periods", "compliance_delinquent_total"]) {
      expect(validateTokenExpressionForRoots(`employer.${leaf}(${argumentsText})`, ["employer"]).ok).toBe(true);
      expect(validateTokenExpressionForRoots(`employer.${leaf}(wizard="monthly")`, ["employer"]).ok).toBe(false);
      expect(validateTokenExpressionForRoots(`employer.${leaf}(${argumentsText}, invented="yes")`, ["employer"]).ok).toBe(false);
    }
  });

  it("supports an explicit smaller window and multiple stable account identifiers, deduplicating accounts", async () => {
    const { raw, storage } = fixture();
    const result = await renderTokens(token("compliance_missing_periods",
      `${argumentsText}, months="1", accounts="OTHER, TRUST, OTHER"`), seeded(storage));
    expect(result.output).toBe("Oct 2026");
    expect(raw.ledger.entries.getMonthlyDeltasByEntityAndAccount).toHaveBeenCalledWith(
      "employer", [employerId], [accountId, otherEmployerId], ["2026-10"],
    );
  });

  it("omitted and blank dates use the render clock, including a month boundary", async () => {
    const { raw, storage } = fixture();
    for (const [when, year, month] of [
      [new Date(2026, 11, 31), 2026, 12], [new Date(2027, 0, 1), 2027, 1],
    ] as const) {
      for (const dateArg of ["", ', date=""']) {
        const ctx = seeded(storage);
        ctx.now = when;
        await renderTokens(token("compliance_missing_periods", `wizard="monthly", account="TRUST"${dateArg}`), ctx);
        expect(raw.wizardEmployerMonthly.listAllEmployersWithUploadsForRange).toHaveBeenLastCalledWith(year, month, "monthly", 6);
      }
    }
  });

  it("invalid scope or unknown references render blank, never a false zero balance", async () => {
    const { storage } = fixture();
    for (const args of [
      'wizard="typo", account="TRUST"',
      'wizard="monthly", account="TYPO"',
      'wizard="monthly", account="", accounts="TRUST"',
      `${argumentsText}, accounts="TYPO"`,
      'wizard="monthly", account="TRUST", date="2026-13"',
      `${argumentsText}, months="25"`,
    ]) {
      expect((await renderTokens(token("compliance_delinquent_total", args), seeded(storage))).output).toBe("");
    }
  });

  it("refuses ledger-disabled reads and does not turn lookup failures into compliance", async () => {
    const { raw, storage } = fixture();
    gates.ledgerEnabled = false;
    expect((await renderTokens(token("compliance_delinquent_total"), seeded(storage))).output).toBe("");
    expect(raw.wizardEmployerMonthly.listAllEmployersWithUploadsForRange).not.toHaveBeenCalled();
    gates.ledgerEnabled = true;
    raw.ledger.entries.getMonthlyDeltasByEntityAndAccount.mockRejectedValue(new Error("Ledger unavailable"));
    await expect(renderTokens(token("compliance_delinquent_total"), seeded(storage))).rejects.toThrow("Ledger unavailable");
  });
});
