export interface ExistingEmployerRate {
  effectiveYmd: string;
  rate: string;
  data: unknown;
}

export interface DesiredEmployerRate {
  date: string;
  rate: string;
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