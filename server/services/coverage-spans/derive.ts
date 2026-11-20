import type {
  CoverageFamilyIdentity, CoverageSourceRecord, CoverageSpanFact, CoverageSpanPayload,
  CoverageIssueFact,
} from "@shared/coverage-span";

export interface CoverageEndingEvidence {
  id: string;
  workerId: string;
  benefitId: string;
  year: number;
  month: number;
  data: unknown;
  /** Latest retained successful action, including a contradicting decision. */
  decision: "confirmed" | "contradicted" | "unsupported";
  scanId?: string;
}
const index = (r: { year: number; month: number }) => r.year * 12 + r.month - 1;
const month = (n: number) => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}-01`;
const cobra = (r: CoverageSourceRecord) => r.employerSiriusId === "COBRA" || r.employerSiriusId === "13226164";
const source = (r: CoverageSourceRecord) => JSON.stringify([r.sourceRelationId, cobra(r)]);
const key = (r: CoverageSourceRecord) => JSON.stringify([r.workerId, r.benefitId, index(r)]);
const sorted = (rows: CoverageSourceRecord[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Derive one receiving worker. Input includes complete subscriber months, not
 * only the rows selected through one relationship. No dates on relationships
 * enter this function: eligibility owns entitlement; relationships identify.
 * No employer identity is part of a segment key, only its COBRA classification.
 */
export function deriveCoverageSpans(
  workerId: string,
  coverage: readonly CoverageSourceRecord[],
  families: readonly CoverageFamilyIdentity[],
  events: readonly CoverageEndingEvidence[],
): CoverageSpanPayload {
  const groups = new Map<string, CoverageSourceRecord[]>();
  for (const row of coverage) {
    if (!Number.isInteger(row.year) || !Number.isInteger(row.month) || row.month < 1 || row.month > 12)
      throw new Error(`Invalid coverage month on WMB ${row.id}`);
    const group = groups.get(key(row)) ?? [];
    group.push(row);
    groups.set(key(row), group);
  }
  const relations = new Map(families.map(r => [r.id, r]));
  const conflicts = new Set([...groups].filter(([, rows]) =>
    new Set(rows.map(source)).size > 1).map(([k]) => k));
  const issues: CoverageIssueFact[] = [];
  const spans: CoverageSpanFact[] = [];
  const latest = new Map<string, CoverageSpanFact>();
  const continuity = new Map<string, { start: string; last: number }>();
  const own = [...groups.values()].filter(rows => rows[0].workerId === workerId)
    .sort((a, b) => index(a[0]) - index(b[0]) || a[0].benefitId.localeCompare(b[0].benefitId));
  for (const rows of own) {
    const row = rows[0];
    let reason: CoverageIssueFact["reason"] | undefined;
    let parents: CoverageSourceRecord[] = [];
    if (conflicts.has(key(row))) reason = "conflicting-coverage";
    else if (row.sourceRelationId) {
      const relation = relations.get(row.sourceRelationId);
      if (!relation || relation.worker2 !== workerId || relation.worker1 === workerId)
        reason = "invalid-family-identity";
      else {
        const parentKey = key({ ...row, workerId: relation.worker1 });
        parents = groups.get(parentKey) ?? [];
        if (conflicts.has(parentKey)) reason = "subscriber-excluded";
        else if (!parents.some(p => p.sourceRelationId === null)) reason = "subscriber-missing";
      }
    }
    if (reason) issues.push({
      workerId, benefitId: row.benefitId, month: month(index(row)), reason,
      records: sorted(rows), relatedRecords: sorted(parents),
    });
    // Keep every competing class, visibly unusable. A historical conflict
    // affects that month alone; later unambiguous coverage remains usable.
    for (const candidate of sorted(rows).filter((r, i, all) =>
      all.findIndex(other => source(other) === source(r)) === i)) {
      const relation = candidate.sourceRelationId ? relations.get(candidate.sourceRelationId) : undefined;
      const subscriberWorkerId = candidate.sourceRelationId
        ? relation?.worker2 === workerId ? relation.worker1 : null
        : workerId;
      const segmentKey = JSON.stringify([candidate.benefitId, source(candidate), subscriberWorkerId, !reason]);
      const previous = latest.get(segmentKey);
      const current = month(index(candidate));
      const continuityKey = JSON.stringify([candidate.benefitId, source(candidate), subscriberWorkerId]);
      const run = continuity.get(continuityKey);
      const continuityStartMonth = run?.last === index(candidate) - 1 ? run.start : current;
      continuity.set(continuityKey, { start: continuityStartMonth, last: index(candidate) });
      if (previous && previous.lastCoveredMonth === month(index(candidate) - 1)) {
        previous.lastCoveredMonth = current;
      } else {
        const span: CoverageSpanFact = {
          workerId, benefitId: candidate.benefitId, sourceRelationId: candidate.sourceRelationId,
          subscriberWorkerId, isCobra: cobra(candidate), startMonth: current,
          continuityStartMonth,
          lastCoveredMonth: current, usable: !reason, ending: null,
        };
        spans.push(span);
        latest.set(segmentKey, span);
      }
    }
  }
  for (const event of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
    if (event.workerId !== workerId) continue;
    const eventIndex = index(event);
    // Preserve existing carrier semantics: ANY later reinstatement retires an
    // ending, including coverage after the selected report month.
    if (own.some(rows => rows[0].benefitId === event.benefitId && index(rows[0]) >= eventIndex)) continue;
    const previous = groups.get(key({
      workerId, benefitId: event.benefitId, ...{
        year: Math.floor((eventIndex - 1) / 12), month: (eventIndex - 1) % 12 + 1,
      },
    } as CoverageSourceRecord)) ?? [];
    const inferred = !!event.data && typeof event.data === "object" &&
      (event.data as Record<string, unknown>).provenance === "coverage_inferred";
    const problem = !previous.length ? "termination-coverage-missing"
      : inferred && event.decision === "contradicted" ? "contradicted-inference"
      : !inferred && event.decision !== "confirmed" ? "unsupported-termination" : undefined;
    if (problem) {
      issues.push({ workerId, benefitId: event.benefitId, month: month(eventIndex),
        reason: problem, records: sorted(previous), relatedRecords: [], eventId: event.id, scanId: event.scanId });
      continue;
    }
    for (const span of spans) if (span.benefitId === event.benefitId &&
      span.lastCoveredMonth === month(eventIndex - 1)) {
      span.ending = {
        month: month(eventIndex),
        reason: inferred ? "retained-coverage-inference" : "confirmed-continuation-failure",
        eventId: event.id, eventData: event.data, scanId: event.scanId,
      };
    }
  }
  return {
    spans: spans.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    issues: issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}
