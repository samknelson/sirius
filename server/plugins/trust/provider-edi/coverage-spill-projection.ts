import { coverageKey, setCoverageProjectionIndex, type CoverageProjection } from "./coverage-choices";
import { coverageSegments, type SegmentCoverage } from "./coverage-segments";
import { monthIndex, monthStart } from "./termination-policy";
import type { discoverCoverage } from "./coverage-review";

/** Compute starts in chronological order with only two adjacent groups live.
 * Monthly evidence and derived starts stay on disk, not in serving-process
 * Maps. Generation asks only for a member or a termination boundary. */
export async function spillCoverageProjection(
  review: Awaited<ReturnType<typeof discoverCoverage>>, projection: CoverageProjection,
) {
  const { store, budget } = review;
  const ordered = store.map<string>();
  let retainedRows = 0;
  const starts = store.map<{ person: string; start: number; end: number }>();
  const personKey = (row: SegmentCoverage) => `${row.workerId}|${row.benefitId}|`;
  const orderedKey = (person: string, month: number) => `${person}${String(month).padStart(8, "0")}`;
  let processed = 0;
  for (const key of review.groups.keys()) {
    const group = review.groups.get(key)!.filter(r => review.relevant.has(r.id) && !projection.excludedIds.has(r.id));
    if (!group.length) continue;
    const member = group[0];
    ordered.set(`${member.workerId}|${member.benefitId}|${String(monthIndex(member.year, member.month)).padStart(8, "0")}`, key);
    retainedRows += group.length;
    if (++processed % 100 === 0) await budget.yield();
  }
  let previous: SegmentCoverage[] = [];
  let previousStart = "";
  let segmentKey = "";
  for (const key of ordered.values()) {
    const group = review.groups.get(key)!.filter(r => review.relevant.has(r.id) && !projection.excludedIds.has(r.id));
    const member = group[0];
    const local = coverageSegments([...previous, ...group]);
    local.validateMonth(member);
    const start = local.start(member);
    const prior = previous[0];
    const joined = prior && prior.workerId === member.workerId && prior.benefitId === member.benefitId &&
      start === monthStart(monthIndex(prior.year, prior.month));
    const resolved = joined ? previousStart : start;
    const index = monthIndex(member.year, member.month);
    const startIndex = monthIndex(+resolved.slice(0, 4), +resolved.slice(5, 7));
    if (!joined) segmentKey = orderedKey(personKey(member), startIndex);
    starts.set(segmentKey, { person: personKey(member), start: startIndex, end: index });
    previous = group;
    previousStart = resolved;
    if (++processed % 100 === 0) await budget.yield();
  }
  store.check();
  return setCoverageProjectionIndex(projection, {
    byId: { size: retainedRows, get: id => projection.excludedIds.has(id) ? undefined : review.relevant.get(id) },
    byPerson: new Map(), events: review.events,
    relation: id => review.relationMap.get(id),
    rowsForMonth: (workerId, benefitId, year, month) =>
      (review.groups.get(coverageKey({ workerId, benefitId, year, month })) ?? [])
        .filter(r => review.relevant.has(r.id) && !projection.excludedIds.has(r.id)),
    segments: {
      start(member) {
        const index = monthIndex(member.year, member.month);
        const segment = starts.floor(orderedKey(personKey(member), index));
        if (!segment || segment.person !== personKey(member) || segment.end < index)
          throw new Error(`WMB ${member.id}: coverage history changed or is missing.`);
        return monthStart(segment.start);
      },
      validateMonth(member) {
        this.start(member);
      },
    },
    dispose: review.dispose,
  });
}
