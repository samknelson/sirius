import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCheckoutSelection, type CheckoutQuote } from "../../shared/ledger/checkout-selection";

// SQL-backed storage contract fixture. Production entry/invoice/balance storage
// executes its generated SQL here; only provider and plugin dispatch are stubbed.
const fixture = vi.hoisted(() => ({
  client: null as any, ledger: null as any, attempt: null as any,
  tables: {} as Record<string, Array<Record<string, any>>>, depth: 0, failCashPosting: false,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => fixture.client,
  onAfterCommit: vi.fn(),
  runInTransaction: async (fn: () => Promise<any>) => {
    if (fixture.depth) return fn();
    const before = structuredClone({ tables: fixture.tables, attempt: fixture.attempt });
    fixture.depth++;
    try { return await fn(); }
    catch (e) { fixture.tables = before.tables; fixture.attempt = before.attempt; throw e; }
    finally { fixture.depth--; }
  },
}));
vi.mock("../../server/services/event-bus", () => ({ eventBus: { emit: vi.fn() }, EventType: {} }));
vi.mock("../../server/storage", () => ({ storage: { get ledger() { return fixture.ledger; } } }));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: async () => [{ id: "financial", category: "financial", direction: "credit", currencyCode: "USD" }] }),
}));
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({ resolveGateway: vi.fn() }));
vi.mock("../../server/modules/ledger/payments", () => ({
  createPaymentFromRequestBody: async (body: any) => ({ ok: true, payment: { ...body, id: "posted-payment" } }),
  triggerPaymentChargePlugins: async (payment: any) => {
    if (fixture.failCashPosting) throw new Error("injected cash posting failure");
    for (const [index, allocation] of payment.details.proposedAllocation.entries()) {
      await fixture.ledger.entries.create({
        chargePlugin: "payment-simple-allocation", chargePluginKey: `${payment.id}:${index}`,
        eaId: allocation.eaId, amount: (-Number(allocation.amount)).toFixed(2),
        statementYmd: allocation.statementYmd, referenceType: "payment", referenceId: payment.id,
        date: new Date("2026-04-01T00:00:00Z"),
      });
    }
  },
}));

const { createLedgerStorage } = await import("../../server/storage/ledger");
const { settlePayment } = await import("../../server/modules/ledger/payment-settlement");

function sqlFixture() {
  return drizzle(async (rawSql, params) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    if (sql.endsWith("FOR UPDATE")) return { rows: [["ea"]] };
    if (sql.startsWith('insert into "ledger"')) {
      const columns = sql.match(/^insert into "ledger" \((.*?)\) values/)![1].split(", ").map(c => c.replaceAll('"', ""));
      const values = sql.match(/ values \((.*?)\) returning/)![1].split(", ");
      const row: Record<string, any> = Object.fromEntries(columns.map((column, index) => [
        column, values[index] === "default" ? null : params[Number(values[index].slice(1)) - 1],
      ]));
      row.id ??= `entry-${fixture.tables.ledger.length}`;
      if (fixture.tables.ledger.some(existing => existing.charge_plugin === row.charge_plugin && existing.charge_plugin_key === row.charge_plugin_key)) throw new Error("unique plugin key");
      fixture.tables.ledger.push(row);
      return { rows: [sql.split(" returning ")[1].split(", ").map(column => row[column.replaceAll('"', "")])] };
    }
    const table = sql.match(/from "([^"]+)"/)?.[1];
    if (!table || !fixture.tables[table]) throw new Error(`Unexpected SQL: ${sql}`);
    let rows = fixture.tables[table];
    if (table === "ledger" && sql.includes("sum(")) return { rows: [[rows.filter(r => r.ea_id === params[0]).reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)]] };
    const predicates = [...sql.matchAll(/"([^"]+)"\."([^"]+)" = \$(\d+)/g)];
    for (const [, predicateTable, column, parameter] of predicates) if (predicateTable === table) rows = rows.filter(row => row[column] === params[Number(parameter) - 1]);
    if (table === "ledger" && sql.includes("order by")) rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const selected = sql.slice(7, sql.indexOf(" from ")).split(", ").map(column => column.match(/"([^"]+)"$/)?.[1]);
    return { rows: rows.map(row => selected.map(column => column ? row[column] ?? null : null)) };
  });
}

async function quote(mode: "full" | "statements" = "full", invoiceNumbers: string[] = []) {
  return calculateCheckoutSelection({
    balance: await fixture.ledger.ea.getBalance("ea"),
    invoices: await fixture.ledger.invoices.listForEa("ea"),
    reserved: "0.00", reservations: [], allowPartial: true, minAmount: 1,
  }, { mode, invoiceNumbers });
}
function snapshot(quote: CheckoutQuote) {
  fixture.attempt = {
    id: "attempt", gatewayConfigId: "gateway", providerIntentRef: "ref", status: "processing",
    ledgerEaId: "ea", accountId: "account", amount: quote.amount, currency: "USD",
    statementSelection: quote.statementSelection,
    metadata: { checkoutQuote: quote, invoicePeriods: quote.invoicePeriods }, saveMethod: false,
  };
}
const settle = () => settlePayment("attempt", "gateway", {
  type: "payment.succeeded", providerRef: "ref", amountMinor: Math.round(Number(fixture.attempt.amount) * 100), currency: "USD",
});

