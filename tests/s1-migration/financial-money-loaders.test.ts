import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Execute the actual CLI modules, classification, source identity resolver,
// approval coordinate checks and result builder. Only IO is replaced.
const io = vi.hoisted(() => ({
  execute: vi.fn(), mappings: vi.fn(), put: vi.fn(), putMany: vi.fn(), advance: vi.fn(),
  createPayment: vi.fn(), updatePayment: vi.fn(), createEntry: vi.fn(), updateEntry: vi.fn(),
  ea: vi.fn(), result: vi.fn(), inventory: vi.fn(),
  notifications: vi.fn(), charges: vi.fn(), sampling: vi.fn(),
}));
type Row = Record<string, any>;
let payments: Row[], entries: Row[];
let moneyMaps: Map<number, Row>;
let workerId: string | null;
let unsafe: boolean;
let stream: "payment" | "ar";
let payer: number;
const originalArgv = process.argv;
const dialect = new PgDialect();
const hash = "a".repeat(64);

vi.mock("../../server/storage/db", () => ({
  db: { execute: io.execute }, pool: { end: async () => {} },
}));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: () => ({ execute: io.execute }) }));
vi.mock("../../server/storage/database", () => ({
  storage: { ledger: {
    ea: { getOrCreate: io.ea },
    payments: { createForMigration: io.createPayment, updateForMigration: io.updatePayment,
      getByIds: async (ids: string[]) => payments.filter(row => ids.includes(row.id)) },
    entries: { create: io.createEntry, update: io.updateEntry },
  } },
}));
vi.mock("../../server/storage/drain-storage-side-effects", () => ({ drainStorageSideEffects: async () => {} }));
vi.mock("../../server/storage/middleware/logging", () => ({ setStorageLogSampling: io.sampling }));
vi.mock("../../server/middleware/request-context", () => ({
  withNotificationsSuppressed: io.notifications, withChargePluginsSuppressed: io.charges,
}));
vi.mock("../../scripts/s1-migration/lib/script-env", () => ({ getEnvironmentVariable: () => undefined }));
vi.mock("../../scripts/s1-migration/lib/migration-lock", () => ({ acquireMigrationSeedLock: async () => null }));
vi.mock("../../scripts/s1-migration/lib/timezone-contract", () => ({ getTimeZoneEvidence: () => null }));
vi.mock("../../scripts/s1-migration/lib/progress", () => ({
  makeProgressLogger: () => ({ phase: () => {}, add: () => {}, stop: () => {} }),
}));
vi.mock("../../scripts/s1-migration/lib/staging", () => ({
  ensureStagingSchema: async () => {}, ensureRawLedgerTable: async () => {}, recordRun: async () => 1,
  stagedRawLedgerCount: async () => 2,
  pagedRawLedger: async function* () {
    yield [1, 2].map(id => ({ ledgerId: id, participant: payer, account: 301,
      status: "Cleared", amount: id === 1 ? "-10.00" : "10.00", ts: 1767225600,
      reference: id === 1 ? 1001 : 2001, memo: "retained", key: null, json: null, contentHash: "same-source" }));
  },
}));
vi.mock("../../scripts/s1-migration/lib/loader-utils", async importOriginal => ({
  ...await importOriginal<typeof import("../../scripts/s1-migration/lib/loader-utils")>(),
  stagedCountOf: async () => 1,
  pagedStaged: async function* () {
    yield [{ nid: 1001, contentHash: "same-source", fields: {
      field_sirius_payer: [{ target_id: payer }], field_sirius_ledger_account: [{ target_id: 301 }],
      field_sirius_dollar_amt: [{ value: "10.00" }], field_sirius_payment_status: [{ value: "Cleared" }],
      field_sirius_datetime_created: [{ value: "2026-01-01 00:00:00" }],
      field_sirius_payment_type: [{ tid: 401 }],
    } }];
  },
}));
vi.mock("../../scripts/s1-migration/lib/idmap", () => ({
  ensureIdMap: async () => {}, getMappings: io.mappings,
  putMapping: io.put, putMappings: io.putMany, advanceFingerprints: io.advance,
  deleteMapping: vi.fn(), remapMapping: vi.fn(), clearFingerprints: vi.fn(),
}));
vi.mock("../../scripts/s1-migration/lib/resolvers", async importOriginal => ({
  ...await importOriginal<typeof import("../../scripts/s1-migration/lib/resolvers")>(),
  ensureLedgerAccounts: async () => ({ map: new Map([[301, "fund"]]), failed: new Map() }),
}));
vi.mock("../../scripts/s1-migration/lib/sync", async importOriginal => ({
  ...await importOriginal<typeof import("../../scripts/s1-migration/lib/sync")>(),
  emitLoaderResult: io.result,
  sweepDeletions: async () => ({ candidates: 0, deleted: 0, alreadyHandled: 0, findings: [] }),
}));
vi.mock("../../scripts/s1-migration/lib/financial-link-inventory", () => ({
  inventoryFinancialLinks: io.inventory,
  publicFinancialInventory: (inventory: Row) => {
    const { rebinds: _private, ...publicResult } = inventory;
    return publicResult;
  },
}));

