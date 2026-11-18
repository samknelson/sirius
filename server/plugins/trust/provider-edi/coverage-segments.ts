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

export function coverageSegments(rows: readonly SegmentCoverage[]) {
  const months = new Map<string, SegmentCoverage[]>();
  const starts = new Map<string, number>();
  const validated = new Set<string>();
  for (const row of rows) {
    const key = `${row.workerId}|${row.benefitId}|${monthIndex(row.year, row.month)}`;
    const group = months.get(key) ?? [];
    group.push(row);
    months.set(key, group);
  }
  return {
    start(member: SegmentCoverage): string {
      let index = monthIndex(member.year, member.month);
      const cobra = isEdiCobra(member.employerSiriusId);
      const path: string[] = [];
      for (;;) {
        const key = `${member.workerId}|${member.benefitId}|${index}`;
        const group = months.get(key) ?? [];
        // Even a boundary month must be unambiguous before it can establish
        // that the previous segment had a different classification.
        if (!validated.has(key)) {
          assertUnmixedCoverage(group);
          assertSingleFamily(group);
          validated.add(key);
        }
        if (!group.length || group[0].sourceRelationId !== member.sourceRelationId ||
            isEdiCobra(group[0].employerSiriusId) !== cobra) break;
        const cached = starts.get(key);
        if (cached !== undefined) { index = cached - 1; break; }
        path.push(key);
        index--;
      }
      for (const key of path) starts.set(key, index + 1);
      return monthStart(index + 1);
    },
    validateMonth(member: SegmentCoverage): void {
      const group = months.get(`${member.workerId}|${member.benefitId}|${monthIndex(member.year, member.month)}`) ?? [];
      assertUnmixedCoverage(group);
      assertSingleFamily(group);
    },
  };
}
