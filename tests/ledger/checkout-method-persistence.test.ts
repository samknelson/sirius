import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, SQL, sql } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  entityMetadata, ledgerPaymentMethods, ledgerPaymentAttempts, ledgerGatewayCustomers,
  ledgerPaymentAttemptEvents, ledgerEa, ledgerPayments,
} from "@shared/schema";
import { CHECKOUT_SAVE_METHOD_CONSENT } from "@shared/ledger/checkout-save-consent";

// A disposable PostgreSQL cluster; no application DB, credentials or external
// provider. The Stripe SDK boundary returns realistic test-only objects.
const state = vi.hoisted(() => ({
  db: null as any, als: null as any, storage: null as any, gateway: null as any,
  intent: null as any, failSaveStamp: false, failAllocation: false, customerCreates: 0, creates: [] as any[],
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.als.getStore() ?? state.db,
  runInTransaction: (fn: () => Promise<unknown>) => state.als.getStore() ? fn()
    : state.db.transaction((tx: any) => state.als.run(tx, fn)),
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ get storage() { return state.storage; } }));
vi.mock("../../server/logger", () => ({ storageLogger: { error: vi.fn() } }));
vi.mock("../../server/storage/middleware/logging", () => ({ defineLoggingConfig: (v: unknown) => v }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: async (req: any, _policy: string, id: string) => ({ granted: req.headers["x-worker"] === id }),
  getComponentChecker: () => async () => true,
}));
vi.mock("../../server/modules/ledger/online-payment-authority", () => {
  class OnlinePaymentAuthorityError extends Error { status = 403; }
  return {
    OnlinePaymentAuthorityError,
    assertOnlinePaymentAuthority: async (req: any, type: string, id: string) => {
      if (type !== "worker" || req.headers["x-worker"] !== id) throw new OnlinePaymentAuthorityError("Access denied");
      return "fixture-user";
    },
    assertAdminTestPaymentAuthority: async () => { throw new OnlinePaymentAuthorityError("Access denied"); },
  };
});
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({
  resolveGateway: async () => state.gateway,
  GatewayResolutionError: class extends Error {},
}));
vi.mock("../../server/services/webclient/wc-vendor-context", () => ({
  describeWcVendor: async ({ configId }: { configId: string }) => ({
    configId, pluginId: "stripe", addComponentId: "stripe:StripeAddPaymentMethod",
    operations: ["payments.customer.retrieve"],
  }),
  WcVendorError: class extends Error {},
}));
vi.mock("../../server/services/webclient", () => ({
  wcRequest: async ({ operation, args }: any) => {
    const { fixtureWcRequest } = await import("./payment-vendor-fixture");
    return fixtureWcRequest(state.gateway.plugin, state.gateway.context, operation, args);
  },
}));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "fixture-user" } }) }));
vi.mock("../../server/flood/service", () => ({ enforceFloodLimit: vi.fn(), FloodError: class extends Error {} }));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: async () => [{ id: "financial", category: "financial", currencyCode: "USD", direction: "credit" }] }),
}));
// The ledger poster is controlled here, but its payment and single allocation
// are real SQL rows in the same transaction as the production attempt claim.
// Separate settlement suites exercise the full production allocation service.
vi.mock("../../server/modules/ledger/payments", () => ({
  createPaymentFromRequestBody: async (body: any) => {
    const db = state.als.getStore() ?? state.db;
    const [payment] = await db.insert(ledgerPayments).values({ ...body,
      dateReceived: new Date(body.dateReceived), dateCleared: body.dateCleared ? new Date(body.dateCleared) : null,
    }).returning();
    return { ok: true, payment };
  },
  triggerPaymentChargePlugins: async (payment: any) => {
    if (state.failAllocation) {
      state.failAllocation = false;
      throw new Error("Injected allocation failure");
    }
    const db = state.als.getStore() ?? state.db;
    await db.execute(sql`INSERT INTO fixture_allocations(payment_id) VALUES (${payment.id}) ON CONFLICT DO NOTHING`);
    return payment;
  },
}));
vi.mock("stripe", async importOriginal => {
  const { default: RealStripe } = await importOriginal<typeof import("stripe")>();
  return {
  default: class {
    webhooks = new RealStripe("sk_test_fixture").webhooks;
    customers = {
      retrieve: async () => ({ id: "cus_fixture", deleted: false }),
      create: async () => { state.customerCreates++; return { id: "cus_fixture" }; },
    };
    paymentIntents = {
      create: async (args: any) => {
        state.creates.push(args);
        state.intent = { id: `pi_fixture_${state.creates.length}`, object: "payment_intent",
          amount: args.amount, currency: args.currency, customer: args.customer,
          setup_future_usage: args.setup_future_usage, payment_method: args.payment_method ?? null,
          status: "requires_payment_method", client_secret: "fixture_only", metadata: args.metadata };
        return state.intent;
      },
      retrieve: async () => state.intent,
    };
    paymentMethods = {
      retrieve: async () => state.intent.payment_method,
      attach: async () => { throw new Error("Checkout must never attach again"); },
    };
  },
};
});