const entity = () => payer === 201
  ? { entityType: "employer", entityId: "employer" }
  : payer === 12 ? { entityType: "contact", entityId: "standalone" }
    : { entityType: "worker", entityId: workerId };
const coordinate = (eaId: string) => {
  const [entityType, entityId] = eaId.split(":");
  return { entityType, entityId, accountId: "fund" };
};
const makeMapping = (id: string) => ({ s2Id: id, consumedFingerprint: "same-source",
  logicVersion: stream === "payment" ? 2 : 3, stub: false });
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  payments = []; entries = []; moneyMaps = new Map();
  workerId = "w1"; unsafe = false; payer = 11;
  io.notifications.mockImplementation(async fn => fn());
  io.charges.mockImplementation(async fn => fn());
  io.sampling.mockReset().mockResolvedValue(undefined);
  io.ea.mockImplementation(async (entityType, entityId, accountId) => ({
    id: `${entityType}:${entityId}`, entityType, entityId, accountId,
  }));
  io.createPayment.mockImplementation(async patch => {
    const row = { id: "payment1", memo: "operator note", ...patch }; payments.push(row); return row;
  });
  io.updatePayment.mockImplementation(async (id, patch) => {
    const row = payments.find(row => row.id === id)!; Object.assign(row, patch); return row;
  });
  io.createEntry.mockImplementation(async patch => {
    const row = { id: `entry${entries.length + 1}`, ...patch }; entries.push(row); return row;
  });
  io.updateEntry.mockImplementation(async (id, patch) => {
    const row = entries.find(row => row.id === id)!; Object.assign(row, patch); return row;
  });
  io.put.mockImplementation(async (_entity, nid, id) => { moneyMaps.set(nid, makeMapping(id)); return id; });
  io.putMany.mockImplementation(async (_entity, rows) => {
    for (const row of rows) moneyMaps.set(row.s1Id, makeMapping(row.s2Id));
  });
  io.mappings.mockImplementation(async (kind, nids: number[]) => {
    if (kind === (stream === "payment" ? "payment" : "ledger-ar")) {
      return new Map([...moneyMaps].filter(([nid]) => nids.includes(nid)));
    }
    if (kind === "term") return new Map([[401, { s2Id: "check" }]]);
    if (kind === "payment" && nids.includes(1001)) return new Map([[1001, { s2Id: "historical-payment" }]]);
    if (kind === "payperiod" && nids.includes(2001)) return new Map([[2001, { s2Id: "historical-hour" }]]);
    return new Map();
  });
  io.execute.mockImplementation(async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    const text = sql.replace(/\s+/g, " ").trim();
    let rows: Row[];
    if (text.includes("jsonb_build_object")) {
      rows = [{ nid: 101, fields: { field_sirius_contact: [{ target_id: 11 }] } }];
    } else if (text.includes("SELECT entity, s1_id")) {
      rows = [
        { entity: "contact", s1_id: "11", s2_id: "c1" },
        { entity: "contact", s1_id: "12", s2_id: "standalone" },
        { entity: "employer", s1_id: "201", s2_id: "employer" },
        ...(workerId ? [{ entity: "worker", s1_id: "101", s2_id: workerId }] : []),
      ].filter(row => params.includes(Number(row.s1_id)));
    } else if (text.includes('contact_id AS "contactId"')) {
      rows = workerId ? [{ id: workerId, contactId: unsafe ? "wrong-contact" : "c1" }] : [];
    } else if (text.startsWith("SELECT id FROM contacts")) {
      rows = ["c1", "standalone"].filter(id => params.includes(id)).map(id => ({ id }));
    } else if (text.startsWith("SELECT id FROM employers")) {
      rows = [{ id: "employer" }];
    } else if (text.includes("FROM options_ledger_payment_type")) {
      rows = [{ id: "check", name: "Check", currency_code: "USD" }];
    } else if (text.includes("SELECT id, currency_code FROM ledger_accounts")) {
      rows = [{ id: "fund", currency_code: "USD" }];
    } else if (text.includes("SELECT id, details->>'s1Nid'")) {
      rows = payments.map(row => ({ id: row.id, nid: String(row.details.s1Nid) }));
    } else if (text.includes('AS "sourceNid"')) {
      rows = payments.map(row => ({ id: row.id, ...coordinate(row.ledgerEaId),
        ledgerEaId: row.ledgerEaId, source: "s1-migration", sourceNid: String(row.details.s1Nid) }));
    } else if (text.includes("SELECT l.id, charge_plugin_key AS key")) {
      rows = entries.map(row => ({
        id: row.id, key: row.chargePluginKey, amount: row.amount, memo: row.memo, ea_id: row.eaId,
        statement_ymd: row.statementYmd, date_epoch: row.date.getTime() / 1000,
        reference_type: row.referenceType, reference_id: row.referenceId, data: row.data,
        entity_type: coordinate(row.eaId).entityType, entity_id: coordinate(row.eaId).entityId, account_id: "fund",
      }));
    } else if (text.includes("count(*)::int AS n")) {
      const money = text.includes("ledger_payments") ? payments : entries;
      rows = money.length ? [{ account_id: "fund", n: money.length,
        total: money.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2) }] : [];
    } else if (text.includes("SELECT id, charge_plugin_key AS key FROM ledger")) {
      rows = entries.filter(row => row.id > String(params[1])).map(row => ({ id: row.id, key: row.chargePluginKey }));
    } else if (text.includes("SELECT ledger_id FROM s1_staging.raw_ledger_ar")) {
      rows = [{ ledger_id: 1 }, { ledger_id: 2 }];
    } else if (text.includes("reference_type = 's1-unknown'") || text.includes("reference_type = 'hour'")) {
      rows = [];
    } else throw new Error(`Unhandled money fixture query: ${text}`);
    return { rows };
  });
  io.inventory.mockImplementation(async () => ({
    checkpoint: "reviewed", evidenceHash: hash, blocked: 0, mismatched: 0,
    counts: { attribution_mismatches: 0 },
    rebinds: (stream === "payment" ? payments : entries).map(row => ({
      stream, id: row.id, oldEaId: row.ledgerEaId ?? row.eaId, accountId: "fund", entity: entity(),
    })),
  }));
});
afterEach(() => { process.argv = originalArgv; vi.restoreAllMocks(); });

