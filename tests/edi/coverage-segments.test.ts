import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { isEdiCobra, type SegmentCoverage } from "../../server/plugins/trust/provider-edi/coverage-segments";
import { wmbPrimaryKeys } from "../../server/plugins/trust/provider-edi/base";
import { selectTerminationCandidates } from "../../server/plugins/trust/provider-edi/termination-population";
import { carrierLayoutCsv } from "../../server/plugins/trust/provider-edi/carrier-csv";
import { ediReadFixture, registeredEdiPlugins, segmentStartRow } from "./fixtures/harness";
import {
  applyConflictRule, competingSources, correctionRequired, evidenceHash, evidenceHashRecords, exclusionDigest,
  type CoverageEvidence, type EvidenceRelation, type EvidenceRow,
} from "../../server/plugins/trust/provider-edi/coverage-conflicts";
import { readSourceSegmentStarts as readSegmentStarts, requireSegmentStart } from "../../server/plugins/trust/provider-edi/coverage-starts";
import type { EdiCoverageEntry } from "@shared/edi-coverage-choices";

const row = (month: number, extra: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id: `parent-${month}`, workerId: "parent", benefitId: "benefit",
  year: 2026, month, employerId: "ordinary-uuid", employerSiriusId: "100",
  sourceRelationId: null, ...extra,
});
const child = (month: number, extra: Partial<EvidenceRow> = {}) =>
  row(month, { id: `child-${month}`, workerId: "child", sourceRelationId: "relation", ...extra });
const policy = { subscribers: true, dependents: true, months: 1 };
const relation = { id: "relation", worker1: "parent", worker2: "child", startYmd: null, endYmd: null };
const relations = (...list: EvidenceRelation[]) => new Map(list.map(r => [r.id, r]));
const event = (workerId = "parent", month = 11) => ({
  id: `event-${workerId}`, workerId, benefitId: "benefit", year: 2026, month,
  data: { provenance: "coverage_inferred" },
});
const person = {
  contactId: "contact", workerSiriusId: "123", ssn: "001234567",
  givenName: "Fictional", familyName: "Example", middleName: null,
  email: "example@example.invalid", birthDate: "1980-01-01", genderCode: "F",
};
const cobraEmployer = { id: "cobra", employerId: "cobra-uuid", employerSiriusId: "13226164" };
type Run = Parameters<typeof segmentStartRow>[1];
/**
 * Reads one batch makes, in order: the batch's coverage, benefits, covered
 * dependents, ONE aggregated start row per anchor, then people.
 */
function memberReads(current: SegmentCoverage, run: Run, dependent?: SegmentCoverage, dependentRun?: Run) {
  return [
    [current], [{ id: "benefit", siriusId: "D" }],
    dependent ? [{
      ...person, depWmbId: dependent.id, depWorkerId: dependent.workerId, employerId: dependent.employerId,
      sourceRelationId: "relation", relationId: "relation", subscriberWorkerId: "parent",
      relationSiriusId: "SP", benefitId: "benefit", year: 2026, month: current.month,
    }] : [],
    [segmentStartRow(current, run), ...(dependent ? [segmentStartRow(dependent, dependentRun ?? run)] : [])],
    [person], [], [],
    ...(dependent ? [[], []] : []),
  ];
}
const supplementalRead = (pluginId: string) =>
  /-(healthnet|delta|expressscripts|carelon)$/.test(pluginId) ? [[]] : [];
const starts = async (rows: Record<string, unknown>[]) => {
  const fixture = ediReadFixture([rows]);
  let result: Awaited<ReturnType<typeof readSegmentStarts>> = [];
  await fixture.ctx.storage.readOnly.query(async db => { result = await readSegmentStarts(db, rows.map(r => String(r.id))); });
  return result;
};

