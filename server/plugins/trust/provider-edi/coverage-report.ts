import {
  EDI_COVERAGE_REASONS, type EdiCoverageAcknowledgement, type EdiCoverageConflict, type EdiCoverageEntry,
  type EdiCoverageEntryReason, type EdiCoverageRule, type EdiCoverageRunSummary,
} from "@shared/edi-coverage-choices";
import type { CoverageEvidence } from "./coverage-conflicts";

/** Run-owned presentation of an evidence read: what is saved, shown and downloaded. */

/** Report-data rows under this key hold the run's exclusion list, not file rows. */
export const COVERAGE_ENTRY_PK = "coverage-entry:";

export function coverageSummary(
  evidence: Pick<CoverageEvidence, "rule" | "exclusions" | "warnings" | "fingerprint" | "exclusionDigest">,
  acknowledgement: EdiCoverageAcknowledgement | null,
): EdiCoverageRunSummary {
  const byReason: Partial<Record<EdiCoverageEntryReason, number>> = {};
  for (const entry of [...evidence.exclusions, ...evidence.warnings])
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  return { rule: evidence.rule, exclusionCount: evidence.exclusions.length, warningCount: evidence.warnings.length,
    byReason, fingerprint: evidence.fingerprint, exclusionDigest: evidence.exclusionDigest, acknowledgement };
}

const SNAPSHOT_BYTES = 2_000_000;
/**
 * The wizard record keeps what the screen shows. A list too long for that is
 * shortened here and nowhere else: the run still excludes every record, the
 * counts stay exact, and the generated run saves the complete list.
 */
export function snapshotLists(exclusions: readonly EdiCoverageEntry[], warnings: readonly EdiCoverageEntry[]) {
  let bytes = 0;
  const take = (entries: readonly EdiCoverageEntry[]) => {
    const kept: EdiCoverageEntry[] = [];
    for (const entry of entries) {
      bytes += Buffer.byteLength(JSON.stringify(entry));
      if (bytes > SNAPSHOT_BYTES) break;
      kept.push(entry);
    }
    return kept;
  };
  const shownExclusions = take(exclusions);
  const shownWarnings = take(warnings);
  return { exclusions: shownExclusions, warnings: shownWarnings,
    shown: { exclusions: shownExclusions.length, warnings: shownWarnings.length } };
}

export function savedCoverageEntries(rows: readonly { pk: string; data: unknown }[]): EdiCoverageEntry[] {
  return rows.filter(row => row.pk.startsWith(COVERAGE_ENTRY_PK))
    .sort((a, b) => a.pk.localeCompare(b.pk))
    .map(row => (row.data as { coverageEntry: EdiCoverageEntry }).coverageEntry);
}

const RULE_LABEL: Record<EdiCoverageRule, string> = {
  "exclude-conflicting": "Conflicting coverage excluded (temporary rule)",
  "refuse-conflicting": "Conflicting coverage stops the run",
};
/** Names are free text: keep a spreadsheet from reading one as a formula. */
function cell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

type Described = Pick<EdiCoverageEntry, "personLabel" | "workerId" | "benefitLabel" | "benefitId" | "month" | "records">;
/** What every download says about one coverage record, in one order. */
const RECORD_HEADER = ["Person", "Person ID", "Benefit", "Benefit ID", "Coverage month",
  "Coverage record ID", "Employer", "Employer ID", "Employer Sirius ID", "Coverage source", "Subscriber",
  "Subscriber ID", "Source relationship ID", "COBRA classification"];
const recordCells = (entry: Described, record: Described["records"][number]) => [
  entry.personLabel, entry.workerId, entry.benefitLabel, entry.benefitId, entry.month,
  record.id, record.employerLabel, record.employerId, record.employerSiriusId ?? "",
  record.sourceRelationId ? "Dependent" : "Subscriber", record.subscriberLabel, record.subscriberWorkerId ?? "",
  record.sourceRelationId ?? "", record.isCobra ? "COBRA" : "Non-COBRA",
];
const csv = (lines: unknown[][]) => lines.map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";

/** One line per coverage record, so every record ID an entry names is a row. */
export function coverageEntriesCsv(entries: readonly EdiCoverageEntry[], rule: EdiCoverageRule): string {
  const lines: unknown[][] = [["Type", "Reason", "What it means", ...RECORD_HEADER, "Rule in force"]];
  for (const entry of entries) for (const record of entry.records) {
    lines.push([
      entry.kind === "exclusion" ? "Excluded" : "Warning (not excluded)",
      EDI_COVERAGE_REASONS[entry.reason].label, EDI_COVERAGE_REASONS[entry.reason].meaning,
      ...recordCells(entry, record), RULE_LABEL[rule],
    ]);
  }
  return csv(lines);
}

/** The same record detail without a feed run: nothing was excluded, so no type, reason or rule. */
export function coverageConflictsCsv(conflicts: readonly EdiCoverageConflict[]): string {
  const lines: unknown[][] = [RECORD_HEADER];
  for (const conflict of conflicts) for (const record of conflict.records) lines.push(recordCells(conflict, record));
  return csv(lines);
}
