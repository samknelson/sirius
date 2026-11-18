import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { coverageSegments, isEdiCobra, type SegmentCoverage } from "../../server/plugins/trust/provider-edi/coverage-segments";
import { wmbPrimaryKeys, buildMemberUnits } from "../../server/plugins/trust/provider-edi/base";
import { selectTerminationCandidates } from "../../server/plugins/trust/provider-edi/termination-population";
import { carrierLayoutCsv } from "../../server/plugins/trust/provider-edi/carrier-csv";
import { ediReadFixture, registeredEdiPlugins } from "./fixtures/harness";

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