describe("membership EDI classification", () => {
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
  });
  it.each(["COBRA", "13226164"])("never ends a benefit that continues across a %s change", employerSiriusId => {
    const rows = [row(10), row(11, { employerSiriusId }), row(12)];
    const select = (termEvent: ReturnType<typeof event>, coverage: EvidenceRow[], asOf: string) =>
      selectTerminationCandidates([termEvent], coverage, [], new Set(), asOf, policy);
    expect(select(event(), rows, "2026-11-01")).toEqual({ selected: [], excluded: [] });
    expect(select(event("parent", 12), rows, "2026-12-01")).toEqual({ selected: [], excluded: [] });
    // A true ending reports the final classification's last covered record.
    expect(select({ ...event("parent", 1), year: 2027 }, rows, "2027-01-01").selected[0])
      .toMatchObject({ end: "2026-12-31", familyWmbId: "parent-12", memberWmbId: "parent-12" });
    expect(select(event("parent", 12), rows.slice(0, 2), "2026-12-01").selected[0])
      .toMatchObject({ end: "2026-11-30", familyWmbId: "parent-11", role: "subscriber" });
  });
  it("treats same-class employer rows as one source, deterministically", async () => {
    const rows = [row(10), row(10, { id: "z-other", employerId: "other-uuid", employerSiriusId: "200" })];
    expect(competingSources(rows)).toBe(false);
    expect(applyConflictRule(rows, relations()).excludedIds.size).toBe(0);
    const terms = selectTerminationCandidates([event()], rows, [], new Set(), "2026-11-01", policy);
    expect(terms.selected[0]).toMatchObject({ end: "2026-10-31", familyWmbId: "parent-10" });
    expect(selectTerminationCandidates([event()], [...rows].reverse(), [], new Set(), "2026-11-01", policy)).toEqual(terms);
    for (const current of [rows, [...rows].reverse()]) {
      const fixture = ediReadFixture([[{ id: "benefit", siriusId: "D" }], current]);
      expect(await wmbPrimaryKeys(fixture.ctx, ["D"])).toEqual(["parent-10"]);
      fixture.assertReadsConsumed();
    }
    const children = [child(10), child(10, { id: "z-child", employerId: "other" })];
    expect(selectTerminationCandidates([event("child")], [...rows, ...children], [relation], new Set(), "2026-11-01", policy)
      .selected[0]).toMatchObject({ rowKey: "parent-10:relation", memberWmbId: "child-10" });
  });
  it("refuses report-month conflicts for a caller that has no wizard evidence", async () => {
    const mixed = ediReadFixture([[{ id: "benefit", siriusId: "D" }], [
      row(10), { ...child(10), subscriberWorkerId: "parent" },
      { ...child(10, { id: "conflict", employerSiriusId: "COBRA" }), subscriberWorkerId: "parent" },
    ]]);
    await expect(wmbPrimaryKeys(mixed.ctx, ["D"])).rejects.toThrow(/Correction required.*person child/);
    const families = [row(10), row(10, { id: "other-parent-wmb", workerId: "other-parent" }),
      { ...child(10), subscriberWorkerId: "parent" },
      { ...child(10, { id: "other-child-wmb", sourceRelationId: "other-relation" }), subscriberWorkerId: "other-parent" }];
    for (const population of [families, [...families].reverse()]) {
      const fixture = ediReadFixture([[{ id: "benefit", siriusId: "D" }], population]);
      await expect(wmbPrimaryKeys(fixture.ctx, ["D"]))
        .rejects.toThrow(/Correction required.*ownership.*person child.*benefit benefit.*2026-10.*child-10.*other-child-wmb/);
    }
  });
});

