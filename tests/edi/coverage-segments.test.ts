import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { coverageSegments, isEdiCobra, type SegmentCoverage } from "../../server/plugins/trust/provider-edi/coverage-segments";
import { wmbPrimaryKeys, buildMemberUnits } from "../../server/plugins/trust/provider-edi/base";
import { selectTerminationCandidates } from "../../server/plugins/trust/provider-edi/termination-population";
import { carrierLayoutCsv } from "../../server/plugins/trust/provider-edi/carrier-csv";
import { ediReadFixture, registeredEdiPlugins } from "./fixtures/harness";
import { approveConflict, competingSources, coverageKey, projectCoverage, evidenceHash, evidenceHashRecords } from "../../server/plugins/trust/provider-edi/coverage-choices";
import { discoverCoverage, coverageProjection } from "../../server/plugins/trust/provider-edi/coverage-review";
import type { EdiCoverageDecision } from "@shared/edi-coverage-choices";

const row = (month: number, extra: Partial<SegmentCoverage> = {}): SegmentCoverage => ({
  id: `parent-${month}`, workerId: "parent", benefitId: "benefit",
  year: 2026, month, employerId: "ordinary-uuid", employerSiriusId: "100",
  sourceRelationId: null, ...extra,
});
const child = (month: number, extra: Partial<SegmentCoverage> = {}) =>
  row(month, { id: `child-${month}`, workerId: "child", sourceRelationId: "relation", ...extra });
const policy = { subscribers: true, dependents: true, months: 1 };
const relation = { id: "relation", worker1: "parent", worker2: "child", startYmd: null, endYmd: null };
const event = (workerId = "parent", month = 11) => ({
  id: `event-${workerId}`, workerId, benefitId: "benefit", year: 2026, month,
  data: { provenance: "coverage_inferred" },
});
const person = {
  contactId: "contact", workerSiriusId: "123", ssn: "001234567",
  givenName: "Fictional", familyName: "Example", middleName: null,
  email: "example@example.invalid", birthDate: "1980-01-01", genderCode: "F",
};
function memberReads(current: SegmentCoverage, history: SegmentCoverage[], dependent?: SegmentCoverage) {
  return [
    [current], [{ id: "benefit", siriusId: "D" }],
    dependent ? [{
      ...person, depWmbId: dependent.id, depWorkerId: dependent.workerId,
      sourceRelationId: "relation", relationId: "relation", subscriberWorkerId: "parent",
      relationSiriusId: "SP", benefitId: "benefit", year: 2026, month: current.month,
    }] : [],
    history, [person], [], [],
    ...(dependent ? [[], []] : []),
  ];
}

