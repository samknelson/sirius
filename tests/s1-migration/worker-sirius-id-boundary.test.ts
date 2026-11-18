import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { CONTACT_WORKER_ASSERTIONS, VerificationEvidence } from "../../scripts/s1-migration/lib/report-diagnostics";

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
    verifyEvidence: new VerificationEvidence(),
  };
  const program = ts.transpileModule(`(async () => {
    ${workerPass}
    if (verificationId !== undefined) {
      (await storage.workers.getWorker(workerMap.get(10).s2Id)).siriusId = verificationId;
    }
    let verifyFailures = 0;
    const verifyFailedWorkerNids = new Set();
    for (const w of stagedWorkers) {
      const m = workerMap.get(w.nid);
      const row = await storage.workers.getWorker(m.s2Id);
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
    expect(fixture.context.verifyEvidence.report()).toMatchObject({
      counts: { worker_sirius_id_mismatch: 1 },
      samples: [{ code: "worker_sirius_id_mismatch", workerNid: 10 }],
    });
    expect(fixture.context.console.error).toHaveBeenCalledWith(expect.stringContaining("expected field_sirius_id 100"));
  });

  it.each([null, "", "-1", "1.5", "abc", "2147483648", "9007199254740992"])("refuses invalid source %s even if preflight were bypassed", async raw => {
    await expect(runFixture("new", null, raw)).rejects.toThrow(/preflight invariant failed/);
  });
});

// Exercise the entire real verification and fingerprint-advance block, not
// just the per-worker subset above. All IO is synthetic and read-only.
const fullVerification = between('  progress.phase("verify", processedContacts.length', "  // ---- deletion sweeps:");
const contactId = "00000000-0000-4000-8000-000000000091";
const workerId = "00000000-0000-4000-8000-000000000010";
async function verifyFixture(kind: string, size = 1) {
  const nids = Array.from({ length: size }, (_, i) => i + 1);
  const contacts = nids.map(nid => ({ nid }));
  const workers = nids.map(nid => ({ nid, fields: {
    field_sirius_contact: nid, field_sirius_ssn: "123456789",
  } }));
  const advances: Record<string, unknown[]> = {};
  const shared = kind.startsWith("shared_email");
  const placeholder = kind === "placeholder_email_present";
  const context = {
    VerificationEvidence, DRY_RUN: false, LOGIC_VERSION: 3,
    processedContacts: kind.startsWith("contact_") ? contacts : [],
    processedWorkers: kind.startsWith("worker_") ? workers : [],
    sharedEmailPlan: new Map(shared ? nids.map(nid => [`canary${nid}@example.com`,
      { memberNids: [nid], winnerNid: kind === "shared_email_owner_missing" ? nid : null,
        rule: "deferredNoOwner" }]) : []),
    getMappings: async (entity: string, ids: number[]) => new Map(
      kind === `${entity}_mapping_missing` ? [] : ids.map(nid => [nid,
        { s2Id: entity === "contact" ? contactId : workerId, stub: kind === "worker_still_stub" }]),
    ),
    storage: {
      contacts: { getContact: async () => kind === "contact_row_missing" ? null :
        { id: contactId, email: kind === "shared_email_nonowner_present" ? "canary1@example.com" : null } },
      workers: { getWorker: async () => kind === "worker_row_missing" ? null :
        { id: workerId, contactId: kind === "worker_contact_mismatch" ? workerId : contactId,
          siriusId: kind === "worker_sirius_id_mismatch" ? "101" : "100",
          ssn: kind === "worker_ssn_mismatch" ? "987654321" : "123456789" } },
      workerIds: { getWorkerIdsByWorkerId: async () => kind === "worker_legacy_nid_missing" ? [] :
        nids.map(nid => ({ typeId: "legacy", value: String(nid) })) },
    },
    db: { execute: async () => ({ rows: placeholder ?
      nids.map(() => ({ email: "private-placeholder@example.com", cnt: 2, contact_id: contactId })) :
      [] }) },
    sql: Object.assign(() => "", { join: () => "" }),
    rejects: { has: () => false },
    targetNidOf: (f: Record<string, unknown>, k: string) => f[k] ?? null,
    strOf: (f: Record<string, unknown>, k: string) => f[k] ?? null,
    normalizeEmailKey: (v: string | null) => v?.trim().toLowerCase() ?? null,
    normalizeSsn: (v: string) => v,
    fsidOf: () => ({ value: kind === "worker_source_sirius_id_invalid" ? null : 100 }),
    idTypeByLabel: new Map([["Legacy NID", "legacy"]]),
    ssnTransferByIncomingNid: new Map(kind === "worker_ssn_transfer_ownership" ?
      [[1, { incomingNid: 1, ssn: "123456789" }]] : []),
    PLACEHOLDER_EMAILS: new Set(["private-placeholder@example.com"]), suppressions: new Map(),
    progress: { phase() {}, add() {}, stop() {} },
    console: { error: vi.fn(), log: vi.fn() },
    pendingContactAdvance: nids.map(s1Id => ({ s1Id, fingerprint: "changed" })),
    pendingWorkerAdvance: nids.map(s1Id => ({ s1Id, fingerprint: "changed" })),
    advanceFingerprints: async (entity: string, rows: unknown[]) => { advances[entity] = rows; },
  };
  const program = ts.transpileModule(`(async () => {
    ${fullVerification}
    return { verifyFailures, diagnostics: verifyEvidence.report(),
      failedContacts: [...verifyFailedContactNids], failedWorkers: [...verifyFailedWorkerNids] };
  })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { result: await runInNewContext(program, context), advances };
}

