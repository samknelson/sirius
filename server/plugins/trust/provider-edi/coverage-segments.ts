import { monthIndex, monthStart } from "./termination-policy";

/** Membership EDI only: never infer classification from names or database IDs. */
export const COBRA_EMPLOYER_SIRIUS_IDS = ["COBRA", "13226164"];
export const isEdiCobra = (siriusId: string | null | undefined): boolean =>
  COBRA_EMPLOYER_SIRIUS_IDS.includes(siriusId ?? "");

export interface SegmentCoverage {
  id: string;
  workerId: string;
  benefitId: string;
  year: number;
  month: number;
  employerId: string;
  employerSiriusId?: string | null;
  sourceRelationId: string | null;
}

/** Validate BEFORE precedence/deduplication, across all family sources. */
export function assertUnmixedCoverage(rows: readonly SegmentCoverage[]): void {
  if (!rows.length || new Set(rows.map(r => isEdiCobra(r.employerSiriusId))).size < 2) return;
  const first = rows[0];
  const details = [...rows].sort((a, b) => a.id.localeCompare(b.id))
    .map(r => `WMB ${r.id}, employer ${r.employerId} (Sirius ID ${r.employerSiriusId ?? "none"}, ${isEdiCobra(r.employerSiriusId) ? "COBRA" : "non-COBRA"})`);
  throw new Error(`Correction required: mixed COBRA/non-COBRA coverage for person ${first.workerId}, benefit ${first.benefitId}, coverage month ${monthStart(monthIndex(first.year, first.month)).slice(0, 7)}. ${details.join("; ")}. Correct the conflicting coverage records before regenerating; neither classification takes precedence.`);
}

/** A same-class overlap is equivalent only within the same family source. */
function assertSingleFamily(rows: readonly SegmentCoverage[]): void {
  if (!rows.length || new Set(rows.map(r => r.sourceRelationId)).size < 2) return;
  const first = rows[0];
  const details = [...rows].sort((a, b) => a.id.localeCompare(b.id))
    .map(r => `WMB ${r.id}, source relation ${r.sourceRelationId ?? "subscriber (none)"}`);
  throw new Error(`Correction required: ambiguous subscriber/dependent ownership for person ${first.workerId}, benefit ${first.benefitId}, coverage month ${monthStart(monthIndex(first.year, first.month)).slice(0, 7)}. ${details.join("; ")}. Distinct families cannot be deduplicated.`);
}

/**
 * Every record of one person, benefit and month. Used wherever a month reaches
 * a file without the temporary exclusion rule having removed its conflicts.
 */
export function assertUnambiguousMonth(rows: readonly SegmentCoverage[]): void {
  assertUnmixedCoverage(rows);
  assertSingleFamily(rows);
}
