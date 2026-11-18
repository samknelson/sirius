import { createHash } from "node:crypto";
import { coverageSegments, isEdiCobra, type SegmentCoverage } from "./coverage-segments";
import type { EdiCoverageCandidate, EdiCoverageConflict, EdiCoverageDecision } from "@shared/edi-coverage-choices";
import type { trustWmbEvents, workerRelations } from "@shared/schema";

/** Retain family authority, not arbitrary relation metadata. The digest still
 * invalidates approvals if that metadata changes between checks. */
export type CoverageRelation = Pick<typeof workerRelations.$inferSelect,
  "id" | "worker1" | "worker2" | "relationType" | "startYmd" | "endYmd"> & { dataFingerprint?: string | null };

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
export async function evidenceHashRecords(records: Record<string, Iterable<unknown>>): Promise<string> {
  const hash = createHash("sha256");
  hash.update("{");
  let first = true;
  for (const key of Object.keys(records).sort()) {
    hash.update(`${first ? "" : ","}${JSON.stringify(key)}:[`);
    first = false;
    const rows = records[key];
    let i = 0;
    for (const row of rows) {
      hash.update(`${i ? "," : ""}${JSON.stringify(canonical(row))}`);
      if (i % 500 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      i++;
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
// Ephemeral only: never serialize raw history into wizard JSON or decisions.
export interface CoverageProjectionIndex {
  byId: Pick<Map<string, SegmentCoverage>, "get" | "size">;
  byPerson: Map<string, SegmentCoverage[]>;
  segments: ReturnType<typeof coverageSegments>;
  events?: (typeof trustWmbEvents.$inferSelect)[];
  relations?: CoverageRelation[];
  rowsForMonth?: (workerId: string, benefitId: string, year: number, month: number) => SegmentCoverage[];
  relation?: (id: string) => CoverageRelation | undefined;
  dispose?: () => void;
}
const indexes = new WeakMap<CoverageProjection, CoverageProjectionIndex>();
export function setCoverageProjectionIndex(projection: CoverageProjection, index: CoverageProjectionIndex) {
  indexes.set(projection, index);
  return projection;
}
export function indexCoverageProjection(projection: CoverageProjection, rows: readonly SegmentCoverage[],
  events?: (typeof trustWmbEvents.$inferSelect)[], relations?: CoverageRelation[]) {
  const retained = rows.filter(row => !projection.excludedIds.has(row.id));
  const byPerson = new Map<string, SegmentCoverage[]>();
  for (const row of retained) {
    const group = byPerson.get(row.workerId) ?? [];
    group.push(row); byPerson.set(row.workerId, group);
  }
  indexes.set(projection, {
    byId: new Map(retained.map(row => [row.id, row])),
    segments: coverageSegments(retained),
    events, relations,
    byPerson,
  });
  return projection;
}
export const coverageProjectionIndex = (projection?: CoverageProjection) => projection ? indexes.get(projection) : undefined;
export const releaseCoverageProjectionIndex = (projection: CoverageProjection) => {
  indexes.get(projection)?.dispose?.();
  indexes.delete(projection);
};
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
