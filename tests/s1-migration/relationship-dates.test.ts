import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as utils from "../../scripts/s1-migration/lib/loader-utils";
import { canonicalJson, classifyRow, combineFingerprints, contentHashOf, emptySummary } from "../../scripts/s1-migration/lib/sync";

// Execute the actual loader's row/reconciliation/verification pass, with only
// IO replaced. No CLI startup, database, source records or eligibility scans.
const source = readFileSync("scripts/s1-migration/load-relationships.ts", "utf8");
const version = Number(source.match(/const LOGIC_VERSION = (\d+)/)![1]);
const pass = source.slice(source.indexOf("  const stats ="), source.indexOf("  // ---- deletion sweep:"));
const program = ts.transpileModule(`(async () => {
  ${source.slice(source.indexOf("const FATAL_REASONS"), source.indexOf("async function main()"))}
  ${pass}
  return { summary, fastPathSkips, verifyFailures };
})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

class ValidationError extends Error {
  constructor(public field: string, message: string) { super(message); }
}

function fixture(start: string | null, end: string | null, active: string | null = "Yes", changed: number | null = 1_700_000_000) {
  const node = { nid: 1, contentHash: "source-hash", changed, fields: {
    field_sirius_contact: 10, field_sirius_contact_alt: 20,
    field_sirius_contact_reltype: 30, field_sirius_date_start: start,
    field_sirius_date_end: end, field_sirius_active: active,
  } };
  let row: Record<string, any> | undefined;
  const mappings = new Map<number, any>();
  const create = vi.fn(async (data) => (row = { id: "relation-1", ...data }));
  const reconcile = vi.fn(async (_id, data) => (row = { ...row, ...data }));
  const advance = vi.fn(async (_entity, pending, logicVersion) => {
    for (const p of pending) Object.assign(mappings.get(p.s1Id), { consumedFingerprint: p.fingerprint, logicVersion });
  });
  return {
    node, create, reconcile, advance, mappings,
    get row() { return row; },
    seed(endYmd: string | null, logicVersion = version - 1) {
      row = { id: "relation-1", worker1: "worker-10", worker2: "worker-20",
        relationType: "type-30", startYmd: "2000-01-01", endYmd,
        data: { datesDefaulted: true, unrelated: "preserved" } };
      mappings.set(1, { s2Id: row.id, logicVersion, consumedFingerprint: combineFingerprints([
        ["node", node.contentHash], ["ownerWorker", contentHashOf(100)], ["altWorker", contentHashOf(200)],
      ]) });
    },
    async run(force = false) {
      const rejects = new utils.RejectLog();
      const report = {};
      const result = await runInNewContext(program, {
        ...utils, canonicalJson, classifyRow, combineFingerprints, contentHashOf, emptySummary,
        rels: [node], relMap: mappings, report, rejects,
        workerNidByContactNid: new Map([[10, 100], [20, 200]]),
        workerMap: new Map([[100, { s2Id: "worker-10" }], [200, { s2Id: "worker-20" }]]),
        shellMap: new Map(), contactMap: new Map(), resolveReltype: () => "type-30",
        todayYmd: "2026-11-19", DRY_RUN: false, LOGIC_VERSION: version, FORCE_RECONCILE: force,
        LOADER: "t15-relationships", WorkerRelationValidationError: ValidationError,
        progress: { add() {}, phase() {} }, console: { error: vi.fn() },
        withNotificationsSuppressed: (fn: () => unknown) => fn(),
        storage: { workerRelations: { get: async () => row, create } },
        s1Relations: { reconcileFromMigration: reconcile },
        getMappings: async () => mappings,
        putMapping: async (_entity: string, nid: number, id: string, options: { fingerprint: string; logicVersion: string }) => {
          mappings.set(nid, { s2Id: id, consumedFingerprint: options.fingerprint, logicVersion: options.logicVersion });
          return id;
        },
        advanceFingerprints: advance,
      });
      return { ...result, rejects, report };
    },
  };
}

describe("relationship source-date preservation", () => {
  it.each([
    [null, null, "2000-01-01", null],
    ["   ", "", "2000-01-01", null],
    ["2010-05-01", null, "2010-05-01", null],
    [null, "2015-03-04", "2000-01-01", "2015-03-04"],
    ["2010-05-01", "2011-01-01", "2010-05-01", "2011-01-01"],
    [null, "2000-01-02", "2000-01-01", "2000-01-02"],
  ])("preserves source %s / %s on initial load and reruns", async (start, end, startYmd, endYmd) => {
    const f = fixture(start, end);
    expect((await f.run()).rejects.counts).toEqual({});
    expect(f.row).toMatchObject({ startYmd, endYmd });
    expect((await f.run()).fastPathSkips).toBe(1);
    expect((await f.run(true)).verifyFailures).toBe(0);
    expect(f.row).toMatchObject({ startYmd, endYmd });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.reconcile).not.toHaveBeenCalled();
  });

  it.each([false, true])("repairs a legacy fabricated end with unchanged source, forced=%s", async force => {
    const f = fixture(null, null);
    f.seed("2000-01-02");
    const result = await f.run(force);
    expect(result.fastPathSkips).toBe(0);
    expect(result.verifyFailures).toBe(0);
    expect(f.row).toMatchObject({ id: "relation-1", startYmd: "2000-01-01", endYmd: null,
      data: { datesDefaulted: true, unrelated: "preserved" } });
    expect(f.mappings.get(1).logicVersion).toBe(version);
    expect(f.reconcile).toHaveBeenCalledOnce();
    await f.run(true);
    expect(f.reconcile).toHaveBeenCalledOnce();
  });

  it("does not undo a prior cleanup when the old fingerprint reprocesses", async () => {
    const f = fixture(null, null);
    f.seed(null);
    expect((await f.run()).fastPathSkips).toBe(0);
    expect(f.row!.endYmd).toBeNull();
    expect(f.reconcile).not.toHaveBeenCalled();
  });

  it("reconciles source date changes, including reopening and genuine end dates", async () => {
    const f = fixture("2010-05-01", "2011-01-01");
    await f.run();
    f.node.fields.field_sirius_date_end = null;
    f.node.contentHash = "reopened";
    await f.run();
    expect(f.row!.endYmd).toBeNull();
    f.node.fields.field_sirius_date_end = "2020-02-29";
    f.node.contentHash = "ended";
    await f.run();
    expect(f.row).toMatchObject({ startYmd: "2010-05-01", endYmd: "2020-02-29" });
  });

  it.each([null, "2010-05-01"])("honors explicit inactive status with start %s", async start => {
    const f = fixture(start, null, "No", Date.parse("2020-03-04T00:00:00Z") / 1000);
    await f.run();
    expect(f.row!.endYmd).toBe("2020-03-04");
    await f.run(true);
    expect(f.row!.endYmd).toBe("2020-03-04");
  });

  it("keeps an explicit inactive end instead of replacing it with changed", async () => {
    const f = fixture(null, "2015-03-04", "No", null);
    expect((await f.run()).rejects.counts).toEqual({});
    expect(f.row!.endYmd).toBe("2015-03-04");
  });

  it.each([null, "unknown"])("does not infer an end from unspecified activity %s", async active => {
    const f = fixture(null, null, active);
    await f.run();
    expect(f.row!.endYmd).toBeNull();
  });

  it.each([
    [null, null, "No", null, "bad_changed_epoch"],
    [null, null, "No", NaN, "bad_changed_epoch"],
    [null, null, "No", 0, "end_before_start"],
    [null, "1999-01-01", "Yes", null, "end_before_start"],
    ["2024-02-30", null, "Yes", null, "bad_start_date"],
    [null, "not a date", "Yes", null, "bad_end_date"],
    ["2099-01-01", null, "Yes", null, "future_start_date"],
  ])("rejects unusable evidence without writes: %s / %s / %s / %s", async (start, end, active, changed, reason) => {
    const f = fixture(start, end, active, changed);
    expect((await f.run()).rejects.counts).toEqual({ [reason!]: 1 });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.mappings.size).toBe(0);
  });

  it("keeps overlapping corrections rejected and retryable", async () => {
    const f = fixture(null, null);
    f.seed("2000-01-02");
    f.reconcile.mockRejectedValue(new ValidationError("startYmd", "overlapping period"));
    expect((await f.run()).rejects.counts).toEqual({ duplicate_overlapping_relation: 1 });
    expect(f.row!.endYmd).toBe("2000-01-02");
    expect(f.mappings.get(1).logicVersion).toBe(version - 1);
    expect(f.advance).toHaveBeenLastCalledWith("relation", [], version);
  });

  it("detects a failed date correction before advancing a mapped fingerprint", async () => {
    const f = fixture(null, null);
    f.seed("2000-01-02");
    f.reconcile.mockImplementation(async () => f.row!);
    expect((await f.run()).verifyFailures).toBe(1);
    expect(f.advance).toHaveBeenLastCalledWith("relation", [], version);
  });
});
