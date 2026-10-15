import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const fake = vi.hoisted(() => ({
  execute: vi.fn(), updateEntry: vi.fn(), updatePayment: vi.fn(), ea: vi.fn(),
  suppress: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  transaction: vi.fn(), queries: [] as string[],
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({ execute: fake.execute }), runInTransaction: fake.transaction,
}));
vi.mock("../../server/storage/database", () => ({
  storage: { ledger: {
    ea: { getOrCreate: fake.ea }, entries: { update: fake.updateEntry },
    payments: { updateForMigration: fake.updatePayment },
  } },
}));
vi.mock("../../server/middleware/request-context", () => ({
  withNotificationsSuppressed: fake.suppress, withChargePluginsSuppressed: fake.suppress,
}));
vi.mock("../../scripts/s1-migration/lib/sync", () => ({
  canonicalJson: (v: unknown) => JSON.stringify(v),
}));
import { inventoryFinancialLinks, publicFinancialInventory } from "../../scripts/s1-migration/lib/financial-link-inventory";
import { repairFinancialLinks } from "../../scripts/s1-migration/lib/financial-link-repair";
import { loadFinancialSourceIndex, resolveFinancialPage } from "../../scripts/s1-migration/lib/financial-identity";
import { authorizeFinancialSyncLinks, isApprovedFinancialRebind } from "../../scripts/s1-migration/lib/financial-sync-approval";

type Ea = { id: string; entityType: string; entityId: string; accountId: string };
type Entry = { id: string; amount: string; ea_id: string; reference_type: string; reference_id: string;
  memo: string; statement_ymd: string; charge_plugin: string; charge_plugin_key: string; data: Record<string, unknown> };