describe("membership EDI classification and segment authority", () => {
  it("retains canonical evidence hashes while yielding through large collections", async () => {
    const input = { relevant: Array.from({ length: 1500 }, (_, i) => ({ z: i, a: { second: 2, first: 1 } })), events: [] };
    let yielded = false;
    setImmediate(() => { yielded = true; });
    expect(await evidenceHashRecords(input)).toBe(evidenceHash(input));
    expect(yielded).toBe(true);
  });
  it("uses only the two confirmed Sirius IDs", () => {
    expect(["COBRA", "13226164"].map(isEdiCobra)).toEqual([true, true]);
    expect([null, undefined, "cobra", "cobra-uuid", "100"].map(isEdiCobra)).toEqual([false, false, false, false, false]);
    expect(coverageSegments([row(9), row(10, { employerId: "COBRA" })]).start(row(10))).toBe("2026-09-01");
  });
  it.each(["COBRA", "13226164"])("separates segments but not benefit continuity for %s", employerSiriusId => {
    const rows = [row(10), row(11, { employerSiriusId }), row(12)];
    const segments = coverageSegments(rows);
    expect(rows.map(r => segments.start(r))).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(selectTerminationCandidates([event()], rows, [], new Set(), "2026-11-01", policy)).toEqual([]);
    expect(selectTerminationCandidates([event("parent", 12)], rows, [], new Set(), "2026-12-01", policy)).toEqual([]);
    const final = selectTerminationCandidates([{ ...event("parent", 1), year: 2027 }], rows, [], new Set(), "2027-01-01", policy);
    expect(final[0]).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
    expect(selectTerminationCandidates([event("parent", 12)], rows.slice(0, 2), [], new Set(), "2026-12-01", policy)[0])
      .toMatchObject({ start: "2026-11-01", end: "2026-11-30", familyWmbId: "parent-11" });
  });
  it("deduplicates ordinary employer rows deterministically without blocking ends", async () => {
    const rows = [row(9), row(10), row(10, { id: "z-other", employerId: "other-uuid", employerSiriusId: "200" })];
    const terms = selectTerminationCandidates([event()], rows, [], new Set(), "2026-11-01", policy);
    expect(terms[0]).toMatchObject({ start: "2026-09-01", end: "2026-10-31", familyWmbId: "parent-10" });
    expect(selectTerminationCandidates([event()], [...rows].reverse(), [], new Set(), "2026-11-01", policy)).toEqual(terms);
    for (const current of [rows.slice(1), rows.slice(1).reverse()]) {
      const fixture = ediReadFixture([[{ id: "benefit", siriusId: "D" }], current]);
      expect(await wmbPrimaryKeys(fixture.ctx, ["D"])).toEqual(["parent-10"]);
      fixture.assertReadsConsumed();
    }
    const children = [child(9), child(10), child(10, { id: "z-child", employerId: "other" })];
    expect(selectTerminationCandidates([event("child")], [...rows, ...children], [relation], new Set(), "2026-11-01", policy)[0])
      .toMatchObject({ start: "2026-09-01", rowKey: "parent-10:relation" });
  });
  it("does not merge benefits, families, gaps or distinct family ownership", () => {
    const current = child(10);
    expect(coverageSegments([current, child(9, { sourceRelationId: "other" })]).start(current)).toBe("2026-10-01");
    expect(coverageSegments([current, child(9, { benefitId: "other" })]).start(current)).toBe("2026-10-01");
    expect(coverageSegments([current, child(8)]).start(current)).toBe("2026-10-01");
    expect(() => selectTerminationCandidates([event("child")],
      [row(10), current, child(10, { id: "other-child", sourceRelationId: "other" })],
      [relation], new Set(), "2026-11-01", policy)).toThrow(/ownership/);
  });
  it.each(["parent", "child"])("refuses current and needed historical mixed classes for %s", workerId => {
    const make = workerId === "parent" ? row : child;
    const mixed = [make(9), make(9, { id: "conflict", employerId: "cobra-uuid", employerSiriusId: "13226164" })];
    const current = make(10);
    const message = /Correction required.*person (parent|child), benefit benefit, coverage month 2026-09.*WMB.*conflict.*cobra-uuid.*13226164/;
    expect(() => coverageSegments([...mixed, current]).start(current)).toThrow(message);
    expect(() => selectTerminationCandidates([event(workerId)], [...mixed, current, ...(workerId === "child" ? [row(10)] : [])],
      [relation], new Set(), "2026-11-01", policy)).toThrow(message);
  });
  it("validates before active dependent suppression, even with termination flags off", async () => {
    const fixture = ediReadFixture([[{ id: "benefit", siriusId: "D" }], [
      row(10), { ...child(10), subscriberWorkerId: "parent" },
      { ...child(10, { id: "conflict", employerSiriusId: "COBRA" }), subscriberWorkerId: "parent" },
    ]]);
    await expect(wmbPrimaryKeys(fixture.ctx, ["D"])).rejects.toThrow(/Correction required.*person child/);
  });
  it("rejects a dependent in two covered families before either suppresses its standalone row", async () => {
    const parent = row(10);
    const otherParent = row(10, { id: "other-parent-wmb", workerId: "other-parent" });
    const dep = child(10);
    const otherDep = child(10, { id: "other-child-wmb", sourceRelationId: "other-relation" });
    const rows = [parent, otherParent,
      { ...dep, subscriberWorkerId: "parent" },
      { ...otherDep, subscriberWorkerId: "other-parent" }];
    for (const population of [rows, [...rows].reverse()]) {
      const fixture = ediReadFixture([[{ id: "benefit", siriusId: "D" }], population]);
      await expect(wmbPrimaryKeys(fixture.ctx, ["D"]))
        .rejects.toThrow(/Correction required.*ownership.*person child.*benefit benefit.*2026-10.*child-10.*other-child-wmb/);
    }
    // Direct/reconstructed batches must not rely on getPrimaryKeys having run.
    // Even with only one parent in this batch, the child's history includes
    // both family sources and must refuse before returning member units.
    const fixture = ediReadFixture(memberReads(parent, rows, dep));
    await expect(buildMemberUnits([parent.id], fixture.ctx))
      .rejects.toThrow(/Correction required.*ownership.*person child/);
  });
});

