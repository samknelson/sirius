import { describe, expect, it } from "vitest";
import { coverageRunStatus, groupCoverageRuns } from "../../client/src/pages/monthly-coverage-runs";
import type { MonthlyCoverageRow } from "../../client/src/pages/worker-monthly-coverage-history";

function row(year: number, month: number, status: MonthlyCoverageRow["status"], reasons: string[] = []): MonthlyCoverageRow {
  return {
    coverageMonth: { year, month, label: `${month}/${year}` },
    workMonth: { year, month, label: `${month}/${year}` },
    hours: null, status, reasons, medical: [], dental: [], other: [], charge: null,
  };
}

describe("monthly coverage runs", () => {
  it("joins contiguous months even when a page boundary falls inside the run", () => {
    const firstPage = [row(2026, 1, "active"), row(2025, 12, "active")];
    const secondPage = [row(2025, 11, "active"), row(2025, 10, "inactive")];
    expect(groupCoverageRuns([...firstPage, ...secondPage]).map((run) => run.rows.length)).toEqual([3, 1]);
  });

  it("splits same-status months across a missing calendar month and across unknown decisions", () => {
    const runs = groupCoverageRuns([
      row(2025, 6, "active"), row(2025, 4, "active"),
      row(2025, 3, "unknown"), row(2025, 2, "inactive"), row(2025, 1, "unknown"),
    ]);
    expect(runs.map((run) => run.status)).toEqual(["active", "active", "unknown", "inactive", "unknown"]);
  });

  it("never guesses no election from missing coverage or hours, and keeps mixed failures inactive", () => {
    expect(coverageRunStatus(row(2025, 5, "inactive", ["No Election"]))).toBe("unenrolled");
    expect(coverageRunStatus(row(2025, 5, "inactive", [" No Election "]))).toBe("unenrolled");
    expect(coverageRunStatus(row(2025, 5, "inactive", ["No Election", "Low Hours"]))).toBe("inactive");
    expect(coverageRunStatus(row(2025, 5, "inactive"))).toBe("inactive");
    expect(coverageRunStatus(row(2025, 5, "unknown", ["No Election"]))).toBe("unknown");
    expect(coverageRunStatus(row(2025, 5, "active", ["No Election"]))).toBe("active");
  });
});