import { afterEach, describe, expect, it, vi } from "vitest";
import { ediReadFixture, requireEdiPlugin, segmentStartRow } from "./fixtures/harness";
import { readCoverageEvidence } from "../../server/plugins/trust/provider-edi/coverage-evidence";
import { CoverageBudget, CoverageBudgetError, COVERAGE_LIMITS } from "../../server/plugins/trust/provider-edi/coverage-budget";
import type { EvidenceRow } from "../../server/plugins/trust/provider-edi/coverage-conflicts";

// The REAL evidence reader over scripted database answers, in the order it
// asks. Nothing in the reader is mocked; an unexpected read fails the fixture.
const kaiser = requireEdiPlugin("sitespecific-bao-kaiser");
const coverage = (id: string, workerId: string, month: number, extra: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id, workerId, benefitId: "benefit", year: 2026, month, employerId: "employer", employerSiriusId: "100",
  sourceRelationId: null, ...extra,
});
function evidenceFixture(reads: readonly (readonly unknown[])[], terminations: boolean) {
  const fixture = ediReadFixture(reads);
  fixture.ctx.input = { asOfDate: "2026-11-15" };
  fixture.ctx.terminationPolicy = { subscribers: terminations, dependents: terminations, months: 1 };
  Object.assign(fixture.ctx.storage, {
    pluginConfigs: { getByKindAndPlugin: async (_kind: string, pluginId: string) => [{ id: pluginId, enabled: true }] },
    denorm: { countByStatusForConfig: async () => ({ ok: 3, stale: 0, error: 0, total: 3 }) },
  });
  return fixture;
}
const ready = (...configs: string[]) => configs.map(config_id => ({ config_id, population: 3, missing: 0, pending: 0, failed: 0 }));
const variable = "EDI_EXCLUDE_CONFLICTING_COVERAGE";
afterEach(() => { delete process.env[variable]; vi.restoreAllMocks(); });