// These decide who is missing from a replacement membership file.
describe("exclusion cascade for conflicting coverage", () => {
  const otherRelation = { id: "other-relation", worker1: "other-parent", worker2: "other-child", startYmd: null, endYmd: null };
  const bystanders = [
    row(10, { id: "other-parent-wmb", workerId: "other-parent" }),
    row(10, { id: "other-child-wmb", workerId: "other-child", sourceRelationId: "other-relation" }),
  ];
  it("excludes every candidate of a conflicting month and the dependents left without a subscriber", () => {
    const rows = [row(10), row(10, cobraEmployer), child(10), ...bystanders];
    const result = applyConflictRule(rows, relations(relation, otherRelation));
    expect([...result.excludedIds].sort()).toEqual(["child-10", "cobra", "parent-10"]);
    expect(result.groups.map(g => [g.reason, g.rows.map(r => r.id)])).toEqual([
      ["conflicting-coverage", ["cobra", "parent-10"]],
      ["subscriber-excluded", ["child-10"]],
    ]);
    expect(result.refused).toEqual([]);
    expect(applyConflictRule([...rows].reverse(), relations(relation, otherRelation)).excludedIds).toEqual(result.excludedIds);
  });
  it("treats a different subscriber or dependent source as a conflict without touching the family", () => {
    const rows = [row(10), child(10), child(10, { id: "own-child", sourceRelationId: null }), ...bystanders];
    const result = applyConflictRule(rows, relations(relation, otherRelation));
    expect(result.groups.map(g => [g.reason, g.rows.map(r => r.id)]))
      .toEqual([["conflicting-coverage", ["child-10", "own-child"]]]);
    expect(result.excludedIds.has("parent-10")).toBe(false);
  });
  it("refuses, and never excludes, a dependent whose subscriber has no coverage of their own", () => {
    for (const [rows, known] of [
      [[child(10)], relations(relation)],
      [[row(10), child(10)], relations()],
    ] as const) {
      const result = applyConflictRule(rows, known);
      expect(result.excludedIds.size).toBe(0);
      expect(result.refused).toMatchObject([{ reason: "subscriber-missing", rows: [{ id: "child-10" }] }]);
      expect(correctionRequired(result.refused).message)
        .toMatch(/Correction required.*person child, benefit benefit, coverage month 2026-10.*WMB child-10.*nothing was excluded/);
    }
  });
  it("does not override granted coverage with relationship dates", () => {
    const result = applyConflictRule([row(10), child(10)],
      relations({ ...relation, startYmd: "2026-11-01", endYmd: "2026-11-30" }));
    expect(result.refused).toEqual([]);
    expect(result.excludedIds.size).toBe(0);
  });
  it("reports no termination from a conflicting last covered month", () => {
    const own = selectTerminationCandidates([event()], [row(10), row(10, cobraEmployer)], [], new Set(), "2026-11-01", policy);
    expect(own.selected).toEqual([]);
    expect(own.excluded).toMatchObject([{ reason: "termination-conflict", rows: [{ id: "cobra" }, { id: "parent-10" }] }]);
    const family = selectTerminationCandidates([event("child")], [row(10), row(10, cobraEmployer), child(10)],
      [relation], new Set(), "2026-11-01", policy);
    expect(family.selected).toEqual([]);
    expect(family.excluded).toMatchObject([{ reason: "termination-subscriber-excluded", rows: [{ id: "child-10" }] }]);
    expect(correctionRequired(own.excluded).message)
      .toMatch(/Correction required.*conflicting last covered month for person parent.*WMB cobra \(employer cobra-uuid, Sirius ID 13226164, COBRA, subscriber\)/);
  });
  it("binds an acknowledgement to the exact list and rule, in any order", () => {
    const entry = (workerId: string, ids: string[]): EdiCoverageEntry => ({
      kind: "exclusion", reason: "conflicting-coverage", workerId, personLabel: workerId, benefitId: "benefit",
      benefitLabel: "Fixture", month: "2026-10", records: ids.map(id => ({ id, employerId: "e", employerLabel: "E",
        employerSiriusId: null, sourceRelationId: null, subscriberWorkerId: workerId, subscriberLabel: workerId, isCobra: false })),
    });
    const list = [entry("a", ["1", "2"]), entry("b", ["3", "4"])];
    const digest = exclusionDigest("exclude-conflicting", list);
    expect(exclusionDigest("exclude-conflicting", [entry("b", ["4", "3"]), entry("a", ["2", "1"])])).toBe(digest);
    expect(exclusionDigest("exclude-conflicting", list.slice(0, 1))).not.toBe(digest);
    expect(exclusionDigest("exclude-conflicting", [entry("a", ["1", "2"]), entry("b", ["3", "5"])])).not.toBe(digest);
    expect(exclusionDigest("refuse-conflicting", list)).not.toBe(digest);
  });
});

