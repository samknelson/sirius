import { describe, expect, it } from "vitest";
import {
  monthEnd, monthIndex, readTerminationPolicy, terminationWindow, effectiveRunTerminationPolicy,
} from "../../server/plugins/trust/provider-edi/termination-policy";
import {
  confirmedTerminationIds, selectTerminationCandidates,
  type Coverage, type Relation, type TermEvent,
} from "../../server/plugins/trust/provider-edi/termination-population";

const coverage = (workerId: string, month = 10, extra: Partial<Coverage> = {}): Coverage => ({
  id: `${workerId}-${month}`, workerId, benefitId: "dental", year: 2026, month,
  employerId: "employer", sourceRelationId: null, ...extra,
});
const event = (workerId: string, extra: Partial<TermEvent> = {}): TermEvent => ({
  id: `event-${workerId}`, workerId, benefitId: "dental", year: 2026, month: 11,
  data: { provenance: "coverage_inferred", failedPlugins: [] }, ...extra,
});
const relation: Relation = {
  id: "old-family", worker1: "parent", worker2: "child",
  startYmd: "2020-01-01", endYmd: "2026-10-31",
};
const both = readTerminationPolicy({ explicitSubscriberTerminations: true, explicitDependentTerminations: true });
function select(events = [event("parent"), event("child")], rows = [
  coverage("parent"), coverage("child", 10, { sourceRelationId: relation.id }),
], policy = both, relations = [relation]) {
  return selectTerminationCandidates(events, rows, relations, new Set(), "2026-11-10", policy);
}

describe("calendar policy and omission compatibility", () => {
  it("uses run-owned false values ahead of legacy true flags", () => {
    expect(effectiveRunTerminationPolicy({
      terminationPolicy: { explicitSubscriberTerminations: false, explicitDependentTerminations: true, terminationLookbackMonths: 2 },
      config: { data: { explicitSubscriberTerminations: true, explicitDependentTerminations: false, terminationLookbackMonths: 8 } },
    })).toEqual({ subscribers: false, dependents: true, months: 2 });
    expect(effectiveRunTerminationPolicy({})).toEqual({ subscribers: false, dependents: false, months: 1 });
  });
  it("preserves absent settings", () => {
    expect(readTerminationPolicy()).toEqual({ subscribers: false, dependents: false, months: 1 });
  });
  it.each([0, -1, 1.5, 13, "1", null, NaN])("rejects invalid lookback %s", months => {
    expect(() => readTerminationPolicy({ terminationLookbackMonths: months })).toThrow();
  });
  it("rejects non-boolean opt-ins", () => {
    expect(() => readTerminationPolicy({ explicitDependentTerminations: "true" })).toThrow();
  });
  it.each([
    ["2026-11-01", "2026-10-31"], ["2027-01-31", "2026-12-31"],
    ["2024-03-15", "2024-02-29"], ["2025-03-01", "2025-02-28"],
  ])("uses the completed calendar month for %s", (date, end) => {
    const window = terminationWindow(date, 1);
    expect(window.firstEnd).toBe(window.lastEnd);
    expect(monthEnd(window.firstEnd)).toBe(end);
  });
  it("bounds wider windows and rejects invalid reporting dates", () => {
    const window = terminationWindow("2026-11-01", 2);
    expect(monthEnd(window.firstEnd)).toBe("2026-09-30");
    expect(monthEnd(window.lastEnd)).toBe("2026-10-31");
    expect(() => terminationWindow("2026-02-30", 1)).toThrow();
  });
});