import { createPaymentMethodStorage } from "../../server/storage/ledger/payment_methods";
import { createPaymentAttemptStorage } from "../../server/storage/ledger/payment_attempts";
import { createGatewayCustomerStorage } from "../../server/storage/ledger/gateway_customers";
import { createLedgerPaymentStorage } from "../../server/storage/ledger";
import { stripePaymentGatewayPlugin } from "./payment-vendor-fixture";
import { registerLedgerPaymentAttemptRoutes } from "../../server/modules/ledger/payment-attempts";
import { registerLedgerPaymentMethodRoutes } from "../../server/modules/ledger/payment-methods";
import { processPaymentEvidence, evidenceFromPayment } from "../../server/modules/ledger/payment-settlement";
import { recoverOnlinePayments } from "../../server/modules/ledger/payment-recovery";

describe("checkout method durable storage and listing", () => {
  let directory: string;
  let pool: pg.Pool;
  let server: Server;
  let origin: string;
  let started = false;
  const methods = createPaymentMethodStorage();
  const attempts = createPaymentAttemptStorage();
  const customers = createGatewayCustomerStorage();
  beforeAll(async () => {
    directory = mkdtempSync(`${tmpdir()}/checkout-save-pg-`);
    execFileSync("initdb", ["-D", `${directory}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${directory}/data`, "-l", `${directory}/log`,
      "-o", `-k ${directory} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: directory, user: "postgres", database: "postgres", max: 8, statement_timeout: 5000 });
    state.db = drizzle(pool);
    state.als = new AsyncLocalStorage();
    // Use production column definitions; omit unrelated FKs in this isolated
    // slice. Install the actual uniqueness contracts exercised by upserts.
    const dialect = new PgDialect();
    for (const table of [entityMetadata, ledgerEa, ledgerPayments, ledgerPaymentAttempts,
      ledgerPaymentMethods, ledgerGatewayCustomers, ledgerPaymentAttemptEvents] as PgTable[]) {
      const config = getTableConfig(table);
      const columns = config.columns.map(c => {
        const def = c.default === undefined ? "" : c.default instanceof SQL
          ? dialect.sqlToQuery(c.default).sql : typeof c.default === "string" ? `'${c.default}'` : String(c.default);
        return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def ? ` DEFAULT ${def}` : ""}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
    }
    await pool.query(`
      CREATE UNIQUE INDEX ON ledger_paymentmethods(gateway_config_id,provider_method_ref);
      CREATE UNIQUE INDEX ON ledger_gateway_customers(entity_type,entity_id,gateway_config_id);
      CREATE UNIQUE INDEX ON ledger_payment_attempts(idempotency_key);
      CREATE UNIQUE INDEX ON ledger_payment_attempts(provider_intent_ref);
      CREATE UNIQUE INDEX ON ledger_payment_attempts(ledger_payment_id);
      CREATE UNIQUE INDEX ON ledger_payment_attempt_events(gateway_config_id,provider_event_id);
      CREATE TABLE fixture_allocations(payment_id text PRIMARY KEY);
    `);
    const app = express();
    app.use(express.json({ verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody: Buffer }).rawBody = Buffer.from(buffer);
    } }));
    registerLedgerPaymentAttemptRoutes(app, (_req, _res, next) => next());
    registerLedgerPaymentMethodRoutes(app);
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ledger_ea,ledger_payments,ledger_payment_attempts,ledger_paymentmethods,
      ledger_gateway_customers,ledger_payment_attempt_events,entity_metadata,fixture_allocations`);
    await pool.query(`INSERT INTO ledger_ea(id,account_id,entity_type,entity_id) VALUES ('ea','account','worker','worker')`);
    state.creates = [];
    state.customerCreates = 0;
    state.failSaveStamp = false;
    state.failAllocation = false;
    const config = { id: "gateway", pluginId: "stripe", data: {
      publishableKey: "pk_test_fixture", paymentTypes: ["card", "us_bank_account"],
    } };
    state.gateway = { config, context: { apiKey: "sk_test_fixture", webhookSecret: "fixture", config },
      description: { configId: "gateway", operations: ["payments.customer.retrieve"] },
      plugin: stripePaymentGatewayPlugin };
    state.storage = {
      users: { getUser: async () => null },
      workers: { getWorker: async () => ({ id: "worker" }), getWorkerDisplayName: async () => "Fixture worker" },
      variables: { getByName: async () => ({ value: {
        consumer: { version: "v1", text: "Fixture payment authorization" },
        business: { version: "v1", text: "Fixture payment authorization" },
      } }) },
      ledger: {
        paymentMethods: methods, gatewayCustomers: customers,
        paymentAttempts: { ...attempts, markMethodSaved: async (id: string) => {
          if (state.failSaveStamp) { state.failSaveStamp = false; throw new Error("Injected failure after upsert"); }
          return attempts.markMethodSaved(id);
        } },
        ea: { get: async () => ({ id: "ea", accountId: "account", entityType: "worker", entityId: "worker" }),
          getBalance: async () => "10.00" },
        accounts: { get: async () => ({ id: "account", name: "Fixture", currencyCode: "USD", isActive: true,
          gatewayConfigId: "gateway", data: { onlinePayments: { enabled: true, payerTypes: ["worker"],
            paymentTypes: ["card", "us_bank_account"], allowPartial: true, minAmount: 1 } } }) },
        invoices: { listForEa: async () => [] },
        payments: {
          get: async (id: string) => (await (state.als.getStore() ?? state.db).select().from(ledgerPayments).where(eq(ledgerPayments.id, id)))[0],
          settleOnline: createLedgerPaymentStorage().settleOnline,
        },
      },
    };
  });
  const request = (path: string, body?: unknown, worker = "worker") => fetch(origin + path, {
    method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-worker": worker },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const deliver = async (status: string, eventId = `evt_${status}`, valid = true) => {
    const created = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: eventId, type: `payment_intent.${status}`, created,
      data: { object: { ...state.intent, status } } });
    const sig = createHmac("sha256", "fixture").update(`${created}.${body}`).digest("hex");
    return fetch(`${origin}/api/ledger/payment-gateways/gateway/webhook`, { method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${created},v1=${valid ? sig : "invalid"}` }, body });
  };
  async function start(type: string, extra = {}, worker = "worker") {
    const response = await request("/api/ledger/checkout/worker/worker/ea/sessions", {
      amount: "10.00", selection: { mode: "full", invoiceNumbers: [] }, statementSelection: [], creditTransfers: [],
      paymentMethodType: type, saveMethod: true,
      saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true },
      consent: { version: "v1", text: "Fixture payment authorization", accepted: true },
      idempotencyKey: `fixture-${state.creates.length}`, ...extra,
    }, worker);
    return { response, value: await response.json() };
  }
  function providerConfirms(type: string, status = "succeeded") {
    state.intent.status = status;
    state.intent.payment_method = { id: `pm_${type}_fixture`, object: "payment_method", customer: "cus_fixture", type,
      ...(type === "card" ? { card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }
        : { us_bank_account: { bank_name: "Fixture Bank", last4: "6789", account_type: "checking" } }) };
  }
  async function evidence(id: string) {
    const confirmed = await stripePaymentGatewayPlugin.retrievePayment!(state.gateway.context, state.intent.id);
    return processPaymentEvidence(id, "gateway", evidenceFromPayment(confirmed));
  }
  async function listed(worker = "worker") {
    const response = await request(`/api/ledger/payment-methods/worker/${worker}`, undefined, worker);
    expect(response.status).toBe(200);
    return response.json();
  }
  async function onePayment() {
    expect((await pool.query("SELECT count(*) FROM ledger_payments")).rows[0].count).toBe("1");
    const [payment] = (await pool.query("SELECT status FROM ledger_payments")).rows;
    expect((await pool.query("SELECT count(*) FROM fixture_allocations")).rows[0].count).toBe(payment.status === "cleared" ? "1" : "0");
  }

  it.each(["card", "us_bank_account"])("persists and lists one owned %s through status/webhook replay and subsequent reuse", async type => {
    expect(await listed()).toEqual([]);
    const { response, value } = await start(type);
    expect(response.status).toBe(201);
    expect(state.customerCreates).toBe(1);
    expect(state.creates[0]).toMatchObject({ customer: "cus_fixture", setup_future_usage: "off_session" });
    providerConfirms(type, type === "us_bank_account" ? "processing" : "succeeded");
    await evidence(value.id);
    if (type === "us_bank_account") {
      expect(await listed()).toEqual([]);
      state.intent.status = "succeeded";
      await pool.query(`UPDATE ledger_payment_attempts SET created_at=now()-interval '1 hour' WHERE id=$1`, [value.id]);
      await recoverOnlinePayments();
    }
    await Promise.all([evidence(value.id), evidence(value.id)]);
    const list = await listed();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ entityId: "worker", gatewayConfigId: "gateway", isDefault: true,
      providerDetails: type === "card" ? { card: { last4: "4242" } } : { us_bank_account: { last4: "6789" } } });
    expect(list[0]).not.toHaveProperty("consent");
    expect(await listed("other-worker")).toEqual([]);
    const denied = await request("/api/ledger/payment-methods/worker/worker", undefined, "other-worker");
    expect(denied.status).toBe(403);
    const original = await methods.get(list[0].id);
    expect((original?.consent as any).authorizationType).toBe("save_payment_method");
    expect((await attempts.get(value.id))?.metadata).toHaveProperty("methodSavedAt");
    await onePayment();
    const reused = await start(type, { paymentMethodType: undefined, paymentMethodId: list[0].id,
      saveMethod: false, saveMethodConsent: undefined });
    expect(reused.response.status).toBe(201);
    expect(state.creates[1]).toMatchObject({ customer: "cus_fixture", payment_method: `pm_${type}_fixture` });
    expect(state.creates[1].setup_future_usage).toBeUndefined();
    expect(await methods.get(list[0].id)).toEqual(original);
    expect(await listed()).toHaveLength(1);
    await onePayment();
    providerConfirms(type);
    await evidence(reused.value.id);
    await evidence(reused.value.id);
    expect((await pool.query("SELECT count(*) FROM ledger_payments")).rows[0].count).toBe("2");
    expect((await pool.query("SELECT count(*) FROM fixture_allocations")).rows[0].count).toBe("2");
    expect(await methods.get(list[0].id)).toEqual(original);
    expect(await listed()).toHaveLength(1);
  });

  it.each(["card", "us_bank_account"])("rolls back a partial %s save without rolling back funds; recovery retries exactly once", async type => {
    const { value } = await start(type);
    providerConfirms(type);
    state.failSaveStamp = true;
    await expect(evidence(value.id)).rejects.toThrow("Injected failure");
    await onePayment();
    expect(await listed()).toEqual([]);
    expect((await attempts.get(value.id))?.metadata).not.toHaveProperty("methodSavedAt");
    await pool.query(`UPDATE ledger_payment_attempts SET created_at=now()-interval '1 hour'`);
    await recoverOnlinePayments();
    await evidence(value.id);
    expect(await listed()).toHaveLength(1);
    await onePayment();
  });

  it("refuses a different provider customer before clearing a pending bank payment", async () => {
    const { value } = await start("us_bank_account");
    providerConfirms("us_bank_account", "processing");
    await evidence(value.id);
    const before = await attempts.get(value.id);
    state.intent.status = "succeeded";
    state.intent.customer = "cus_other";
    await expect(evidence(value.id)).rejects.toThrow("Payment customer mismatch");
    expect((await state.storage.ledger.payments.get(before!.ledgerPaymentId)).status).toBe("pending");
    expect((await pool.query("SELECT count(*) FROM fixture_allocations")).rows[0].count).toBe("0");
    expect(await listed()).toEqual([]);
  });

  it.each(["unattached", "not-reusable"])("refuses %s method evidence but preserves posted funds", async problem => {
    const { value } = await start("card");
    providerConfirms("card");
    if (problem === "unattached") state.intent.payment_method.customer = null;
    if (problem === "not-reusable") state.intent.setup_future_usage = null;
    await expect(evidence(value.id)).rejects.toThrow("ownership");
    expect(await listed()).toEqual([]);
    await onePayment();
  });

  it.each([false, true])("persists signed ACH delivery/retry and receipt reconciliation with save %s", async save => {
    const { value } = await start("us_bank_account", save ? {} : { saveMethod: false, saveMethodConsent: undefined });
    providerConfirms("us_bank_account", "processing");
    expect((await deliver("processing", "evt_bad", false)).status).toBe(400);
    expect((await pool.query("SELECT count(*) FROM ledger_payment_attempt_events")).rows[0].count).toBe("0");
    expect((await deliver("processing")).status).toBe(200);
    const pending = await attempts.get(value.id);
    const received = await state.storage.ledger.payments.get(pending!.ledgerPaymentId);
    expect(received.status).toBe("pending");
    expect(received.dateCleared).toBeNull();
    expect(await listed()).toEqual([]);
    state.intent.status = "succeeded";
    // Failure after posting is a retryable inbox event, not a reversal of funds.
    state.failSaveStamp = save;
    expect((await deliver("succeeded")).status).toBe(save ? 500 : 200);
    if (save) {
      const unfinished = await attempts.getEvent("gateway", "evt_succeeded");
      expect(unfinished?.processedAt).toBeNull();
      expect(unfinished?.error).toBeTruthy();
    }
    expect((await deliver("succeeded")).status).toBe(200);
    const completed = await attempts.getEvent("gateway", "evt_succeeded");
    expect(completed?.processedAt).toBeInstanceOf(Date);
    expect(completed?.error).toBeNull();
    expect((await deliver("processing")).status).toBe(200);
    expect((await deliver("canceled")).status).toBe(200);
    const receiptResponse = await request(`/api/ledger/checkout/sessions/${value.id}`);
    expect(receiptResponse.status).toBe(200);
    const receipt = await receiptResponse.json();
    expect(receipt).toMatchObject({ status: "succeeded", paymentStatus: "cleared", ledgerPaymentId: pending!.ledgerPaymentId });
    expect(new Date(receipt.dateReceived)).toEqual(received.dateReceived);
    expect(receipt.dateCleared).toBeTruthy();
    const cleared = await state.storage.ledger.payments.get(pending!.ledgerPaymentId);
    expect(cleared.details.proposedAllocation).toEqual(received.details.proposedAllocation);
    expect(await listed()).toHaveLength(save ? 1 : 0);
    await onePayment();
    expect(state.creates).toHaveLength(1);
  });

  it.each([false, true])("recovers missed ACH success delivery through the authorized receipt with save %s", async save => {
    const { value } = await start("us_bank_account", save ? {} : { saveMethod: false, saveMethodConsent: undefined });
    providerConfirms("us_bank_account", "processing");
    expect((await deliver("processing")).status).toBe(200);
    const pending = await attempts.get(value.id);
    const original = await state.storage.ledger.payments.get(pending!.ledgerPaymentId);
    state.intent.status = "succeeded"; // Deliberately no success webhook.
    const denied = await request(`/api/ledger/checkout/sessions/${value.id}`, undefined, "other-worker");
    expect(denied.status).toBe(403);
    expect((await state.storage.ledger.payments.get(original.id)).status).toBe("pending");
    const response = await request(`/api/ledger/checkout/sessions/${value.id}`);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ ledgerPaymentId: original.id, status: "succeeded", paymentStatus: "cleared" });
    expect(new Date(receipt.dateReceived)).toEqual(original.dateReceived);
    await request(`/api/ledger/checkout/sessions/${value.id}`);
    expect(await listed()).toHaveLength(save ? 1 : 0);
    await onePayment();
    expect(state.creates).toHaveLength(1);
  });

  it("retains a signed success after transactional failure and retries the same pending payment", async () => {
    const { value } = await start("us_bank_account");
    providerConfirms("us_bank_account", "processing");
    expect((await deliver("processing")).status).toBe(200);
    const pending = await attempts.get(value.id);
    const original = await state.storage.ledger.payments.get(pending!.ledgerPaymentId);
    state.intent.status = "succeeded";
    state.failAllocation = true;
    expect((await deliver("succeeded")).status).toBe(500);
    const event = await attempts.getEvent("gateway", "evt_succeeded");
    expect(event?.processedAt).toBeNull();
    expect(event?.error).toBeTruthy();
    const rolledBack = await state.storage.ledger.payments.get(original.id);
    expect(rolledBack).toMatchObject({ status: "pending", dateCleared: null, dateReceived: original.dateReceived });
    expect((await attempts.get(value.id))?.status).toBe("processing");
    expect((await deliver("succeeded")).status).toBe(200);
    expect((await deliver("succeeded")).status).toBe(200);
    expect((await state.storage.ledger.payments.get(original.id))).toMatchObject({
      status: "cleared", dateReceived: original.dateReceived, details: original.details,
    });
    expect(await listed()).toHaveLength(1);
    await onePayment();
    expect(state.creates).toHaveLength(1);
  });

  it("refuses an existing provider reference owned by another worker and never replaces their consent", async () => {
    const original = await methods.upsertProviderMethod({ entityType: "worker", entityId: "other-worker",
      gatewayConfigId: "gateway", providerMethodRef: "pm_card_fixture", consent: { original: true } });
    const { value } = await start("card");
    providerConfirms("card");
    await expect(evidence(value.id)).rejects.toThrow("could not be stored");
    expect(await listed()).toEqual([]);
    expect(await methods.get(original.id)).toEqual(original);
    expect((await attempts.get(value.id))?.metadata).not.toHaveProperty("methodSavedAt");
    await onePayment();
  });

  it.each(["failed", "canceled", "opt-out", "unauthorized"])("never stores a method for %s checkout", async outcome => {
    const { response, value } = await start("card", outcome === "opt-out"
      ? { saveMethod: false, saveMethodConsent: undefined } : {}, outcome === "unauthorized" ? "other-worker" : "worker");
    if (outcome === "unauthorized") {
      expect(response.status).toBe(403);
      expect(state.creates).toHaveLength(0);
      expect(state.customerCreates).toBe(0);
    } else {
      expect(response.status).toBe(201);
      providerConfirms("card", outcome === "opt-out" ? "succeeded" : outcome);
      await evidence(value.id);
    }
    expect(await listed()).toEqual([]);
  });
});
