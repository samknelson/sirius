import { describe, expect, it } from "vitest";
import { summarizeDependentCoverage } from "../../client/src/pages/monthly-dependent-coverage";
import { groupCoverageRuns } from "../../client/src/pages/monthly-coverage-runs";
import type { MonthlyCoverageRow } from "../../client/src/pages/worker-monthly-coverage-history";

function row(year: number, month: number, benefitIds: string[] | null = ["m"]): MonthlyCoverageRow {
  return {
    coverageMonth: { year, month, label: `${month}/${year}` }, workMonth: { year, month, label: "" },
    status: "unknown", reasons: [], hours: null, medical: [], dental: [], other: [], charge: null,
    dependentCoverage: benefitIds === null ? { state: "unavailable", dependents: null } : {
      state: "available", dependents: benefitIds.length ? [{
        personId: "child", name: "Child", relationship: "Child",
        benefits: benefitIds.map((id) => ({ id, name: id, icon: null, color: null })),
      }] : [],
    },
  };
}

describe("dependent ranges inside status spans", () => {
  it("merges pages and year boundaries with an order-independent benefit set", () => {
    const pages = [[row(2026, 1, ["m", "d"])], [row(2025, 12, ["d", "m"]), row(2025, 11, ["d", "m"])]];
    const summary = summarizeDependentCoverage(pages.flat());
    expect(summary.people[0].ranges).toHaveLength(1);
    expect(summary.people[0].ranges[0]).toMatchObject({ from: { label: "11/2025" }, through: { label: "1/2026" } });
    expect(summary.unavailableMonths).toBe(0);
    expect(groupCoverageRuns(pages.flat())).toHaveLength(1);
  });

  it("splits gaps, changed benefits, unavailable months, and missing calendar months, not status runs", () => {
    const rows = [row(2025, 9), row(2025, 8, []), row(2025, 7), row(2025, 6, ["d"]),
      row(2025, 5, null), row(2025, 4, ["d"]), row(2025, 2, ["d"])];
    const summary = summarizeDependentCoverage(rows);
    expect(summary.people[0].ranges.map(({ from, through }) => [from.month, through.month]))
      .toEqual([[2, 2], [4, 4], [6, 6], [7, 7], [9, 9]]);
    expect(summary.unavailableMonths).toBe(1);
    expect(groupCoverageRuns(rows)).toHaveLength(2); // Only the missing calendar month splits it.
  });

  it("distinguishes no coverage from unavailable evidence and preserves separate people", () => {
    expect(summarizeDependentCoverage([row(2025, 1, [])])).toEqual({ people: [], unavailableMonths: 0 });
    expect(summarizeDependentCoverage([row(2025, 1, null)])).toEqual({ people: [], unavailableMonths: 1 });
    const multiple = row(2025, 1);
    if (multiple.dependentCoverage?.state !== "available") throw new Error("Fixture unavailable");
    multiple.dependentCoverage.dependents.push({
      personId: "spouse", name: "Spouse", relationship: null,
      benefits: [{ id: "d", name: "Dental", icon: null, color: null }],
    });
    expect(summarizeDependentCoverage([multiple]).people.map(({ personId }) => personId)).toEqual(["child", "spouse"]);
  });
});
