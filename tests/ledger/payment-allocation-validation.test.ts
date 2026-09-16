import { describe, expect, it } from "vitest";
import { validateProposedAllocation } from "../../server/modules/ledger/payments";

function details(
  allocations: Array<{ eaId: string; amount: string; statementYmd: string }>,
) {
  return {
    merchant: "Unrelated detail is preserved by callers",
    proposedAllocation: allocations,
  };
}

describe("payment proposed-allocation validation", () => {
  it("accepts exact multi-participant, multi-period allocations", () => {
    const result = validateProposedAllocation(
      details([
        { eaId: "ea-1", amount: "10.01", statementYmd: "2026-01-01" },
        { eaId: "ea-1", amount: "20.02", statementYmd: "2026-02-01" },
        { eaId: "ea-2", amount: "30.03", statementYmd: "2026-01-01" },
      ]),
      "60.06",
    );

    expect(result.valid).toBe(true);
    expect(result.allocations).toHaveLength(3);
  });

  it.each([
    ["1.001", "fractional cent"],
    ["1e2", "exponent notation"],
    ["-1.00", "negative"],
    ["0.00", "zero"],
    ["NaN", "not a number"],
  ])("rejects malformed allocation amount %s (%s)", (amount) => {
    const result = validateProposedAllocation(
      details([{ eaId: "ea-1", amount, statementYmd: "2026-01-01" }]),
      "1.00",
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("valid amount");
  });

  it.each(["1", "1.0", "1.00"])(
    "accepts exact monetary amount %s",
    (amount) => {
      expect(
        validateProposedAllocation(
          details([{ eaId: "ea-1", amount, statementYmd: "2026-01-01" }]),
          amount,
        ).valid,
      ).toBe(true);
    },
  );

  it("rejects malformed payment amounts instead of rounding them", () => {
    const result = validateProposedAllocation(
      details([{ eaId: "ea-1", amount: "1.00", statementYmd: "2026-01-01" }]),
      "1.001",
    );
    expect(result).toMatchObject({
      valid: false,
      error: "Payment amount must be an exact monetary value",
    });
  });

  it("compares totals in integer cents", () => {
    const result = validateProposedAllocation(
      details([
        { eaId: "ea-1", amount: "0.10", statementYmd: "2026-01-01" },
        { eaId: "ea-1", amount: "0.20", statementYmd: "2026-02-01" },
      ]),
      "0.30",
    );
    expect(result.valid).toBe(true);
  });

  it("rejects duplicate participant and statement-period pairs", () => {
    const result = validateProposedAllocation(
      details([
        { eaId: "ea-1", amount: "1.00", statementYmd: "2026-01-01" },
        { eaId: "ea-1", amount: "1.00", statementYmd: "2026-01-01" },
      ]),
      "2.00",
    );
    expect(result.error).toContain("Duplicate");
  });

  it.each(["2026-02-30", "2026-13-01", "not-a-date"])(
    "rejects invalid statement date %s",
    (statementYmd) => {
      const result = validateProposedAllocation(
        details([{ eaId: "ea-1", amount: "1.00", statementYmd }]),
        "1.00",
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/statementYmd|calendar date/);
    },
  );

  it("rejects a total that differs by one cent", () => {
    const result = validateProposedAllocation(
      details([{ eaId: "ea-1", amount: "9.99", statementYmd: "" }]),
      "10.00",
    );
    expect(result.error).toContain("must equal");
  });

  it("allows omitted allocations for status-only and memo-only updates", () => {
    expect(validateProposedAllocation({ merchant: "kept" }, "10.00")).toEqual({
      valid: true,
    });
  });
});