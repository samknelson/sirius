import { createHash } from "node:crypto";
import { isEdiCobra, type SegmentCoverage } from "./coverage-segments";
import type { EdiCoverageCandidate, EdiCoverageConflict, EdiCoverageDecision } from "@shared/edi-coverage-choices";

export const coverageKey = (r: Pick<SegmentCoverage, "workerId" | "benefitId" | "year" | "month">) =>
  `${r.workerId}|${r.benefitId}|${r.year}-${String(r.month).padStart(2, "0")}`;

/** Stable across JSONB key order and query ordering. */
export function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(
      Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
    return v;
}

/** Same canonical bytes as evidenceHash, without one large synchronous copy. */
export async function evidenceHashRecords(records: Record<string, readonly unknown[]>): Promise<string> {
  const hash = createHash("sha256");
  hash.update("{");
  let first = true;
  for (const key of Object.keys(records).sort()) {
    hash.update(`${first ? "" : ","}${JSON.stringify(key)}:[`);
    first = false;
    const rows = records[key];
    for (let i = 0; i < rows.length; i++) {
      hash.update(`${i ? "," : ""}${JSON.stringify(canonical(rows[i]))}`);
      if (i % 500 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    hash.update("]");
  }
  return hash.update("}").digest("hex");
}

export function competingSources(rows: readonly SegmentCoverage[]): boolean {
  return new Set(rows.map(r => `${r.sourceRelationId ?? ""}|${isEdiCobra(r.employerSiriusId)}`)).size > 1;
}

export function reviewConflict(
  candidates: EdiCoverageCandidate[], evidence: string, decisions: readonly EdiCoverageDecision[],
): EdiCoverageConflict {
  const key = coverageKey(candidates[0]);
  const saved = decisions.find(d => d.key === key);
  const valid = saved && saved.evidence === evidence && saved.reason.trim() && saved.decidedBy &&
    candidates.some(c => c.id === saved.selectedId);
  return { key, evidence, candidates, decision: valid ? saved : null, stale: !!saved && !valid };
}

/** One projection used before every deduplication, suppression and family join. */
export interface CoverageProjection {
  excludedIds: ReadonlySet<string>;
  decisions: EdiCoverageDecision[];
  fingerprint: string;
}
export function projectCoverage<T>(rows: readonly T[], projection: CoverageProjection | undefined, id: (r: T) => string): T[] {
  return projection ? rows.filter(r => !projection.excludedIds.has(id(r))) : [...rows];
}

export function approveConflict(
  conflict: EdiCoverageConflict, input: Record<string, unknown>, actor: string, now: string,
): EdiCoverageDecision {
  if (input.evidence !== conflict.evidence) throw new Error("Coverage evidence changed. Refresh Coverage sources and review again.");
  const candidate = conflict.candidates.find(c => c.id === input.selectedId);
  if (!candidate) throw new Error("Explicitly select a current coverage source.");
  if (candidate.familyIssue) throw new Error(candidate.familyIssue);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 2000) throw new Error("Supply a reason between 1 and 2000 characters.");
  if (!actor) throw new Error("An effective administrator is required.");
  return { key: conflict.key, evidence: conflict.evidence, selectedId: candidate.id,
    reason, decidedBy: actor, decidedAt: now, candidates: conflict.candidates };
}