type Payment = { id: string; amount: string; ledger_ea_id: string; allocated: boolean; status: string; memo: string; details: Record<string, unknown> };
let workers: Array<{ id: string; contactId: string }>;
let sourceWorkers: Array<{ nid: number; fields: Record<string, unknown> }>;
let mappings: Array<{ entity: string; s1_id: string; s2_id: string; s1_deleted_at: null; stub: boolean; loader: string }>;
let eas: Ea[], entries: Entry[], payments: Payment[];
let stagedAr: Array<{ nid: string; participant: string; account: string; snapshot: Record<string, unknown> }>;
let stagedPayments: Array<{ nid: string; fields: Record<string, unknown>; snapshot: Record<string, unknown> }>;
const dialect = new PgDialect();
const checkpoint = "fixture-common-snapshot";
const copy = <T,>(v: T): T => structuredClone(v);
const eaOf = (id: string) => eas.find((e) => e.id === id)!;
const target = (row: Entry | Payment, stream: "ar" | "payment") => {
  const ar = stream === "ar";
  const nid = String(ar ? (row as Entry).data.s1LedgerId : (row as Payment).details.s1Nid);
  const eaId = ar ? (row as Entry).ea_id : (row as Payment).ledger_ea_id;
  return { ...eaOf(eaId), id: row.id, eaId, nid, snapshot: copy(row), ea: copy(eaOf(eaId)),
    mappedId: row.id, mapping: { entity: ar ? "ledger-ar" : "payment", s2_id: row.id }, owned: true };
};
beforeEach(() => {
  vi.clearAllMocks();
  fake.queries = [];
  workers = [{ id: "w1", contactId: "c1" }, { id: "w2", contactId: "c2" }];
  sourceWorkers = [
    { nid: 101, fields: { field_sirius_contact: [{ target_id: 11 }] } },
    { nid: 102, fields: { field_sirius_contact: "12" } },
  ];
  mappings = [
    ["worker", 101, "w1"], ["worker", 102, "w2"], ["contact", 11, "c1"],
    ["contact", 12, "c2"], ["employer", 201, "employer"], ["ledger-account", 301, "fund"],
  ].map(([entity, nid, id]) => ({
    entity: String(entity), s1_id: String(nid), s2_id: String(id), s1_deleted_at: null, stub: false, loader: "fixture",
  }));
  eas = [
    { id: "contact-ea", entityType: "contact", entityId: "c1", accountId: "fund" },
    { id: "w1-ea", entityType: "worker", entityId: "w1", accountId: "fund" },
    { id: "w2-ea", entityType: "worker", entityId: "w2", accountId: "fund" },
    { id: "employer-ea", entityType: "employer", entityId: "employer", accountId: "fund" },
  ];
  entries = [
    { id: "ar1", amount: "-10.00", ea_id: "contact-ea", reference_type: "payment", reference_id: "p1",
      memo: "operator annotation", statement_ymd: "2026-01-01", charge_plugin: "s1-import", charge_plugin_key: "ar-1",
      data: { source: "s1-migration", s1LedgerId: 1, s1ReferenceNid: 1001 } },
    // Beneficiary w2 is intentionally different from payment payer w1.
    { id: "ar2", amount: "10.00", ea_id: "w2-ea", reference_type: "hour", reference_id: "hours1",
      memo: "keep", statement_ymd: "2026-01-01", charge_plugin: "s1-import", charge_plugin_key: "ar-2",
      data: { source: "s1-migration", s1LedgerId: 2, s1ReferenceNid: 2001 } },
    { id: "native", amount: "4.32", ea_id: "contact-ea", reference_type: "payment", reference_id: "native-payment",
      memo: "native", statement_ymd: "2026-02-01", charge_plugin: "native", charge_plugin_key: "native",
      data: {} },
  ];
  payments = [
    { id: "p1", amount: "10.00", ledger_ea_id: "contact-ea", allocated: true, status: "cleared", memo: "payer note",
      details: { source: "s1-migration", s1Nid: 1001, s1CheckNumber: "fixture" } },
    { id: "p2", amount: "5.00", ledger_ea_id: "employer-ea", allocated: true, status: "cleared", memo: "employer note",
      details: { source: "s1-migration", s1Nid: 1002 } },
  ];
  stagedAr = [11, 12].map((participant, i) => ({
    nid: String(i + 1), participant: String(participant), account: "301",
    snapshot: { ledger_id: i + 1, ledger_amount: i === 0 ? "-10.00" : "10.00", content_hash: "unchanged-financial-source" },
  }));
  stagedPayments = [11, 201].map((payer, i) => {
    const fields = { field_sirius_payer: { target_id: payer }, field_sirius_ledger_account: 301,
      field_sirius_dollar_amt: { value: i === 0 ? "10.00" : "5.00" } };
    return { nid: String(1001 + i), fields, snapshot: { nid: 1001 + i, fields, content_hash: "unchanged-payment" } };
  });
  fake.execute.mockImplementation(async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    const text = sql.replace(/\s+/g, " ").trim();
    fake.queries.push(text);
    const rows = (() => {
      if (/^(SET|LOCK)/.test(text)) return [];
      if (text.includes("jsonb_build_object")) return sourceWorkers;
      if (text.includes("SELECT entity, s1_id")) return mappings.filter((m) => m.entity !== "ledger-account" && params.includes(Number(m.s1_id)));
      if (text.includes("SELECT s1_id, s2_id, to_jsonb(m)")) return mappings
        .filter((m) => params.includes(m.entity) && params.includes(Number(m.s1_id)))
        .map((m) => ({ ...m, snapshot: copy(m) }));
      if (text.includes('contact_id AS "contactId"')) return workers.filter((w) => params.includes(w.id) || params.includes(w.contactId));
      if (text.startsWith("SELECT id FROM contacts")) return ["c1", "c2"].filter((id) => params.includes(id)).map((id) => ({ id }));
      if (text.startsWith("SELECT id FROM employers")) return params.includes("employer") ? [{ id: "employer" }] : [];
      if (text.includes("ledger_participant AS participant")) return stagedAr.filter((r) => Number(r.nid) > Number(params[0]));
      if (text.includes("SELECT nid, fields, to_jsonb(r)")) return stagedPayments.filter((r) => Number(r.nid) > Number(params[0]));
      if (text.includes("to_jsonb(a) AS target")) return [{ s1_id: "301", s2_id: "fund", snapshot: { entity: "ledger-account", s1_id: 301, s2_id: "fund" }, target: { id: "fund" } }];
      if (text.includes(" AS canonical_ea")) return eas.filter((ea) => params.includes(ea.entityId) && params.includes(ea.accountId))
        .map((ea) => ({ canonical_ea: copy(ea) }));
      if (text.includes("substring(l.charge_plugin_key from 4) AS nid")) return entries.filter((e) => e.charge_plugin === "s1-import").map((e) => target(e, "ar"));
      if (text.includes("p.details->>'s1Nid' AS nid")) return payments.map((p) => target(p, "payment"));
      if (text.includes("'ar' AS stream")) return [
        { stream: "ar", account_id: "fund", n: "3", amount_total: "4.32" },
        { stream: "payment", account_id: "fund", n: "2", amount_total: "15.00" },
      ];
      if (text.startsWith("SELECT id,") && text.includes(" AS facts")) {
        if (text.includes('FROM "ledger_ea"')) return eas.map((ea) => ({ id: ea.id, facts: copy(ea) }));
        const isPayment = text.includes('FROM "ledger_payments"');
        return (isPayment ? payments : entries).map((row) => {
          const facts = copy(row) as Record<string, unknown>;
          return { id: row.id, facts };
        });
      }
      throw new Error(`Unhandled fixture SQL: ${text}`);
    })();
    return { rows: copy(rows) };
  });
  fake.transaction.mockImplementation(async (fn: () => Promise<unknown>) => {
    const before = copy({ entries, payments, eas });
    try { return await fn(); } catch (e) {
      entries = before.entries; payments = before.payments; eas = before.eas; throw e;
    }
  });
  fake.ea.mockImplementation(async (type: string, id: string, account: string) => {
    const ea = eas.find((e) => e.entityType === type && e.entityId === id && e.accountId === account);
    if (!ea) throw new Error("Fixture EA missing");
    return ea;
  });
  fake.updateEntry.mockImplementation(async (id: string, patch: { eaId: string }) => {
    const entry = entries.find((e) => e.id === id)!;
    entry.ea_id = patch.eaId;
    return entry;
  });
  fake.updatePayment.mockImplementation(async (id: string, patch: { ledgerEaId: string }) => {
    const payment = payments.find((e) => e.id === id)!;
    payment.ledger_ea_id = patch.ledgerEaId;
    return payment;
  });
});