// The database returns one aggregated row per anchor; these are the decisions
// taken from it. The SQL that aggregates is exercised by the opt-in
// PostgreSQL suite beside this file.
describe("coverage start from lifecycle events", () => {
  it("starts at the restart event unless a later month lacks the member's own class", async () => {
    const [continuous, gap, classChange] = await starts([
      segmentStartRow(row(10), { restart: 3 }),
      segmentStartRow(row(10, { id: "gap" }), { restart: 9 }),
      segmentStartRow(row(10, { id: "class" }), { restart: 3, lastBreak: 7, cobra: true }),
    ]);
    expect(continuous).toMatchObject({ coverageStartYmd: "2026-03-01", isCobra: false, problem: null, monthsBeforeRunStart: 0 });
    expect(gap.coverageStartYmd).toBe("2026-09-01");
    expect(classChange).toMatchObject({ coverageStartYmd: "2026-08-01", isCobra: true });
  });
  it("reports earlier conflicts as counts and never moves the start for them", async () => {
    const [start, behind] = await starts([
      segmentStartRow(row(10), { restart: 3, lastBreak: 5, conflictMonths: 1, conflictRecords: 2 }),
      segmentStartRow(row(10, { id: "behind" }), { restart: 3, covered: 6, conflictMonths: 4 }),
    ]);
    expect(start).toMatchObject({ coverageStartYmd: "2026-06-01", conflictMonths: 1, conflictRecords: 2 });
    // No date, so nothing to warn about: the run refuses instead.
    expect(behind).toMatchObject({ coverageStartYmd: null, conflictMonths: 0, conflictRecords: 0 });
  });
  it("never estimates a date when the event is missing or behind coverage", async () => {
    const [missing, behind] = await starts([
      segmentStartRow(row(10), { restart: null }),
      segmentStartRow(row(10, { id: "behind" }), { restart: 3, covered: 6 }),
    ]);
    expect(missing).toMatchObject({ coverageStartYmd: null, problem: "missing-event" });
    expect(behind).toMatchObject({ coverageStartYmd: null, problem: "inconsistent-event" });
    expect(() => requireSegmentStart(missing, "parent-10")).toThrow(/no coverage lifecycle event/);
    expect(() => requireSegmentStart(behind, "behind")).toThrow(/behind their coverage records/);
    expect(() => requireSegmentStart(undefined, "gone")).toThrow(/coverage changed or is missing/);
  });
});

describe("real assembly and carrier date/qualifier fidelity", () => {
  for (const plugin of registeredEdiPlugins().filter(p => p.benefitSiriusIds?.length)) {
    it(`${plugin.id} writes each person's own event-derived start to native and QA output`, async () => {
      const current = row(12);
      const dep = child(12);
      const fixture = ediReadFixture([
        ...memberReads(current, { restart: 10, lastBreak: 11 }, dep, { restart: 10 }),
        ...supplementalRead(plugin.id),
      ]);
      fixture.ctx.input.asOfDate = "2026-12-01";
      const output = await plugin.processBatch([current.id], fixture.ctx);
      fixture.assertReadsConsumed();
      expect(output.map(r => r.coverageStart)).toEqual(["20261201", "20261001"]);
      for (const outputRow of output) {
        expect(outputRow.coverageEnd).toBe("");
        const expected: Record<string, string> = {
          divisionId: "00002", enrollmentUnit: "0000", memberStatus: "A", statusCode: "A",
        };
        for (const [key, value] of Object.entries(expected)) if (key in outputRow) expect(outputRow[key]).toBe(value);
        if (plugin.id.endsWith("expressscripts")) expect(outputRow.contractType).toBe("AC");
        const start = String(outputRow.coverageStart);
        expect(plugin.encodeRow(outputRow, fixture.ctx)).toContain(start);
        expect(parse(carrierLayoutCsv(plugin, [outputRow], fixture.ctx), { relax_column_count: true }).flat()).toContain(start);
      }
    });
    it(`${plugin.id} serializes the COBRA class the database reported`, async () => {
      const current = row(11, { employerSiriusId: "COBRA" });
      const dep = child(11, { employerSiriusId: "COBRA" });
      const fixture = ediReadFixture([
        ...memberReads(current, { restart: 10, lastBreak: 10, cobra: true }, dep),
        ...supplementalRead(plugin.id),
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
      }
    });
    it(`${plugin.id} leaves out records the run excluded and refuses a missing event`, async () => {
      const current = row(10);
      const dep = child(10);
      const excluded = ediReadFixture([
        ...memberReads(current, { restart: 9 }, dep).filter((_, i) => i < 7).map((read, i) =>
          i === 3 ? [segmentStartRow(current, { restart: 9 })] : read),
        ...supplementalRead(plugin.id),
      ]);
      excluded.ctx.coverageEvidence = { excludedIds: new Set([dep.id]), starts: new Map() } as unknown as CoverageEvidence;
      const output = await plugin.processBatch([current.id], excluded.ctx);
      excluded.assertReadsConsumed();
      expect(output.map(r => r.pk)).toEqual([current.id]);
      const missing = ediReadFixture(memberReads(current, { restart: null }));
      await expect(plugin.processBatch([current.id], missing.ctx)).rejects.toThrow(/no coverage lifecycle event/);
    });
  }
});
