import { describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";
import { registerTokenPlugin } from "../../server/plugins/tokens/registry";
import { createTokenEvalContext, renderTokens, validateTokenExpressionForRoots } from "../../server/plugins/tokens/evaluate";
import "../../server/plugins/tokens/plugins/compliance";

vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/plugins/_core/gating", () => ({ isPluginComponentEnabledSync: () => true }));

registerTokenPlugin({
  metadata: { id: "test.report.participant", name: "Participant", description: "Test send",
    segmentName: "bulk_participant", inputTypes: ["root"], outputType: "bulk_participant" },
  async resolve(_entity, _args, ctx) { return ctx.roots.bulk_participant ?? null; },
});

const snapshot = {
  scope: { wizardType: "monthly", year: 2026, month: 10, monthsBack: 6,
    ledgerAccountIds: ["00000000-0000-0000-0000-000000000001"] },
  runAt: new Date(2026, 9, 13, 12).toISOString(),
  wizardName: "Monthly report", accountName: "Legal trust",
  employerByContact: { recipient: "employer-a" },
  valuesByEmployer: {
    "employer-a": { employer_name: "Example employer", missing_periods: "Jun 2026",
      delinquent_periods: "May 2026: 12.50; Oct 2026: 7.50", delinquent_total: "20.00",
      period_window: "May 2026 – Oct 2026" },
  },
};

function fixture(data: unknown = { complianceReport: structuredClone(snapshot) }, contactId = "recipient") {
  const getById = vi.fn().mockResolvedValue({ id: "message", data });
  const storage = { bulkMessages: { getById } } as unknown as IStorage;
  const ctx = createTokenEvalContext(storage, contactId, {
    seeds: [{ name: "bulk_participant",
      entity: { kind: "bulk_participant", row: { messageId: "message", contactId, medium: "email" } } }],
  });
  ctx.now = new Date(2027, 2, 1);
  return { ctx, getById };
}

const token = (leaf: string, args = "") =>
  `{{bulk_participant.compliance_employer.${leaf}${args ? `(${args})` : ""}}}`;

describe("saved compliance report tokens", () => {
  it("offers argument-free report tokens in the existing bulk token context", () => {
    for (const leaf of ["compliance_missing_periods", "compliance_delinquent_periods",
      "compliance_delinquent_total", "compliance_period_window", "compliance_anchor_month",
      "compliance_report_run_date"]) {
      expect(validateTokenExpressionForRoots(
        `bulk_participant.compliance_employer.${leaf}`, ["bulk_participant"],
      ).ok).toBe(true);
    }
  });

  it("uses the captured employer, results, anchor and run date even when delivered months later", async () => {
    const { ctx, getById } = fixture();
    const result = await renderTokens([
      token("compliance_missing_periods"), token("compliance_delinquent_periods"),
      token("compliance_delinquent_total"), token("compliance_period_window"),
      token("compliance_anchor_month"), token("compliance_report_run_date"),
    ].join("\n"), ctx);
    expect(result.output.split("\n")).toEqual([
      "Jun 2026", "May 2026: 12.50; Oct 2026: 7.50", "20.00",
      "May 2026 – Oct 2026", "2026-10", "2026-10-13",
    ]);
    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith("message");
  });

  it("does not let legacy account/month arguments override the saved report", async () => {
    const { ctx } = fixture();
    expect((await renderTokens(token("compliance_delinquent_total",
      'wizard="different", account="OTHER", date="2027-03", months="1"'), ctx)).output).toBe("20.00");
  });

  it("refuses recipients outside the report and messages without a report", async () => {
    for (const { ctx } of [fixture({}, "recipient"), fixture(undefined, "unrelated")]) {
      await expect(renderTokens(token("compliance_delinquent_total"), ctx)).rejects.toThrow(/requires|not associated/);
    }
  });

  it("does not turn a malformed report into a current-month lookup or a false zero", async () => {
    const { ctx } = fixture({ complianceReport: { ...snapshot, runAt: "bad" } });
    await expect(renderTokens(token("compliance_delinquent_total"), ctx)).rejects.toThrow("saved compliance report is invalid");
  });
});