describe("per-person termination evidence", () => {
  it.each([[false, false, []], [true, false, ["subscriber"]],
    [false, true, ["dependent"]], [true, true, ["dependent", "subscriber"]]] as const)(
    "selects independent roles: subscriber %s dependent %s", (subscribers, dependents, expected) => {
      const policy = readTerminationPolicy({
        explicitSubscriberTerminations: subscribers, explicitDependentTerminations: dependents,
      });
      expect(select(undefined, undefined, policy).selected.map(c => c.role).sort()).toEqual(expected);
    });
  it("dependent-only loss preserves historical parent and surviving siblings", () => {
    const rows = [coverage("parent"), coverage("parent", 11),
      coverage("child", 10, { sourceRelationId: relation.id }), coverage("sibling", 11)];
    expect(select([event("child")], rows).selected).toMatchObject([{ role: "dependent", familyWmbId: "parent-10",
      memberWmbId: "child-10", rowKey: "parent-10:old-family", end: "2026-10-31" }]);
  });
  it("does not manufacture events from missing/unprocessed months", () => {
    expect(select([], [coverage("parent")]).selected).toEqual([]);
  });
  it.each([11, 12])("suppresses stale endings with coverage in month %s", month => {
    expect(select([event("parent")], [coverage("parent"), coverage("parent", month)]).selected).toEqual([]);
  });
  it("requires previous coverage and valid provenance for confirmed events", () => {
    expect(() => select([event("parent")], [])).toThrow(/last-covered/);
    expect(() => select([event("parent", { data: {} })], [coverage("parent")])).toThrow(/failed continuation/);
    expect(selectTerminationCandidates([event("parent", { data: {} })], [coverage("parent")],
      [], new Set(["event-parent"]), "2026-11-01", both).selected[0].evidence).toBe("confirmed scan");
    expect(() => selectTerminationCandidates([event("parent")], [coverage("parent")], [],
      new Set(), "2026-11-01", both, new Set(["event-parent"]))).toThrow(/contradicts/);
  });
  it("keeps distinct benefits, COBRA identity and stable family keys", () => {
    expect(select([event("parent")], [coverage("parent"),
      coverage("parent", 11, { benefitId: "medical" })]).selected).toHaveLength(1);
    const events = [event("parent"), event("parent", { id: "medical-event", benefitId: "medical" })];
    const rows = [coverage("parent", 10, { employerId: "COBRA" }),
      coverage("parent", 10, { id: "medical-row", benefitId: "medical" })];
    const a = select(events, rows);
    expect(a.selected).toHaveLength(2);
    expect(select([...events].reverse(), [...rows].reverse())).toEqual(a);
    expect(new Set(a.selected.map(c => c.familyWmbId)).size).toBe(2);
  });
  it("sets a conflicting last month aside and still refuses broken historical families", () => {
    const mixed = select([event("parent")], [coverage("parent"),
      coverage("parent", 10, { id: "other", employerId: "cobra-employer", employerSiriusId: "13226164" })]);
    expect(mixed.selected).toEqual([]);
    expect(mixed.excluded).toMatchObject([{ reason: "termination-conflict", rows: [{ id: "other" }, { id: "parent-10" }] }]);
    expect(() => select(undefined, undefined, both, [])).toThrow(/historical family/);
    expect(() => select([event("child")], [coverage("child", 10, { sourceRelationId: relation.id })])).toThrow(/historical subscriber/);
  });
  it("only selects ends in the configured window", () => {
    const events = [event("parent", { month: 10 })];
    const rows = [coverage("parent", 9)];
    expect(select(events, rows).selected).toEqual([]);
    expect(select(events, rows, { ...both, months: 2 }).selected[0].end).toBe("2026-09-30");
    expect(monthIndex(2026, 10) - monthIndex(2026, 9)).toBe(1);
  });
});

describe("current scan evidence", () => {
  const action = { workerId: "child", benefitId: "dental", scanType: "continue", eligible: false };
  const scan = (actions: unknown[]) => ({ workerId: "parent", year: 2026, month: 11, resultSummary: { actions } });
  it("accepts explicit dependent decisions, not unscoped parent actions", () => {
    expect(confirmedTerminationIds([event("child")], [scan([action])]).size).toBe(1);
    expect(confirmedTerminationIds([event("child")], [scan([{ ...action, workerId: undefined }])]).size).toBe(0);
  });
  it("rejects failed starts, execution errors and superseded attempts", () => {
    for (const changed of [{ scanType: "start" }, { executionError: "fixture" }, { eligible: true }]) {
      expect(confirmedTerminationIds([event("child")], [scan([{ ...action, ...changed }])]).size).toBe(0);
    }
    expect(confirmedTerminationIds([event("child")], [scan([]), scan([action])]).size).toBe(0);
    expect(confirmedTerminationIds([event("child")], [
      { ...scan([{ ...action, eligible: true }]), workerId: "child" }, scan([action]),
    ]).size).toBe(0);
  });
});
