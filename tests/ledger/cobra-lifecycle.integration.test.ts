import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDatabaseUrlOptional } from "@shared/database-url";

// Real PostgreSQL integration in a disposable schema, NEVER fixture writes to
// public tables. It runs when a workspace DB is available; CI without a DB
// explicitly skips this file rather than substituting an in-memory database.
const fixture = vi.hoisted(() => ({
  pool: null as any, schema: "", storage: {} as any, plugin: null as any,
  errors: [] as unknown[],
}));
vi.mock("../../server/storage/db", async () => {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { resolveDatabaseUrlOptional } = await import("@shared/database-url");
  const url = resolveDatabaseUrlOptional();
  if (!url) return { db: null };
  fixture.schema = `cobra_test_${crypto.randomUUID().replaceAll("-", "")}`;
  fixture.pool = new pg.Pool({
    connectionString: url.url,
    options: `-c search_path=${fixture.schema}`,
    max: 5,
  });
  return { db: drizzle(fixture.pool) };
});
vi.mock("../../server/storage/database", () => ({ storage: fixture.storage }));
vi.mock("../../server/storage", () => ({ storage: fixture.storage }));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => fixture.errors.push(args) },
  storageLogger: { log: vi.fn() },
}));
vi.mock("../../server/storage/utils", () => ({ tableExists: async () => true }));
vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true, isComponentEnabledSync: () => true,
}));
vi.mock("../../server/plugins/ledger/charge/registry", () => ({
  registerChargePlugin: (plugin: unknown) => { fixture.plugin = plugin; },
  getEnabledChargePluginsByTrigger: async () => [], getAllEnabledChargePlugins: async () => [],
}));
vi.mock("../../server/plugins/trust/eligibility/registry", () => ({
  eligibilityPluginRegistry: { getAll: () => [] },
}));
vi.mock("../../server/storage/trust/worker-benefit-role-history-invalidation", () => ({
  enqueueWorkerBenefitRoleHistoryInvalidations: async () => {},
}));
const statuses = [
  { id: "new", name: "New", closed: false },
  { id: "pending", name: "Pending First Payment", closed: false },
  { id: "enrolled", name: "Enrolled", closed: false },
  { id: "delinquent", name: "Delinquent", closed: false },
  { id: "closed", name: "Closed", closed: true },
];
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({
    list: async () => statuses,
    get: async () => ({ id: "credit", direction: "credit", name: "Payment", currencyCode: "USD" }),
  }),
}));