describe("contacts-workers persisted assertion evidence", () => {
  it.each(CONTACT_WORKER_ASSERTIONS)("captures %s without compared values and preserves failed-record exclusions", async code => {
    const { result, advances } = await verifyFixture(code);
    expect(result.verifyFailures).toBe(1);
    expect(result.diagnostics).toMatchObject({
      counts: { [code]: 1 }, samples: [expect.objectContaining({ code })],
      sampleLimit: 25, samplesTruncated: false,
    });
    const json = JSON.stringify(result.diagnostics);
    for (const value of ["canary", "@", "123456789", "987654321", "private-placeholder"]) {
      expect(json).not.toContain(value);
    }
    if (code.startsWith("worker_")) {
      expect(result.failedWorkers).toEqual([1]);
      expect(advances.worker).toEqual([]);
    } else if (!code.startsWith("placeholder_")) {
      expect(result.failedContacts).toEqual([1]);
      expect(advances.contact).toEqual([]);
    } else {
      // The existing global placeholder check did not alter fingerprint sets.
      expect(result.failedContacts).toEqual([]);
      expect(result.diagnostics.samples[0]).toMatchObject({ contactId, affectedContacts: 2 });
    }
  });
  it.each(["contact_mapping_missing", "worker_sirius_id_mismatch", "placeholder_email_present", "shared_email_owner_missing"])(
    "counts all %s failures beyond the stored sample cap", async code => {
      const { result } = await verifyFixture(code, 31);
      expect(result.verifyFailures).toBe(31);
      expect(result.diagnostics.counts[code]).toBe(31);
      expect(result.diagnostics.samples).toHaveLength(25);
      expect(result.diagnostics.samplesTruncated).toBe(true);
    },
  );
  it("keeps passing verification and fingerprint advancement unchanged", async () => {
    const { result, advances } = await verifyFixture("pass");
    expect(result.verifyFailures).toBe(0);
    expect(result.diagnostics).toMatchObject({ counts: {}, samples: [], samplesTruncated: false });
    expect(advances.worker).toHaveLength(1);
    expect(advances.contact).toHaveLength(1);
  });
});