async function load(which: "payment" | "ar", args: string[] = []) {
  stream = which;
  vi.resetModules();
  vi.mocked(process.exit).mockClear();
  io.result.mockClear();
  process.argv = ["node", "loader.ts", ...args];
  if (which === "payment") await import("../../scripts/s1-migration/load-payments");
  else await import("../../scripts/s1-migration/load-ledger");
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalled());
  return io.result.mock.calls[0]?.[0];
}
const approvalArgs = () => ["--approve-financial-links", hash, "--financial-links-checkpoint", "reviewed"];

describe.each(["payment", "ar"] as const)("actual %s loader daily identity reconciliation", which => {
  it("stops before target reads or writes when audit sampling activation is refused", async () => {
    io.sampling.mockRejectedValue(new Error("Storage audit sampling requires verified maintenance"));
    expect(await load(which)).toBeUndefined();
    expect(process.exit).toHaveBeenLastCalledWith(1);
    expect(io.execute).not.toHaveBeenCalled();
    expect(io.ea).not.toHaveBeenCalled();
    expect(io.createPayment).not.toHaveBeenCalled();
    expect(io.createEntry).not.toHaveBeenCalled();
    expect(io.put).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("SUPPRESSED"));
  });

  it("loads contact-shaped activity to the exact worker and leaves the next run unchanged", async () => {
    const first = await load(which);
    expect(first.summary.created).toBe(which === "payment" ? 1 : 2);
    expect(first.verify.status).toBe("pass");
    expect(io.ea).toHaveBeenCalledWith("worker", "w1", "fund");
    expect(io.notifications).toHaveBeenCalled();
    expect(io.charges).toHaveBeenCalled();
    const again = await load(which);
    expect(again.summary).toMatchObject({ created: 0, updated: 0, unchanged: which === "payment" ? 1 : 2 });
    if (which === "ar") {
      expect(entries.map(row => [row.referenceType, row.referenceId])).toEqual([
        ["payment", "historical-payment"], ["hour", "historical-hour"],
      ]);
    }
  });
  it.each([201, 12])("keeps employer/standalone contact payer %s distinct from workers", async nid => {
    payer = nid;
    expect((await load(which)).verify.status).toBe("pass");
    expect(io.ea).toHaveBeenCalledWith(nid === 201 ? "employer" : "contact",
      nid === 201 ? "employer" : "standalone", "fund");
  });
  it("blocks broken source-worker dependencies without creating a contact fallback", async () => {
    workerId = null;
    const result = await load(which);
    expect(result.rejectGate.status).toBe("fail");
    expect(io.ea).not.toHaveBeenCalled();
    expect(payments).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });
  it("refuses unchanged-source historical reassignment even with force", async () => {
    await load(which);
    const before = structuredClone({ payments, entries });
    workerId = "w2";
    expect(await load(which, ["--force-reconcile"])).toBeUndefined();
    expect(process.exit).toHaveBeenLastCalledWith(1);
    expect({ payments, entries }).toEqual(before);
  });
  it("reconciles an exact approved dependency change in place, preserving IDs and payment/hour references", async () => {
    await load(which);
    if (which === "payment") payments[0].memo = "operator note";
    const ids = (which === "payment" ? payments : entries).map(row => row.id);
    const refs = entries.map(row => [row.referenceType, row.referenceId]);
    workerId = "w2"; // Same source content, different proven source-worker mapping.
    const approved = await load(which, approvalArgs());
    expect(approved.summary.updated).toBe(which === "payment" ? 1 : 2);
    expect(approved.verify.status).toBe("pass");
    expect((which === "payment" ? payments : entries).map(row => row.id)).toEqual(ids);
    expect((which === "payment" ? payments : entries).every(row => (row.ledgerEaId ?? row.eaId) === "worker:w2")).toBe(true);
    expect(entries.map(row => [row.referenceType, row.referenceId])).toEqual(refs);
    if (which === "payment") expect(payments[0]).toMatchObject({ memo: "operator note", allocated: true });
    const again = await load(which);
    expect(again.summary).toMatchObject({ created: 0, updated: 0, unchanged: which === "payment" ? 1 : 2 });
  });
  it("refuses stale approval before any reconciliation writes", async () => {
    await load(which);
    workerId = "w2";
    const before = structuredClone({ payments, entries });
    io.inventory.mockResolvedValue({ evidenceHash: "b".repeat(64), blocked: 0, rebinds: [] });
    expect(await load(which, approvalArgs())).toBeUndefined();
    expect(process.exit).toHaveBeenLastCalledWith(1);
    expect({ payments, entries }).toEqual(before);
  });
  it("rejects target/source contact disagreement rather than rebinding an unsafe identity", async () => {
    unsafe = true;
    const result = await load(which);
    expect(result.rejectGate.status).toBe("fail");
    expect(io.ea).not.toHaveBeenCalled();
  });
});
