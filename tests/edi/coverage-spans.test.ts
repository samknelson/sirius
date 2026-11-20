import { describe, expect, it } from "vitest";
import { deriveCoverageSpans, type CoverageEndingEvidence } from "../../server/services/coverage-spans/derive";
import type { CoverageSourceRecord } from "@shared/coverage-span";

const row = (month: number, extra: Partial<CoverageSourceRecord> = {}): CoverageSourceRecord => ({
  id: `w-${month}`, workerId: "worker", benefitId: "benefit", year: 2026, month,
  employerId: "ordinary", employerSiriusId: "ordinary", sourceRelationId: null, ...extra,
});
const event = (extra: Partial<CoverageEndingEvidence> = {}): CoverageEndingEvidence => ({
  id: "end", workerId: "worker", benefitId: "benefit", year: 2026, month: 4,
  data: { failedPlugins: [{ pluginKey: "hours", reason: "Insufficient hours" }] }, decision: "confirmed", ...extra,
});

describe("carrier-neutral coverage derivation", () => {
  it("merges ordinary employer changes, separates gaps and never invents endings", () => {
    const result = deriveCoverageSpans("worker", [row(1), row(2, { employerId: "other" }), row(4)], [], []);
    expect(result.spans.map(s => [s.startMonth, s.lastCoveredMonth, s.ending]))
      .toEqual([["2026-01-01", "2026-02-01", null], ["2026-04-01", "2026-04-01", null]]);
  });
  it("separates COBRA without terminating continuing benefits", () => {
    const result = deriveCoverageSpans("worker", [row(3), row(4, { employerSiriusId: "COBRA" })], [], [event()]);
    expect(result.spans).toHaveLength(2);
    expect(result.spans.every(s => s.ending === null)).toBe(true);
  });
  it("separates source changes without treating relationship dates as entitlement", () => {
    const result = deriveCoverageSpans("worker", [
      row(1), row(2, { sourceRelationId: "family" }), row(2, { id: "parent", workerId: "parent" }),
    ], [{ id: "family", worker1: "parent", worker2: "worker" }], []);
    expect(result.issues).toEqual([]);
    expect(result.spans).toHaveLength(2);
    expect(result.spans.find(s => s.sourceRelationId)).toMatchObject({ subscriberWorkerId: "parent", usable: true });
  });
  it("retains all conflicts without poisoning later coverage or losing continuity", () => {
    const result = deriveCoverageSpans("worker", [
      row(1), row(2), row(2, { id: "competing", employerSiriusId: "COBRA" }), row(3),
    ], [], []);
    expect(result.issues[0].records.map(r => r.id)).toEqual(["competing", "w-2"]);
    expect(result.spans.find(s => s.startMonth === "2026-03-01"))
      .toMatchObject({ usable: true, continuityStartMonth: "2026-01-01" });
  });
  it("cascades subscriber conflicts and retains missing and invalid families", () => {
    const child = row(2, { sourceRelationId: "family" });
    const family = { id: "family", worker1: "parent", worker2: "worker" };
    expect(deriveCoverageSpans("worker", [child], [], []).issues[0].reason).toBe("invalid-family-identity");
    expect(deriveCoverageSpans("worker", [child], [family], []).issues[0].reason).toBe("subscriber-missing");
    const result = deriveCoverageSpans("worker", [child,
      row(2, { id: "p1", workerId: "parent" }),
      row(2, { id: "p2", workerId: "parent", employerSiriusId: "13226164" }),
    ], [family], []);
    expect(result.issues[0]).toMatchObject({ reason: "subscriber-excluded", relatedRecords: [{ id: "p1" }, { id: "p2" }] });
    expect(result.spans[0].usable).toBe(false);
  });
  it("requires retained evidence and distinguishes inferred from confirmed reasons", () => {
    const coverage = [row(2), row(3)];
    expect(deriveCoverageSpans("worker", coverage, [], [event()]).spans[0].ending)
      .toMatchObject({ month: "2026-04-01", reason: "confirmed-continuation-failure" });
    const inferred = event({ data: { provenance: "coverage_inferred" }, decision: "unsupported" });
    expect(deriveCoverageSpans("worker", coverage, [], [inferred]).spans[0].ending?.reason)
      .toBe("retained-coverage-inference");
    expect(deriveCoverageSpans("worker", coverage, [], [{ ...inferred, decision: "contradicted" }]).issues[0].reason)
      .toBe("contradicted-inference");
    expect(deriveCoverageSpans("worker", coverage, [], [event({ decision: "unsupported" })]).issues[0].reason)
      .toBe("unsupported-termination");
  });
  it("retires endings for any reinstatement and retains orphan ending issues", () => {
    expect(deriveCoverageSpans("worker", [row(3), row(7)], [], [event()]).spans.every(s => !s.ending)).toBe(true);
    expect(deriveCoverageSpans("worker", [], [], [event()]).issues[0].reason).toBe("termination-coverage-missing");
  });
  it("converges independently of input ordering and handles delete/reinsert correction", () => {
    const input = [row(1), row(2), row(3)];
    const expected = deriveCoverageSpans("worker", input, [], [event()]);
    expect(deriveCoverageSpans("worker", [...input].reverse(), [], [event()])).toEqual(expected);
    expect(deriveCoverageSpans("worker", [input[0], input[2]], [], [event()]).spans).toHaveLength(2);
    expect(deriveCoverageSpans("worker", [input[2], input[0], input[1]], [], [event()])).toEqual(expected);
  });
});