describe("real assembly and carrier date/qualifier fidelity", () => {
  for (const plugin of registeredEdiPlugins().filter(p => p.benefitSiriusIds?.length)) {
    it(`${plugin.id} applies selected historical sources identically to native and QA output`, async () => {
      const current = row(10, { employerSiriusId: "COBRA" });
      const dep = child(10);
      const excluded = row(10, { id: "excluded-subscriber" });
      const history = [current, excluded, row(9, { employerSiriusId: "COBRA" }), dep,
        child(9), child(9, { id: "excluded-history", sourceRelationId: null, employerSiriusId: "COBRA" })];
      const fixture = ediReadFixture([
        ...memberReads(current, history, dep),
        ...(/-(healthnet|delta|expressscripts|carelon)$/.test(plugin.id) ? [[]] : []),
      ]);
      fixture.ctx.coverageProjection = { excludedIds: new Set(["excluded-subscriber", "excluded-history"]), decisions: [], fingerprint: "fixture" };
      const output = await plugin.processBatch([current.id], fixture.ctx);
      expect(output).toHaveLength(2);
      for (const record of output) {
        expect(record.coverageStart).toBe("20260901");
        expect(plugin.encodeRow(record, fixture.ctx)).toContain("20260901");
        expect(parse(carrierLayoutCsv(plugin, [record], fixture.ctx), { relax_column_count: true }).flat()).toContain("20260901");
      }
      fixture.assertReadsConsumed();
    });
    it.each(["COBRA", "13226164"])(`${plugin.id} serializes current subscriber and dependent segments for %s`, async employerSiriusId => {
      const current = row(11, { employerSiriusId });
      const dep = child(11, { employerSiriusId });
      const fixture = ediReadFixture([
        ...memberReads(current, [row(10), current, child(10), dep], dep),
        ...(/-(healthnet|delta|expressscripts|carelon)$/.test(plugin.id) ? [[]] : []),
      ]);
      fixture.ctx.input.asOfDate = "2026-11-01";
      const output = await plugin.processBatch([current.id], fixture.ctx);
      fixture.assertReadsConsumed();
      expect(output).toHaveLength(2);
      for (const outputRow of output) {
        expect(outputRow.coverageStart).toBe("20261101");
        expect(outputRow.coverageEnd).toBe("");
        const expected: Record<string, string> = {
          divisionId: "09002", enrollmentUnit: "7000", memberStatus: "C", statusCode: "C",
        };
        for (const [key, value] of Object.entries(expected)) if (key in outputRow) expect(outputRow[key]).toBe(value);
        if (plugin.id.endsWith("expressscripts")) expect(outputRow.contractType).toBe("CB");
        if (plugin.id.endsWith("healthnet")) expect(outputRow.payStatusCode).toBe(outputRow.pk === current.id ? "CO" : "");
        const native = plugin.encodeRow(outputRow, fixture.ctx);
        expect(native).toContain("20261101");
        const qa = parse(carrierLayoutCsv(plugin, [outputRow], fixture.ctx), { relax_column_count: true });
        expect(qa.flat()).toContain("20261101");
      }
    });
    it(`${plugin.id} uses each person's dates and final non-COBRA qualifiers`, async () => {
      const current = row(12);
      const dep = child(12);
      const fixture = ediReadFixture([
        ...memberReads(current, [row(10), row(11, { employerSiriusId: "13226164" }), current,
          child(10), child(11, { employerId: "second-ordinary" }), dep], dep),
        ...(/-(healthnet|delta|expressscripts|carelon)$/.test(plugin.id) ? [[]] : []),
      ]);
      fixture.ctx.input.asOfDate = "2026-12-01";
      const output = await plugin.processBatch([current.id], fixture.ctx);
      expect(output).toHaveLength(2);
      expect(output[0].coverageStart).toBe("20261201");
      expect(output[1].coverageStart).toBe("20261001");
      for (const outputRow of output) {
        expect(outputRow.coverageEnd).toBe("");
        const expected: Record<string, string> = {
          divisionId: "00002", enrollmentUnit: "0000", memberStatus: "A", statusCode: "A",
        };
        for (const [key, value] of Object.entries(expected)) if (key in outputRow) expect(outputRow[key]).toBe(value);
        if (plugin.id.endsWith("expressscripts")) expect(outputRow.contractType).toBe("AC");
      }
      fixture.assertReadsConsumed();
    });
    it(`${plugin.id} refuses historical mixed dependent coverage with flags off`, async () => {
      const current = row(10);
      const dep = child(10);
      const fixture = ediReadFixture(memberReads(current, [
        current, dep, child(9), child(9, { id: "conflict", employerSiriusId: "13226164" }),
      ], dep));
      await expect(plugin.processBatch([current.id], fixture.ctx)).rejects.toThrow(/Correction required.*person child.*2026-09/);
    });
  }
});