describe("historical family relationship authority", () => {
  const parent = coverage("parent-10", "parent", 10);
  const child = coverage("child-10", "child", 10, { sourceRelationId: "relation" });
  const relation = { relationId: "relation", worker1: "parent", worker2: "child",
    startYmd: "2026-01-01", endYmd: null, relationType: "child" };
  const reads = (changes = {}) => [
    [{ id: "benefit", siriusId: "K" }], ready("trust-wmb-restart", "trust-wmb-terminate"), [],
    [{ id: "event", workerId: "parent", benefitId: "benefit", year: 2026, month: 11, data: { provenance: "coverage_inferred" } }],
    [parent], [], [{ ...child, ...relation, ...changes }], [child],
  ];
  it.each([
    { worker1: "another-subscriber" },
    { worker2: "someone-else" },
    { startYmd: "2026-11-01" },
    { endYmd: "2026-09-30" },
  ])("refuses an unconflicted dependent with invalid authority: %j", async changes => {
    const fixture = evidenceFixture(reads(changes), true);
    await expect(readCoverageEvidence(fixture.ctx, kaiser)).rejects.toThrow(/Correction required.*family relationship.*child-10/s);
    fixture.assertReadsConsumed();
  });
  it("fingerprints a retained historical relationship even when coverage is unchanged", async () => {
    const read = async (changes = {}) => {
      const fixture = evidenceFixture([...reads(changes), [segmentStartRow(parent, { restart: 3 })]], true);
      const evidence = await readCoverageEvidence(fixture.ctx, kaiser);
      fixture.assertReadsConsumed();
      expect(evidence.exclusions).toEqual([]);
      return evidence;
    };
    const before = await read();
    // Both values authorize the last covered month, but generation must still
    // detect an intervening relationship edit rather than send old evidence.
    const after = await read({ endYmd: "2026-10-31", relationType: "spouse" });
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});

describe("termination and supplemental results respect the shared budget as pages arrive", () => {
  const member = coverage("member-11", "member", 11);
  function almostFull(phase: string, remaining: number, dimension: "rows" | "bytes" = "rows") {
    vi.spyOn(CoverageBudget.prototype, "log").mockImplementation(function (this: CoverageBudget, event, name) {
      if (event === "phase-start" && name === phase) {
        if (dimension === "rows") this.reserve(COVERAGE_LIMITS.rows - remaining);
        else this.reserve(0, COVERAGE_LIMITS.bytes - remaining);
      }
    });
  }
  const oversized = (extra: Partial<EvidenceRow> = {}) => Array.from({ length: COVERAGE_LIMITS.page },
    (_, i) => coverage(`record-${String(i).padStart(4, "0")}`, "ended", 10, extra));
  it.each(["member", "subscriber"] as const)("stops during a termination %s page before any further read", async role => {
    const dependent = coverage("dependent", "ended", 10, { sourceRelationId: "relation" });
    const relation = { id: "relation", worker1: "parent", worker2: "ended", startYmd: null, endYmd: null };
    almostFull("Reading termination evidence", role === "member" ? 2 : 5);
    const fixture = evidenceFixture([
      [{ id: "benefit", siriusId: "K" }], ready("trust-wmb-restart", "trust-wmb-terminate"), [],
      [{ id: "event", workerId: "ended", benefitId: "benefit", year: 2026, month: 11, data: { provenance: "coverage_inferred" } }],
      ...(role === "subscriber" ? [[dependent], [relation]] : []),
      oversized(),
    ], true);
    await expect(readCoverageEvidence(fixture.ctx, kaiser)).rejects.toBeInstanceOf(CoverageBudgetError);
    fixture.assertReadsConsumed();
    expect(fixture.readLimits.at(-1)).toBe(COVERAGE_LIMITS.page);
  });
  it("stops during a supplemental page before reading another population batch", async () => {
    almostFull("Reading supplemental coverage", 2);
    const fixture = evidenceFixture([
      [{ id: "benefit", siriusId: "K" }], [{ id: "supplemental" }], ready("trust-wmb-restart"), [member],
      oversized({ benefitId: "supplemental", month: 11 }),
    ], false);
    await expect(readCoverageEvidence(fixture.ctx, { ...kaiser,
      supplementalCoverage: () => ({ benefitSiriusIds: ["SUP"] }),
    })).rejects.toBeInstanceOf(CoverageBudgetError);
    fixture.assertReadsConsumed();
    expect(fixture.readLimits.at(-1)).toBe(COVERAGE_LIMITS.page);
  });
  it.each(["termination", "supplemental"] as const)("enforces the byte ceiling during a %s page too", async kind => {
    almostFull(kind === "termination" ? "Reading termination evidence" : "Reading supplemental coverage", 2000, "bytes");
    const wide = oversized({ employerSiriusId: "x".repeat(1000) });
    const fixture = evidenceFixture(kind === "termination" ? [
      [{ id: "benefit", siriusId: "K" }], ready("trust-wmb-restart", "trust-wmb-terminate"), [],
      [{ id: "event", workerId: "ended", benefitId: "benefit", year: 2026, month: 11, data: { provenance: "coverage_inferred" } }],
      wide,
    ] : [
      [{ id: "benefit", siriusId: "K" }], [{ id: "supplemental" }], ready("trust-wmb-restart"), [member], wide,
    ], kind === "termination");
    const plugin = kind === "termination" ? kaiser : { ...kaiser,
      supplementalCoverage: () => ({ benefitSiriusIds: ["SUP"] }),
    };
    const error = await readCoverageEvidence(fixture.ctx, plugin).catch(error => error);
    expect(error).toBeInstanceOf(CoverageBudgetError);
    expect(error.diagnostics.exceeded).toEqual([
      expect.objectContaining({ dimension: "evidenceBytes", limit: COVERAGE_LIMITS.bytes }),
    ]);
    fixture.assertReadsConsumed();
    expect(fixture.readLimits.at(-1)).toBe(COVERAGE_LIMITS.page);
  });
});

describe("ended families are judged on every record a family member holds", () => {
  const parent = coverage("parent-10", "parent", 10);
  const attached = coverage("child-10", "child", 10, { sourceRelationId: "relation" });
  // The child's own coverage for the same month: no family relationship leads to it.
  const own = coverage("child-own-10", "child", 10);
  const reads = () => [
    [{ id: "benefit", siriusId: "K" }],
    ready("trust-wmb-restart", "trust-wmb-terminate"),
    [],
    [{ id: "event", workerId: "parent", benefitId: "benefit", year: 2026, month: 11, data: { provenance: "coverage_inferred" } }],
    [parent], [],
    [attached],
    [attached, own],
  ];
  it("leaves the conflicting family member out of the ended family and lists them", async () => {
    const fixture = evidenceFixture([
      ...reads(),
      [segmentStartRow(parent, { restart: 3 })],
      [{ id: "relation", worker1: "parent", worker2: "child", startYmd: null, endYmd: null, relationType: "child" }],
      [{ id: "parent", name: "Fictional Parent" }, { id: "child", name: "Fictional Child" }],
      [{ id: "benefit", name: "Fictional Plan" }],
      [{ id: "employer", name: "Fictional Employer" }],
    ], true);
    const evidence = await readCoverageEvidence(fixture.ctx, kaiser);
    fixture.assertReadsConsumed();
    // The generator drops every excluded record before counting a family, so
    // the ended subscriber is reported alone rather than with this child.
    expect([...evidence.excludedIds].sort()).toEqual(["child-10", "child-own-10"]);
    expect(evidence.terminationCandidates).toMatchObject([{ familyWmbId: "parent-10", start: "2026-03-01" }]);
    expect(evidence.exclusions).toMatchObject([{
      kind: "exclusion", reason: "family-member-conflict", workerId: "child", personLabel: "Fictional Child", month: "2026-10",
      records: [{ id: "child-10", subscriberLabel: "Fictional Parent" }, { id: "child-own-10", subscriberLabel: "Fictional Child" }],
    }]);

    // What the carrier is told about the ended family: the real HealthNet
    // assembly, rebuilding it for its last covered month from this evidence.
    const person = { contactId: "contact", workerSiriusId: "123", ssn: "001234567", givenName: "Fictional",
      familyName: "Example", middleName: null, email: "example@example.invalid", birthDate: "1980-01-01", genderCode: "F" };
    const attachedDependent = { ...person, depWmbId: attached.id, depWorkerId: "child", employerId: "employer",
      sourceRelationId: "relation", relationId: "relation", subscriberWorkerId: "parent", relationSiriusId: "CH",
      benefitId: "benefit", year: 2026, month: 10 };
    // `retained`: a dependent the assembly keeps is given a start date and contact details.
    const family = (retained: boolean) => {
      const assembly = ediReadFixture([[parent], [{ id: "benefit", siriusId: "H" }], [attachedDependent],
        ...(retained ? [[segmentStartRow(attached, { restart: 3 })]] : []),
        [person], [], [], ...(retained ? [[], []] : []), []]);
      assembly.ctx.input = { asOfDate: "2026-10-01" };
      return assembly;
    };
    const healthnet = requireEdiPlugin("sitespecific-bao-healthnet");
    const reported = family(false);
    reported.ctx.coverageEvidence = evidence;
    const rows = await healthnet.processBatch([parent.id], reported.ctx);
    reported.assertReadsConsumed();
    expect(rows.map(r => r.pk)).toEqual([parent.id]);
    expect(rows[0]).toMatchObject({ numberCovered: "1", contractType: "1" });
    // Without the exclusion the same family is reported as two covered people.
    const uncorrected = family(true);
    uncorrected.ctx.coverageEvidence = { ...evidence, excludedIds: new Set() };
    expect((await healthnet.processBatch([parent.id], uncorrected.ctx))[0]).toMatchObject({ numberCovered: "2", contractType: "2" });
    uncorrected.assertReadsConsumed();
  });
  it("stops the run instead when the temporary rule is off", async () => {
    process.env[variable] = "false";
    const fixture = evidenceFixture(reads(), true);
    await expect(readCoverageEvidence(fixture.ctx, kaiser)).rejects.toThrow(/Correction required.*family member of an ended subscriber.*child-own-10.*nothing was excluded/s);
    fixture.assertReadsConsumed();
  });
});

describe("earlier conflicts are budgeted before they are read", () => {
  const member = coverage("member-11", "member", 11);
  it("refuses an oversized history from its counts, without loading the records", async () => {
    const fixture = evidenceFixture([
      [{ id: "benefit", siriusId: "K" }], ready("trust-wmb-restart"), [member],
      [segmentStartRow(member, { restart: 1, conflictMonths: 10, conflictRecords: COVERAGE_LIMITS.rows })],
    ], false);
    const refusal = await readCoverageEvidence(fixture.ctx, kaiser).catch(error => error);
    expect(refusal).toBeInstanceOf(CoverageBudgetError);
    expect(refusal.diagnostics).toMatchObject({ phase: "Reading coverage start events",
      exceeded: [{ dimension: "retainedRecords", observed: COVERAGE_LIMITS.rows + 1, limit: COVERAGE_LIMITS.rows }] });
    // The conflict records, names and descriptions were never asked for.
    fixture.assertReadsConsumed();
  });
  it("reads only the conflicting months of a history that fits, and lists them as warnings", async () => {
    const fixture = evidenceFixture([
      [{ id: "benefit", siriusId: "K" }], ready("trust-wmb-restart"), [member],
      [segmentStartRow(member, { restart: 1, conflictMonths: 1, conflictRecords: 2 })],
      [{ id: "member-6", worker_id: "member", benefit_id: "benefit", year: 2026, month: 6, employer_id: "employer", source_relation_id: null, employer_sirius_id: "100" },
        { id: "member-6-cobra", worker_id: "member", benefit_id: "benefit", year: 2026, month: 6, employer_id: "cobra", source_relation_id: null, employer_sirius_id: "COBRA" }],
      [{ id: "member", name: "Fictional Member" }], [{ id: "benefit", name: "Fictional Plan" }],
      [{ id: "employer", name: "Fictional Employer" }, { id: "cobra", name: "COBRA" }],
    ], false);
    const evidence = await readCoverageEvidence(fixture.ctx, kaiser);
    fixture.assertReadsConsumed();
    expect(evidence.excludedIds.size).toBe(0);
    expect(evidence.exclusions).toEqual([]);
    expect(evidence.starts.get("member-11")).toMatchObject({ coverageStartYmd: "2026-01-01" });
    expect(evidence.warnings).toMatchObject([{ kind: "warning", reason: "in-run-conflict", workerId: "member", month: "2026-06",
      records: [{ id: "member-6", isCobra: false }, { id: "member-6-cobra", isCobra: true }] }]);
  });
});
