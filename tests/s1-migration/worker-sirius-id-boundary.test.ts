import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Run the actual worker pass with in-memory IO, without importing the CLI
// (whose entry point connects to the database). Keep the numeric parser and
// the final Sirius-ID verification in the fixture, not copies of their logic.
const source = readFileSync("scripts/s1-migration/load-contacts-workers.ts", "utf8");
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error("Worker loader fixture boundary not found");
  return source.slice(from, to);
}
const workerPass = between("  const fsidOf =", "  report.workers = wStats;");
const verification = between("      const { value: vFsid }", "      // Legacy NID coverage:");

async function runFixture(
  kind: "new" | "mapped" | "stub",
  storedId: string | null = "100",
  raw: string | null = "100",
  verificationId?: string | null,
) {
  const row = { id: "worker-10", siriusId: storedId, contactId: "contact-91", ssn: null };
  const mapping = { s2Id: row.id, stub: kind === "stub" };
  const workerMap = new Map(kind === "new" ? [] : [[10, mapping]]);
  const create = vi.fn(async (input) => {
    Object.assign(row, input, { siriusId: String(input.siriusId) });
    return row;
  });
  const update = vi.fn(async (_id, input) => {
    Object.assign(row, input);
    return row;
  });
  const absorb = vi.fn(async () => { mapping.stub = false; });
  const context = {
    stagedWorkers: [{ nid: 10, contentHash: "changed", fields: {
      field_sirius_id: raw, field_sirius_contact: 91,
    } }],
    workerMap,
    progress: { add: () => {} },
    ssnTransferByIncomingNid: new Map(),
    classifyRow: () => "changed",
    LOGIC_VERSION: 1, FORCE_RECONCILE: false, DRY_RUN: false, LOADER: "t3t1-contacts-workers",
    summary: { created: 0, updated: 0, unchanged: 0 },
    wStats: { matched: 0, absorbedStubs: 0, created: 0, updated: 0, workerIdsCreated: 0 },
    fastPathSkips: 0, processedWorkers: [], pendingWorkerAdvance: [],
    finalContactMap: new Map([[91, { s2Id: "contact-91" }]]),
    strOf: (fields: Record<string, unknown>, key: string) => fields[key] ?? null,
    targetNidOf: (fields: Record<string, unknown>, key: string) => fields[key] ?? null,
    yesNo: () => null,
    rejects: { add: vi.fn(), has: () => false },
    workerDataById: new Map(), workerSsn: new Map(), ssnOwner: new Map(),
    canonicalJson: JSON.stringify,
    runInTransaction: async (fn: () => Promise<unknown>) => fn(),
    withNotificationsSuppressed: async (fn: () => Promise<unknown>) => fn(),
    s1Workers: { createWorkerForMigration: create, updateWorkerForMigration: update },
    storage: {
      workers: { getWorker: async () => row },
      workerIds: { getWorkerIdsByWorkerId: async () => [{ typeId: "legacy", value: "10" }] },
    },
    oldSiriusIdTypeId: null, idTypeByLabel: new Map([["Legacy NID", "legacy"]]),
    putMapping: async () => { workerMap.set(10, mapping); return row.id; },
    markAbsorbed: absorb, verificationId,
    console: { error: vi.fn() },
  };
  const program = ts.transpileModule(`(async () => {
    ${workerPass}
    if (verificationId !== undefined) {
      (await storage.workers.getWorker(workerMap.get(10).s2Id)).siriusId = verificationId;
    }
    let verifyFailures = 0;
    const verifyFailedWorkerNids = new Set();
    for (const w of stagedWorkers) {
      const row = await storage.workers.getWorker(workerMap.get(w.nid).s2Id);
      ${verification}
    }
    return { verifyFailures };
  })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { result: await runInNewContext(program, context), create, update, absorb, context };
}

describe("contacts-workers Sirius ID storage boundary", () => {
  it.each(["mapped", "stub"] as const)("accepts an exact string-valued ID on a %s worker and verifies it", async kind => {
    const fixture = await runFixture(kind);
    expect(fixture.result.verifyFailures).toBe(0);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledTimes(kind === "stub" ? 1 : 0);
    expect(fixture.absorb).toHaveBeenCalledTimes(kind === "stub" ? 1 : 0);
    expect(fixture.context.rejects.add).not.toHaveBeenCalled();
  });

  it.each(["100", "000100", "0", "2147483647"])("creates using canonical string input for source %s and verifies it", async raw => {
    const fixture = await runFixture("new", null, raw);
    expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ siriusId: String(Number(raw)) }));
    expect(fixture.result.verifyFailures).toBe(0);
  });

  it.each(["mapped", "stub"] as const)("still refuses changed ownership on a %s worker", async kind => {
    await expect(runFixture(kind, "101")).rejects.toThrow(/ownership changed after preflight/);
    await expect(runFixture(kind, null)).rejects.toThrow(/ownership changed after preflight/);
  });

  it.each(["new", "mapped", "stub"] as const)("detects ownership drift during final verification for %s workers", async kind => {
    const fixture = await runFixture(kind, "100", "100", "101");
    expect(fixture.result.verifyFailures).toBe(1);
    expect(fixture.context.console.error).toHaveBeenCalledWith(expect.stringContaining("expected field_sirius_id 100"));
  });

  it.each([null, "", "-1", "1.5", "abc", "2147483648", "9007199254740992"])("refuses invalid source %s even if preflight were bypassed", async raw => {
    await expect(runFixture("new", null, raw)).rejects.toThrow(/preflight invariant failed/);
  });
});