describe("run-only coverage approval evidence", () => {
  const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-bao-kaiser")!;
  async function review(rows: SegmentCoverage[], decisions: EdiCoverageDecision[] = [], rels = [relation], events: ReturnType<typeof event>[] = []) {
    const fixture = ediReadFixture([
      [{ id: "benefit", siriusId: "K" }], rows,
      ...(rows.some(r => r.sourceRelationId) ? [rels] : []), events,
    ]);
    fixture.ctx.terminationPolicy = policy;
    const result = await discoverCoverage(fixture.ctx, plugin, decisions);
    fixture.assertReadsConsumed();
    return result;
  }
  const choose = (conflict: Awaited<ReturnType<typeof review>>["conflicts"][number], selectedId: string) =>
    approveConflict(conflict, { evidence: conflict.evidence, selectedId, reason: "Reviewed fictional import sources" }, "effective-admin", "2026-10-01T10:00:00Z");
  it("does not demand approval for equivalent duplicates", async () => {
    const rows = [row(10), row(10, { id: "other", employerId: "other" })];
    expect(competingSources(rows)).toBe(false);
    expect((await review(rows)).conflicts).toEqual([]);
  });
  it("requires an explicit source and reason, preserves attribution, and isolates runs", async () => {
    const rows = [row(10), row(10, { id: "cobra", employerSiriusId: "COBRA" })];
    const initial = await review(rows);
    const conflict = initial.conflicts[0];
    expect(conflict.decision).toBeNull();
    expect(() => coverageProjection(initial)).toThrow(/unresolved/);
    expect(() => approveConflict(conflict, { evidence: conflict.evidence, reason: "why" }, "admin", "now")).toThrow(/select/);
    expect(() => approveConflict(conflict, { evidence: conflict.evidence, selectedId: "cobra", reason: " " }, "admin", "now")).toThrow(/reason/);
    const decision = choose(conflict, "cobra");
    expect(decision).toMatchObject({ decidedBy: "effective-admin", selectedId: "cobra" });
    const projection = coverageProjection(await review(rows, [decision]));
    expect(projectCoverage(rows, projection, r => r.id).map(r => r.id)).toEqual(["cobra"]);
    expect((await review(rows)).conflicts[0].decision).toBeNull();
    expect(decision.candidates).toHaveLength(2);
  });
  it("invalidates edits, additions and removals even when the chosen row survives", async () => {
    const rows = [row(10), row(10, { id: "cobra", employerSiriusId: "COBRA" })];
    const decision = choose((await review(rows)).conflicts[0], "parent-10");
    for (const changed of [
      [rows[0], { ...rows[1], employerId: "changed" }],
      [...rows, row(10, { id: "new-source" })], [rows[0]], [],
    ]) {
      const result = await review(changed, [decision]);
      expect(result.conflicts[0].stale).toBe(true);
      expect(() => coverageProjection(result)).toThrow(/stale/);
    }
    const reordered = await review([...rows].reverse(), [decision]);
    expect(reordered.conflicts[0].decision).toEqual(decision);
  });
  it("discovers historical boundaries but stops beyond gaps and class boundaries", async () => {
    const rows = [row(10), row(9), row(9, { id: "historical-cobra", employerSiriusId: "COBRA" }),
      row(7), row(7, { id: "old-unrelated", employerSiriusId: "COBRA" })];
    expect((await review(rows)).conflicts.map(c => c.key)).toEqual([coverageKey(row(9))]);
    const boundary = [row(10), row(9, { employerSiriusId: "COBRA" }), row(8), row(8, { id: "old-conflict", employerSiriusId: "COBRA" })];
    expect((await review(boundary)).conflicts).toEqual([]);
  });
  it("selects dependent ownership without inventing a parent and invalidates family changes", async () => {
    const rows = [row(10), child(10), child(10, { id: "own-child", sourceRelationId: null })];
    const initial = await review(rows);
    const decision = choose(initial.conflicts[0], "child-10");
    const projection = coverageProjection(await review(rows, [decision]));
    const fixture = ediReadFixture([[{ id: "benefit", siriusId: "K" }],
      rows.map(r => ({ ...r, subscriberWorkerId: r.sourceRelationId ? "parent" : null }))]);
    fixture.ctx.coverageProjection = projection;
    expect(await wmbPrimaryKeys(fixture.ctx, ["K"])).toEqual(["parent-10"]);
    const missing = await review(rows.filter(r => r.workerId !== "parent"));
    expect(() => choose(missing.conflicts[0], "child-10")).toThrow(/family/);
    const changed = await review(rows, [decision], [{ ...relation, worker1: "different-parent" }]);
    expect(changed.conflicts[0].stale).toBe(true);
  });
  it("uses selected termination history without erasing reinstatement or scan safeguards", async () => {
    const rows = [row(9), row(9, { id: "term-cobra", employerSiriusId: "COBRA" })];
    const initial = await review(rows, [], [], [event("parent", 10)]);
    const projection = coverageProjection(await review(rows, [choose(initial.conflicts[0], "term-cobra")], [], [event("parent", 10)]));
    const selected = projectCoverage(rows, projection, r => r.id);
    expect(selectTerminationCandidates([event("parent", 10)], selected, [], new Set(), "2026-10-01", policy)[0])
      .toMatchObject({ familyWmbId: "term-cobra", start: "2026-09-01", end: "2026-09-30" });
    expect(selectTerminationCandidates([event("parent", 10)], [...selected, row(11)], [], new Set(), "2026-10-01", policy)).toEqual([]);
    expect(() => selectTerminationCandidates([{ ...event("parent", 10), data: {} }], selected, [], new Set(), "2026-10-01", policy)).toThrow(/scan/);
  });
  it("refuses an unambiguous child when the parent's own subscriber source is excluded", async () => {
    const parentRelation = { ...relation, id: "parent-relation", worker1: "grandparent", worker2: "parent" };
    const rows = [row(10), child(10),
      row(10, { id: "parent-as-dependent", sourceRelationId: parentRelation.id }),
      row(10, { id: "grandparent-row", workerId: "grandparent" })];
    const initial = await review(rows, [], [relation, parentRelation]);
    expect(initial.conflicts).toHaveLength(1);
    const decision = choose(initial.conflicts[0], "parent-as-dependent");
    const projected = await review(rows, [decision], [relation, parentRelation]);
    expect(() => coverageProjection(projected)).toThrow(/retained dependent child.*standalone subscriber coverage cannot be invented/);
  });
});
