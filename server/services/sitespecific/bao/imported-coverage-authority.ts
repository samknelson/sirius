import type { ImportedCoverageEvidence } from "../../../storage/worker-imported-coverage";
import { z } from "zod";

export type ImportedMonthAuthority = { state: "verified" } | { state: "unavailable"; explanation: string };
const unavailable = (explanation: string): ImportedMonthAuthority => ({ state: "unavailable", explanation });
const importReportSchema = z.object({
  loader: z.literal("t17-benefit-history"),
  dryRun: z.literal(false),
  verify: z.object({ status: z.literal("pass"), failures: z.literal(0) }),
  rejectGate: z.object({ status: z.literal("pass"), counts: z.record(z.literal(0)) }),
  blockingFindings: z.array(z.unknown()).length(0),
  detail: z.object({
    staged: z.number().int().positive().safe(),
    openEndThrough: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
    historicalEventEvidence: z.object({
      complete: z.literal(true), inclusiveCutoff: z.string(),
      stagedSpans: z.number().int().positive().safe(),
      processedSpans: z.number().int().positive().safe(),
      rejectedSpans: z.literal(0), verifyFailures: z.literal(0),
    }),
  }),
});

/** A desired positive span/anchor is NOT complete negative evidence.
 * The T17 all-history declaration is required; constrain it further to months
 * from this worker's first retained span through the declared import horizon. */
export function importedMonthAuthority(evidence: ImportedCoverageEvidence | null, year: number, month: number): ImportedMonthAuthority {
  const missing = "Imported history provenance is unavailable for this month.";
  if (!evidence?.identityVerified || !evidence.snapshotVerified) return unavailable(missing);
  const parsed = importReportSchema.safeParse(evidence.report);
  if (!parsed.success) {
    return unavailable("Imported source history is incomplete or has not been verified for this month.");
  }
  const detail = parsed.data.detail;
  const source = detail.historicalEventEvidence;
  const horizon = detail.openEndThrough;
  if (source.processedSpans !== source.stagedSpans || detail.staged !== source.stagedSpans ||
      source.inclusiveCutoff !== horizon) {
    return unavailable("Imported source history is incomplete or has not been verified for this month.");
  }
  const [endYear, endMonth] = horizon.split("-").map(Number);
  const index = year * 12 + month - 1;
  if (!Number.isSafeInteger(evidence.firstMonthIndex) || index < evidence.firstMonthIndex! ||
      index > endYear * 12 + endMonth - 1) {
    return unavailable("This month is outside verified imported source coverage.");
  }
  if (!Array.isArray(evidence.desiredMonthIndexes) || evidence.desiredMonthIndexes.includes(index)) {
    return unavailable("Imported positive coverage could not be confirmed in the available coverage records.");
  }
  return { state: "verified" };
}

export async function resolveImportedHistory(workerId: string, months: Array<{ year: number; month: number }>) {
  const results = new Map<number, ImportedMonthAuthority>();
  if (!months.length) return results;
  let evidence: ImportedCoverageEvidence | null = null;
  try {
    const { readWorkerImportedCoverageEvidence } = await import("../../../storage/worker-imported-coverage");
    evidence = await readWorkerImportedCoverageEvidence(workerId, months);
  } catch {
    // Absent staging, old schema, timeouts and failed reads never mean Inactive.
  }
  for (const { year, month } of months) {
    results.set(year * 12 + month - 1, importedMonthAuthority(evidence, year, month));
  }
  return results;
}
