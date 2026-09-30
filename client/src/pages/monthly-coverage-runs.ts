import type { MonthlyCoverageRow } from "./worker-monthly-coverage-history";

export type CoverageRunStatus = MonthlyCoverageRow["status"] | "unenrolled";
export type CoverageRun = { status: CoverageRunStatus; rows: MonthlyCoverageRow[] };

/** Only the scan's explicit, sole no-election failure can mean Unenrolled. */
export function coverageRunStatus(row: MonthlyCoverageRow): CoverageRunStatus {
  return row.status === "inactive" &&
    row.reasons.length === 1 &&
    row.reasons[0].trim() === "No Election"
    ? "unenrolled"
    : row.status;
}

export function coverageRunLabel(status: CoverageRunStatus): string {
  if (status === "active") return "Active";
  if (status === "inactive") return "Inactive";
  if (status === "unenrolled") return "Unenrolled";
  return "Not confirmed";
}

/** Group the entire loaded, newest-first sequence, not each API page separately. */
export function groupCoverageRuns(rows: MonthlyCoverageRow[]): CoverageRun[] {
  const runs: CoverageRun[] = [];
  for (const row of rows) {
    const status = coverageRunStatus(row);
    const last = runs[runs.length - 1];
    const oldest = last?.rows[last.rows.length - 1].coverageMonth;
    const adjacent = oldest &&
      oldest.year * 12 + oldest.month - (row.coverageMonth.year * 12 + row.coverageMonth.month) === 1;
    if (last && last.status === status && adjacent) last.rows.push(row);
    else runs.push({ status, rows: [row] });
  }
  return runs;
}