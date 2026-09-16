import { contentHashOf } from "./sync";

export interface ExistingEmployerRate {
  effectiveYmd: string;
  rate: string;
  data: unknown;
}

export interface DesiredEmployerRate {
  date: string;
  rate: string;
}

export interface EmployerRateSnapshotRow {
  employerId: string;
  effectiveYmd: string;
  rate: string;
  data: unknown;
}

export interface EmployerRateSnapshot {
  rowCount: number;
  migrationOwnedRows: number;
  digest: string;
}

export function buildEmployerRateSnapshot(
  rows: EmployerRateSnapshotRow[],
): EmployerRateSnapshot {
  const normalized = rows
    .map((row) => ({
      employerId: row.employerId,
      effectiveYmd: row.effectiveYmd,
      rate: Number(row.rate).toFixed(4),
    }))
    .sort((a, b) =>
      a.employerId.localeCompare(b.employerId) ||
      a.effectiveYmd.localeCompare(b.effectiveYmd) ||
      a.rate.localeCompare(b.rate),
    );
  return {
    rowCount: normalized.length,
    migrationOwnedRows: rows.filter(
      (row) => (row.data as { source?: unknown } | null)?.source === "s1-migration",
    ).length,
    digest: contentHashOf(normalized),
  };
}

export function evaluateEmployerRateDurability(
  expected: EmployerRateSnapshot,
  actual: EmployerRateSnapshot,
): { status: "pass" | "fail"; failures: string[] } {
  const failures: string[] = [];
  if (actual.rowCount !== expected.rowCount) {
    failures.push(
      `hourly account row count changed after loader verification (${expected.rowCount} -> ${actual.rowCount})`,
    );
  }
  if (actual.digest !== expected.digest) {
    failures.push("hourly account employer/date/rate digest changed after loader verification");
  }
  if (actual.migrationOwnedRows !== expected.migrationOwnedRows) {
    failures.push(
      `migration-owned row count changed after loader verification (${expected.migrationOwnedRows} -> ${actual.migrationOwnedRows})`,
    );
  }
  return { status: failures.length === 0 ? "pass" : "fail", failures };
}

/**
 * A consumed fingerprint is only a safe fast path while the target still
 * contains every desired rate and no stale migration-owned dates.
 */
export function employerRatesMatchDesired(
  existing: ExistingEmployerRate[],
  desired: DesiredEmployerRate[],
): boolean {
  const desiredDates = new Set(desired.map((entry) => entry.date));
  const existingByDate = new Map(existing.map((row) => [row.effectiveYmd, row]));

  for (const entry of desired) {
    const row = existingByDate.get(entry.date);
    if (!row || Number(row.rate) !== Number(entry.rate)) return false;
  }

  return !existing.some(
    (row) =>
      (row.data as { source?: unknown } | null)?.source === "s1-migration" &&
      !desiredDates.has(row.effectiveYmd),
  );
}