describe.skipIf(!resolveDatabaseUrlOptional())("COBRA committed allocation lifecycle (PostgreSQL)", () => {
  let tx: typeof import("../../server/storage/transaction-context");
  let lifecycle: typeof import("../../server/services/bao-cobra-lifecycle");
  let createLedgerEntries: typeof import("../../server/plugins/ledger/charge/executor").createLedgerEntries;
  let bus: typeof import("../../server/services/event-bus");
  let createWorkerBenefit: ReturnType<typeof import("../../server/storage/trust/wmb").createTrustWmbStorage>["createWorkerBenefit"];
  const events: unknown[] = [];
  const tables = [
    "ledger_ea", "ledger", "ledger_payments", "options_ledger_payment_type",
    "sitespecific_bao_cobra_cases", "options_bao_cobra_status", "options_bao_cobra_qualifying_event",
    "workers", "contacts", "trust_benefits", "trust_wmb", "options_trust_benefit_type",
  ];
  const state = async () => (await fixture.pool.query(
    "SELECT status_id,payment_status FROM sitespecific_bao_cobra_cases WHERE id='case'",
  )).rows[0];
  async function settled(status: string) {
    await vi.waitFor(async () => expect((await state()).status_id).toBe(status), { timeout: 4000 });
  }
  const allocationContext = (status = "cleared", amount = "100.00", ym = "2026-01-01") => ({
    trigger: "payment_saved", paymentId: "payment", amount, status,
    ledgerEaId: "ea", accountId: "cobra", entityType: "worker", entityId: "worker",
    paymentTypeId: "credit", allocationId: `ea:${ym}`, allocationStatementYmd: ym,
    dateReceived: new Date("2026-01-15T12:00:00Z"),
  });
  async function postAllocation(status = "cleared", amount = "100.00", ym = "2026-01-01") {
    const result = await fixture.plugin.execute(allocationContext(status, amount, ym), {
      id: "allocation-config", account: "cobra", settings: {},
    });
    expect(result.success, result.error).toBe(true);
    await createLedgerEntries(result.transactions, true);
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    tx = await import("../../server/storage/transaction-context");
    const { createBaoCobraCasesStorage } = await import("../../server/storage/sitespecific/bao/cobra-cases");
    const { createLedgerEntryStorage, createLedgerEaStorage, createLedgerPaymentStorage } = await import("../../server/storage/ledger");
    const { getClient } = tx;
    const { sql } = await import("drizzle-orm");
    await fixture.pool.query(`CREATE SCHEMA "${fixture.schema}"`);
    for (const table of tables) await fixture.pool.query(
      `CREATE TABLE "${fixture.schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`,
    );
    fixture.storage.baoCobraCases = createBaoCobraCasesStorage();
    fixture.storage.ledger = {
      entries: createLedgerEntryStorage(), ea: createLedgerEaStorage(), payments: createLedgerPaymentStorage(),
    };
    fixture.storage.pluginConfigs = { search: async () => [{
      config: { id: "premium-config", pluginId: "sitespecific-bao-cobra", enabled: true },
      subsidiary: { account: "cobra", scope: "global" },
    }] };
    fixture.storage.workerTrustElections = { listByWorker: async () => [{
      id: "election", enrollmentType: "cobra", benefitIds: ["medical"],
      data: { cobraCaseId: "case" }, startYmd: "2026-01-01",
    }] };
    // The seed is deliberately a posted case premium, never a fake zero net.
    bus = await import("../../server/services/event-bus");
    bus.eventBus.on({ name: "cobra-test-observer", description: "Fixture event observer",
      event: bus.EventType.LEDGER_ENTRY_SAVED, handler: async (payload) => { events.push(payload); } });
    lifecycle = await import("../../server/services/bao-cobra-lifecycle");
    lifecycle.initBaoCobraLifecycle();
    const { initBaoCobraAutoCase } = await import("../../server/services/bao-cobra-auto-case");
    initBaoCobraAutoCase();
    const { createTrustWmbStorage } = await import("../../server/storage/trust/wmb");
    createWorkerBenefit = createTrustWmbStorage().createWorkerBenefit;
    await import("../../server/plugins/ledger/charge/plugins/paymentSimpleAllocation");
    ({ createLedgerEntries } = await import("../../server/plugins/ledger/charge/executor"));
    // Make sure the actual ambient client and fixture pool share one schema.
    const identity = await getClient().execute(sql`SELECT current_schema() AS name`);
    expect(identity.rows[0].name).toBe(fixture.schema);
  });
  beforeEach(async () => {
    // Drain any case-save no-change feedback before truncating the fixture.
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const table of tables) await fixture.pool.query(`TRUNCATE "${table}"`);
    await fixture.pool.query("INSERT INTO options_bao_cobra_status (id,name,closed) VALUES ('new','New',false),('pending','Pending First Payment',false),('enrolled','Enrolled',false),('delinquent','Delinquent',false),('closed','Closed',true)");
    await fixture.pool.query("INSERT INTO options_ledger_payment_type (id,name,direction,currency_code) VALUES ('credit','Payment','credit','USD')");
    await fixture.pool.query("INSERT INTO ledger_ea (id,account_id,entity_type,entity_id) VALUES ('ea','cobra','worker','worker')");
    await fixture.pool.query("INSERT INTO sitespecific_bao_cobra_cases (id,source,status_id,covered_person_worker_id,subscriber_worker_id,cobra_effective_ymd,election_made_ymd,initial_payment_deadline_ymd,max_period_ymd) VALUES ('case','manual','pending','worker','worker','2026-01-01','2026-01-01','2026-02-15','2099-01-01')");
    await fixture.pool.query("INSERT INTO ledger_payments (id,status,allocated,amount,payment_type,ledger_ea_id) VALUES ('payment','cleared',true,100,'credit','ea')");
    await fixture.pool.query("INSERT INTO ledger (charge_plugin,charge_plugin_key,charge_plugin_config_id,amount,ea_id,reference_type,reference_id,statement_ymd) VALUES ('sitespecific-bao-cobra','premium','premium-config',100,'ea','cobra_case','case','2026-01-01')");
    events.length = 0;
    fixture.errors.length = 0;
  });
  afterAll(async () => {
    vi.useRealTimers();
    if (!fixture.pool) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { await fixture.pool.query(`DROP SCHEMA IF EXISTS "${fixture.schema}" CASCADE`); }
    finally { await fixture.pool.end(); }
  });

  it("posts through the real allocation plugin/executor/storage, then enrolls after commit", async () => {
    await tx.runInTransaction(async () => {
      await postAllocation();
      expect(events).toHaveLength(0);
      const current = await fixture.storage.baoCobraCases.getRaw("case");
      expect(current.statusId).toBe("pending");
    });
    await settled("enrolled");
    expect((await state()).payment_status).toBe("paid");
    expect(events).toHaveLength(1);
    await bus.eventBus.emit(bus.EventType.LEDGER_ENTRY_SAVED, events[0] as any);
    expect((await lifecycle.reconcileCobraCaseStatus("case", { mode: "live" })).changes).toEqual({});
    expect(fixture.errors).toEqual([]);
  });
  it("does not emit or enroll for a rolled-back allocation", async () => {
    await expect(tx.runInTransaction(async () => {
      await postAllocation();
      throw new Error("rollback fixture");
    })).rejects.toThrow("rollback fixture");
    expect(events).toHaveLength(0);
    expect((await state()).status_id).toBe("pending");
    expect((await fixture.storage.ledger.entries.getByReference("payment", "payment"))).toHaveLength(0);
  });
  it.each(["pending", "error", "canceled"])("does not enroll %s funds", async (status) => {
    await fixture.pool.query("UPDATE ledger_payments SET status=$1", [status]);
    await tx.runInTransaction(() => postAllocation(status));
    expect(events).toHaveLength(0);
    expect((await lifecycle.reconcileCobraCaseStatus("case")).changes.statusId).not.toBe("enrolled");
  });
  it("refuses insufficient payments and unallocated or stale-cleared-looking ledger evidence", async () => {
    await tx.runInTransaction(() => postAllocation("cleared", "99.00"));
    await settled("delinquent");
    await fixture.pool.query("UPDATE ledger_payments SET status='pending'");
    expect((await fixture.storage.ledger.entries.getCobraLifecycleEvidence("worker", "cobra", "case"))[0].paymentCents).toBe(0);
    await fixture.pool.query("UPDATE ledger_payments SET status='cleared'");
    await fixture.pool.query("UPDATE ledger SET data='{}' WHERE reference_type='payment'");
    expect((await fixture.storage.ledger.entries.getCobraLifecycleEvidence("worker", "cobra", "case"))[0].paymentCents).toBe(0);
  });
  it("scan recovery repairs a deliberately missed event without financial mutation", async () => {
    await fixture.pool.query("INSERT INTO ledger (charge_plugin,charge_plugin_key,amount,ea_id,reference_type,reference_id,statement_ymd,data) VALUES ('payment-simple-allocation','missed',-100,'ea','payment','payment','2026-01-01','{\"allocationId\":\"ea:2026-01-01\"}')");
    const before = (await fixture.pool.query("SELECT * FROM ledger ORDER BY id")).rows;
    const dry = await lifecycle.scanCobraCaseStatuses("test");
    expect(dry.results[0]).toMatchObject({ applied: false, changes: { statusId: "enrolled" } });
    expect((await state()).status_id).toBe("pending");
    await lifecycle.scanCobraCaseStatuses("live");
    await settled("enrolled");
    expect((await fixture.pool.query("SELECT * FROM ledger ORDER BY id")).rows).toEqual(before);
  });
  it("does not enroll a zero-balance account settled by an unrelated credit", async () => {
    await fixture.pool.query("INSERT INTO ledger (charge_plugin,charge_plugin_key,amount,ea_id,statement_ymd) VALUES ('manual','unrelated-credit',-100,'ea','2026-01-01')");
    const evidence = await fixture.storage.ledger.entries.getCobraLifecycleEvidence("worker", "cobra", "case");
    expect(evidence).toEqual([{ ym: "2026-01", caseChargeCents: 10000, paymentCents: 0, hasOtherObligation: false }]);
    expect((await lifecycle.reconcileCobraCaseStatus("case", { mode: "live" })).targetStatusName).toBe("Delinquent");
    expect((await state()).status_id).not.toBe("enrolled");
  });
  it("re-evaluates case election removal without retaining paid state", async () => {
    await tx.runInTransaction(() => postAllocation());
    await settled("enrolled");
    await tx.runInTransaction(() => fixture.storage.baoCobraCases.update("case", { electionMadeYmd: null }));
    await settled("new");
    expect((await state()).payment_status).toBeNull();
  });
  it("cannot reuse a closed case's paid statement allocation for another unpaid case", async () => {
    // The statement has $200 premiums and $100 allocated payment. Only the
    // prior, now-closed case was paid. Allocations carry no case ID, so the
    // safe answer for the new case is a visible blocker, never Enrolled.
    await fixture.pool.query("INSERT INTO sitespecific_bao_cobra_cases (id,source,status_id,covered_person_worker_id,subscriber_worker_id,cobra_effective_ymd,election_made_ymd,initial_payment_deadline_ymd,max_period_ymd) VALUES ('old-case','manual','closed','worker','worker','2026-01-01','2026-01-01','2026-02-15','2099-01-01')");
    await fixture.pool.query("INSERT INTO ledger (charge_plugin,charge_plugin_key,charge_plugin_config_id,amount,ea_id,reference_type,reference_id,statement_ymd) VALUES ('sitespecific-bao-cobra','old-premium','premium-config',100,'ea','cobra_case','old-case','2026-01-01')");
    await tx.runInTransaction(() => postAllocation());
    await vi.waitFor(async () => expect(fixture.errors.length).toBeGreaterThan(0));
    const preview = await lifecycle.reconcileCobraCaseStatus("case");
    expect(preview.blockers.join()).toMatch(/attribution is ambiguous/);
    const live = await lifecycle.reconcileCobraCaseStatus("case", { mode: "live" });
    expect(live.applied).toBe(false);
    expect(live.changes).toEqual({});
    expect((await state()).status_id).toBe("pending");
    expect((await state()).payment_status).toBeNull();
    // The shared recovery scan must make the same refusal.
    const scan = await lifecycle.scanCobraCaseStatuses("live");
    expect(scan.results.find((r) => r.caseId === "case")?.blockers.join()).toMatch(/attribution is ambiguous/);
  });
  it("refuses an unrelated cleared allocation when the month also contains a different obligation", async () => {
    await fixture.pool.query("INSERT INTO ledger (charge_plugin,charge_plugin_key,amount,ea_id,reference_type,reference_id,statement_ymd) VALUES ('manual','other-obligation',100,'ea','other','other-record','2026-01-01')");
    await tx.runInTransaction(() => postAllocation());
    const report = await lifecycle.reconcileCobraCaseStatus("case", { mode: "live" });
    expect(report.blockers.join()).toMatch(/attribution is ambiguous/);
    expect(report.changes).toEqual({});
    expect((await state()).status_id).toBe("pending");
  });
  it("deletion/reversal and statement-coordinate moves update the affected case", async () => {
    await tx.runInTransaction(() => postAllocation());
    await settled("enrolled");
    const [entry] = await fixture.storage.ledger.entries.getByReference("payment", "payment");
    await tx.runInTransaction(() => fixture.storage.ledger.entries.update(entry.id, { statementYmd: "2026-02-01" }));
    await settled("delinquent");
    await tx.runInTransaction(() => fixture.storage.ledger.entries.update(entry.id, { statementYmd: "2026-01-01" }));
    await settled("enrolled");
    await tx.runInTransaction(() => fixture.storage.ledger.payments.delete("payment"));
    await settled("delinquent");
  });
  it("cannot overwrite a concurrent staff closure from a stale pre-lock read", async () => {
    const client = await fixture.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE sitespecific_bao_cobra_cases SET status_id='closed' WHERE id='case'");
      const waiting = lifecycle.reconcileCobraCaseStatus("case", { mode: "live" });
      // Give FOR UPDATE a chance to wait on the staff transaction.
      await new Promise((resolve) => setTimeout(resolve, 40));
      await client.query("COMMIT");
      expect((await waiting).changes).toEqual({});
      expect((await state()).status_id).toBe("closed");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("closes an unelected case after a current-month benefit creation commits", async () => {
    await fixture.pool.query("UPDATE sitespecific_bao_cobra_cases SET election_made_ymd=NULL,status_id='new'");
    await fixture.pool.query("INSERT INTO trust_benefits (id,name) VALUES ('medical','Medical')");
    await tx.runInTransaction(async () => {
      await createWorkerBenefit({
        workerId: "worker", employerId: "employer", benefitId: "medical", month: 10, year: 2026,
      });
      // WMB storage has emitted its in-transaction event, but closure must
      // not query from another connection until this transaction commits.
      expect((await state()).status_id).toBe("new");
    });
    await settled("closed");
    expect(fixture.errors).toEqual([]);
  });
  it("does not close an unelected case for a benefit creation that rolls back", async () => {
    await fixture.pool.query("UPDATE sitespecific_bao_cobra_cases SET election_made_ymd=NULL,status_id='new'");
    await fixture.pool.query("INSERT INTO trust_benefits (id,name) VALUES ('medical','Medical')");
    await expect(tx.runInTransaction(async () => {
      await createWorkerBenefit({
        workerId: "worker", employerId: "employer", benefitId: "medical", month: 10, year: 2026,
      });
      throw new Error("rollback restored benefits");
    })).rejects.toThrow("rollback restored benefits");
    // No after-commit callback is released on rollback, nor can recovery find
    // restored benefits that do not exist.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await lifecycle.reconcileCobraCaseStatus("case", { mode: "live" })).changes).toEqual({});
    expect((await state()).status_id).toBe("new");
    expect((await fixture.pool.query("SELECT count(*) AS n FROM trust_wmb")).rows[0].n).toBe("0");
    expect(fixture.errors).toEqual([]);
  });
});