describe("read-only source-shaped financial inventory and approved link-only repair", () => {
  it("finds exact contact-worker payer and participant mismatches across accounts without mutation", async () => {
    const before = copy({ entries, payments, eas });
    const result = await repairFinancialLinks({ wet: false, checkpoint });
    expect(result.mismatched).toBe(2);
    expect(result.blocked).toBe(0);
    expect(result.counts.attribution_mismatches).toBe(4);
    expect(result.counts.payment_employer).toBe(1);
    expect({ entries, payments, eas }).toEqual(before);
    expect(fake.ea).not.toHaveBeenCalled();
    expect(fake.updateEntry).not.toHaveBeenCalled();
    expect(fake.queries[0]).toContain("READ ONLY");
    expect(JSON.stringify(result)).not.toMatch(/"c1"|"w1"|payer note|operator annotation|"p1"/);
  });
  it("repairs in place, preserves references/annotations/allocation/native activity, and is idempotent", async () => {
    const before = copy({ entries, payments, eas });
    const dry = await repairFinancialLinks({ wet: false, checkpoint });
    const wet = await repairFinancialLinks({ wet: true, checkpoint, approval: dry.evidenceHash });
    expect(wet).toMatchObject({ rebound: 2, mismatched: 0, financialFactsUnchanged: true });
    expect(entries[0]).toEqual({ ...before.entries[0], ea_id: "w1-ea" });
    expect(payments[0]).toEqual({ ...before.payments[0], ledger_ea_id: "w1-ea" });
    expect(entries.slice(1)).toEqual(before.entries.slice(1));
    expect(payments[1]).toEqual(before.payments[1]);
    expect(eas).toEqual(before.eas);
    expect(fake.updateEntry).toHaveBeenCalledWith("ar1", { eaId: "w1-ea" });
    expect(fake.updatePayment).toHaveBeenCalledWith("p1", { ledgerEaId: "w1-ea" });
    expect(fake.suppress).toHaveBeenCalled();
    const again = await repairFinancialLinks({ wet: false, checkpoint });
    expect(await repairFinancialLinks({ wet: true, checkpoint, approval: again.evidenceHash })).toMatchObject({ rebound: 0 });
    expect(fake.queries.some((q) => q.startsWith("LOCK TABLE ledger,"))).toBe(true);
    // Existing worker paths discover worker-owned EAs; no contact-access grant.
    expect(eas.filter((ea) => ea.entityType === "worker" && ea.entityId === "w1").map((ea) =>
      entries.filter((e) => e.ea_id === ea.id).map((e) => e.id)).flat()).toEqual(["ar1"]);
  });
  it("refuses approval when financial source, exact mapping, target annotation or checkpoint changed", async () => {
    const dry = await repairFinancialLinks({ wet: false, checkpoint });
    payments[0].memo = "new annotation";
    await expect(repairFinancialLinks({ wet: true, checkpoint, approval: dry.evidenceHash })).rejects.toThrow("Evidence changed");
    expect(fake.updateEntry).not.toHaveBeenCalled();
    expect((await inventoryFinancialLinks("different-checkpoint")).evidenceHash).not.toBe(dry.evidenceHash);
  });
  it("detects source-unchanged identity changes and stale destination contacts", async () => {
    const first = await inventoryFinancialLinks(checkpoint);
    mappings.find((m) => m.entity === "worker" && m.s1_id === "101")!.s2_id = "w2";
    const changed = await inventoryFinancialLinks(checkpoint);
    expect(changed.evidenceHash).not.toBe(first.evidenceHash);
    expect(changed.blocked).toBe(2);
    expect(changed.counts.ar_worker_contact_disagreement).toBe(1);
    const source = await loadFinancialSourceIndex();
    const page = await resolveFinancialPage([11], source);
    expect(page.decisions.get(11)).toEqual({ ok: false, reason: "worker_contact_disagreement" });
  });
  it("resolves a fresh load and later valid dependency changes independently for each source relationship", async () => {
    const source = await loadFinancialSourceIndex();
    const page = await resolveFinancialPage([11, 201, 101, 12], source);
    expect(page.decisions.get(11)).toMatchObject({ ok: true, entity: { entityType: "worker", entityId: "w1" } });
    expect(page.decisions.get(201)).toMatchObject({ ok: true, entity: { entityType: "employer", entityId: "employer" } });
    expect(page.decisions.get(101)).toMatchObject({ ok: true, entity: { entityId: "w1" } });
    expect(page.decisions.get(12)).toMatchObject({ ok: true, entity: { entityId: "w2" } });
    await resolveFinancialPage([11, 12], source);
    expect(fake.queries.filter((q) => q.includes("jsonb_build_object"))).toHaveLength(1);
    const before = await inventoryFinancialLinks(checkpoint);
    mappings.find((m) => m.entity === "worker" && m.s1_id === "101")!.s2_id = "new-exact-worker";
    workers[0].contactId = "no-longer-this-contact";
    workers.push({ id: "new-exact-worker", contactId: "c1" });
    const changed = await inventoryFinancialLinks(checkpoint);
    expect(changed.blocked).toBe(0);
    expect(changed.evidenceHash).not.toBe(before.evidenceHash);
    expect(changed.rebinds.filter((r) => r.entity.entityId === "new-exact-worker")).toHaveLength(2);
    // Source financial fingerprints and transaction beneficiaries never changed.
    expect(stagedAr[0].snapshot.content_hash).toBe("unchanged-financial-source");
    expect(entries[1].ea_id).toBe("w2-ea");
  });
  it("keeps dependency reads bounded and never scans the worker bundle per financial page", async () => {
    const source = await loadFinancialSourceIndex();
    for (let page = 0; page < 3; page++) {
      await resolveFinancialPage(Array.from({ length: 2000 }, (_, i) => 10_000 + i), source);
    }
    expect(fake.queries.filter((q) => q.includes("jsonb_build_object"))).toHaveLength(1);
    const mappingQueries = fake.execute.mock.calls.map(([q]) => dialect.sqlToQuery(q))
      .filter((q) => q.sql.includes("SELECT entity, s1_id"));
    expect(mappingQueries).toHaveLength(12);
    expect(mappingQueries.every((q) => q.params.length <= 500)).toBe(true);
  });
  it("refuses an unsafe plan, even with its exact hash approved", async () => {
    workers[0].contactId = "c2";
    const dry = await repairFinancialLinks({ wet: false, checkpoint });
    await expect(repairFinancialLinks({ wet: true, checkpoint, approval: dry.evidenceHash })).rejects.toThrow("Unsafe identities");
    expect(fake.ea).not.toHaveBeenCalled();
  });
  it("allows normal source-unchanged reconciliation only for exact, reviewed stream coordinates", async () => {
    expect(await authorizeFinancialSyncLinks("payment", [])).toEqual(new Map());
    const dry = await repairFinancialLinks({ wet: false, checkpoint, stream: "payment" });
    const argv = ["--approve-financial-links", dry.evidenceHash, "--financial-links-checkpoint", checkpoint];
    const approved = await authorizeFinancialSyncLinks("payment", argv);
    const entity = { entityType: "worker" as const, entityId: "w1", via: "contact-worker" as const };
    expect(isApprovedFinancialRebind(approved, "p1", "contact-ea", entity, "fund")).toBe(true);
    expect(isApprovedFinancialRebind(approved, "p1", "another-ea", entity, "fund")).toBe(false);
    expect(isApprovedFinancialRebind(approved, "p1", "contact-ea", { ...entity, entityId: "w2" }, "fund")).toBe(false);
    expect(isApprovedFinancialRebind(approved, "native", "contact-ea", entity, "fund")).toBe(false);
    await expect(authorizeFinancialSyncLinks("ar", argv)).rejects.toThrow("evidence changed");
    payments[0].amount = "11.00";
    await expect(authorizeFinancialSyncLinks("payment", argv)).rejects.toThrow("evidence changed");
  });
  it("rolls back all link changes when storage changes financial facts or native activity", async () => {
    const before = copy({ entries, payments });
    const dry = await repairFinancialLinks({ wet: false, checkpoint });
    fake.updateEntry.mockImplementation(async (id: string) => {
      const row = entries.find((e) => e.id === id)!;
      row.ea_id = "w1-ea"; row.reference_id = "unacceptable";
      return row;
    });
    await expect(repairFinancialLinks({ wet: true, checkpoint, approval: dry.evidenceHash })).rejects.toThrow("Financial facts");
    expect({ entries, payments }).toEqual(before);
  });
  it("rejects wrong-worker attribution with equal fund totals, including unchanged financial rows", async () => {
    entries[0].ea_id = "w2-ea";
    payments[0].ledger_ea_id = "w2-ea";
    const result = await inventoryFinancialLinks(checkpoint);
    expect(result.mismatched).toBe(2);
    expect(result.counts.attribution_mismatches).toBeGreaterThan(0);
    expect(publicFinancialInventory(result)).not.toHaveProperty("rebinds");
  });
  it("distinguishes missing staged-to-target rows from identity defects", async () => {
    payments.splice(0, 1);
    const result = await inventoryFinancialLinks(checkpoint);
    expect(result.counts.payment_missing_target).toBe(1);
    expect(result.blocked).toBe(0);
    expect(result.mismatched).toBe(1);
  });
});