beforeEach(async () => {
  fixture.failCashPosting = false;
  fixture.tables = {
    ledger: [], ledger_ea: [{ id: "ea", account_id: "account", entity_type: "worker", entity_id: "worker" }],
    ledger_accounts: [{ id: "account", name: "COBRA" }], workers: [{ id: "worker", sirius_id: 2163 }],
    ledger_payments: [],
  };
  fixture.client = sqlFixture();
  fixture.ledger = {
    ...createLedgerStorage(),
    paymentAttempts: {
      lockAttempt: async () => {}, lockEa: async () => {},
      get: async () => fixture.attempt,
      claimLedgerPosting: async (_id: string, paymentId: string) => {
        if (fixture.attempt.ledgerPaymentId) return false;
        fixture.attempt.ledgerPaymentId = paymentId; return true;
      },
      updateStatus: async (_id: string, status: string, fields: object) => Object.assign(fixture.attempt, fields, { status }),
    },
  };
  for (const [month, amount] of [[1, "100.00"], [2, "100.00"], [3, "-50.00"]] as const) {
    await fixture.ledger.entries.create({
      chargePlugin: "fixture", chargePluginKey: String(month), eaId: "ea", amount,
      statementYmd: `2026-0${month}-01`, date: new Date(`2026-0${month}-01T00:00:00Z`),
      referenceType: "charge",
    });
  }
});

describe("cross-period credit settlement against ledger storage", () => {
  it("full150 clears Jan100 Feb100 March-50, with zero account and invoice balances after replay", async () => {
    const preview = await quote();
    expect(preview.amount).toBe("150.00");
    expect(preview.creditAdjustment).toBe("50.00");
    expect(preview.issues).toEqual([]);
    snapshot(preview);
    await settle();
    await settle();
    const invoices = await fixture.ledger.invoices.listForEa("ea");
    expect(invoices.map((row: any) => row.invoiceBalance)).toEqual(["0.00", "0.00", "0.00"]);
    expect(await fixture.ledger.ea.getBalance("ea")).toBe("0.00");
    expect(fixture.tables.ledger).toHaveLength(7); // three originals, two transfer legs, two cash allocations
    expect((await quote()).amount).toBe("0.00");
    expect((await quote()).statements.every(row => row.payable === "0.00")).toBe(true);
  });
  it("selected January settles fully, explicitly consumes March credit, and leaves February untouched/payable", async () => {
    const preview = await quote("statements", ["2163-COBRA-202601"]);
    expect(preview.amount).toBe("50.00");
    snapshot(preview);
    await settle();
    const balances = Object.fromEntries((await fixture.ledger.invoices.listForEa("ea")).map((row: any) => [row.month, row.invoiceBalance]));
    expect(balances).toEqual({ 1: "0.00", 2: "100.00", 3: "0.00" });
    expect(await fixture.ledger.ea.getBalance("ea")).toBe("100.00");
    expect((await quote()).statementSelection).toEqual([{ invoiceNumber: "2163-COBRA-202602", amount: "100.00" }]);
    await fixture.ledger.entries.applyCheckoutCreditTransfers("attempt", "ea", preview.creditTransfers);
    expect(await fixture.ledger.ea.getBalance("ea")).toBe("100.00");
    expect(fixture.tables.ledger).toHaveLength(6);
  });
  it("rolls both credit legs back if cash posting fails and retries without duplicating attribution", async () => {
    snapshot(await quote());
    fixture.failCashPosting = true;
    await expect(settle()).rejects.toThrow("injected cash posting failure");
    expect(fixture.tables.ledger).toHaveLength(3);
    expect(fixture.attempt.ledgerPaymentId).toBeUndefined();
    expect(await fixture.ledger.ea.getBalance("ea")).toBe("150.00");
    fixture.failCashPosting = false;
    await settle();
    expect(await fixture.ledger.ea.getBalance("ea")).toBe("0.00");
  });

  it("attributes a fully credit-covered statement as well as the cash-paid remainder", async () => {
    await fixture.ledger.entries.create({
      chargePlugin: "fixture", chargePluginKey: "extra-credit", eaId: "ea", amount: "-100.00",
      statementYmd: "2026-03-01", date: new Date("2026-03-01T00:00:00Z"),
    });
    const preview = await quote();
    expect(preview.amount).toBe("50.00");
    expect(preview.creditAdjustment).toBe("150.00");
    expect(preview.statementSelection).toEqual([{ invoiceNumber: "2163-COBRA-202602", amount: "50.00" }]);
    snapshot(preview);
    await settle();
    expect((await fixture.ledger.invoices.listForEa("ea")).map((row: any) => row.invoiceBalance)).toEqual(["0.00", "0.00", "0.00"]);
    expect(await fixture.ledger.ea.getBalance("ea")).toBe("0.00");
  });

  it("refuses unavailable snapshotted credits instead of substituting a different source on delayed settlement", async () => {
    snapshot(await quote());
    await fixture.ledger.entries.create({
      chargePlugin: "fixture", chargePluginKey: "credit-correction", eaId: "ea", amount: "50.00",
      statementYmd: "2026-03-01", date: new Date("2026-03-01T00:00:00Z"),
    });
    await expect(settle()).rejects.toThrow("no longer available");
    expect(fixture.tables.ledger).toHaveLength(4);
    expect(fixture.attempt.ledgerPaymentId).toBeUndefined();
    expect((await fixture.ledger.invoices.listForEa("ea")).map((row: any) => row.invoiceBalance)).toEqual(["0.00", "100.00", "100.00"]);
  });
});