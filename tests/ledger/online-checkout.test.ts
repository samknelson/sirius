import express from "express";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authority: vi.fn(),
  access: vi.fn(),
  AuthorityError: class extends Error {},
  resolve: vi.fn(),
  storage: {
    variables: { getByName: vi.fn() },
    workers: { getWorker: vi.fn(), getWorkerDisplayName: vi.fn() },
    employers: { getEmployer: vi.fn() },
    ledger: {
      ea: { get: vi.fn(), getByEntity: vi.fn(), getBalance: vi.fn() },
      accounts: { get: vi.fn() },
      invoices: { listForEa: vi.fn() },
      paymentMethods: { get: vi.fn() },
      gatewayCustomers: { get: vi.fn(), upsert: vi.fn() },
      paymentAttempts: {
        getByIdempotencyKey: vi.fn(), getReservedAmount: vi.fn(), getReservations: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn(), lockEa: vi.fn(), lockAttempt: vi.fn(), expireReservations: vi.fn(),
        get: vi.fn(),
      },
    },
  },
}));

vi.mock("../../server/storage", () => ({ storage: mocks.storage }));
vi.mock("../../server/modules/ledger/online-payment-authority", () => ({
  assertOnlinePaymentAuthority: mocks.authority,
  OnlinePaymentAuthorityError: mocks.AuthorityError,
}));
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({ resolveGateway: mocks.resolve }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: mocks.access,
  getComponentChecker: () => async () => true,
}));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({ list: vi.fn() }) }));
vi.mock("../../server/storage/transaction-context", () => ({ runInTransaction: (fn: () => unknown) => fn() }));
vi.mock("../../server/flood/service", () => ({ enforceFloodLimit: vi.fn(), FloodError: class extends Error {} }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: vi.fn().mockResolvedValue({ dbUser: { id: "user-1" } }) }));

const { registerLedgerPaymentAttemptRoutes } = await import("../../server/modules/ledger/payment-attempts");

let server: http.Server;
let base: string;
const ea = { id: "ea-1", accountId: "acct-1", entityType: "worker", entityId: "worker-1" };
const gateway = {
  config: { id: "gw-1", data: { paymentTypes: ["card"], publishableKey: "pk_test" } },
  context: { webhookSecret: "whsec" },
  plugin: {
    id: "fixture", payComponentId: "fixture:Pay", supportedPaymentTypes: [{ id: "card" }],
    constructWebhookEvent: vi.fn(), createPaymentSession: vi.fn(), createCustomer: vi.fn(),
    retrievePayment: vi.fn(), cancelPayment: vi.fn(), getMethodSummary: vi.fn(), attachMethod: vi.fn(),
  },
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stand in for the authenticated session after masquerade middleware resolves it.
  app.use((req, _res, next) => {
    (req as any).session = { masqueradeUserId: req.header("x-target-user") };
    next();
  });
  registerLedgerPaymentAttemptRoutes(app, (_req, _res, next) => next());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ granted: false });
  mocks.authority.mockResolvedValue("user-1");
  mocks.storage.ledger.ea.get.mockResolvedValue(ea);
  mocks.storage.ledger.accounts.get.mockResolvedValue({
    id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
    data: { onlinePayments: { enabled: true, payerTypes: ["worker"], allowPartial: true, minAmount: 1, paymentTypes: ["card"] } },
  });
  mocks.storage.ledger.ea.getBalance.mockResolvedValue("100.00");
  mocks.storage.ledger.paymentAttempts.getReservedAmount.mockResolvedValue(0);
  mocks.storage.ledger.paymentAttempts.getReservations.mockResolvedValue([]);
  mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(null);
  mocks.storage.ledger.paymentAttempts.create.mockResolvedValue({
    id: "attempt-1", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
    amount: "12.34", currency: "USD", status: "requires_action", createdByUserId: "user-1",
  });
  mocks.storage.ledger.paymentAttempts.updateStatus.mockImplementation(async (id: string, status: string, extra: object = {}) => ({
    id, entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
    amount: "12.34", currency: "USD", status, ...extra,
  }));
  mocks.storage.ledger.paymentAttempts.lockEa.mockResolvedValue(undefined);
  mocks.storage.ledger.paymentAttempts.lockAttempt.mockResolvedValue(undefined);
  mocks.storage.ledger.paymentAttempts.expireReservations.mockResolvedValue(undefined);
  mocks.storage.ledger.invoices.listForEa.mockResolvedValue([{ invoiceNumber: "INV-1", invoiceBalance: "12.34", year: 2026, month: 9 }]);
  mocks.storage.variables.getByName.mockResolvedValue({ value: { consumer: { version: "v1", text: "Pay now" }, business: { version: "v1", text: "Pay now" } } });
  mocks.resolve.mockResolvedValue(gateway);
  gateway.plugin.createPaymentSession.mockResolvedValue({
    status: "requires_action", providerRef: "pi-1", clientSecret: "cs-1",
    publicConfig: { publishableKey: "pk_test", paymentTypes: ["card"], secret: "never-expose" },
  });
});

describe("online checkout HTTP contract", () => {
  it("returns scoped page data including invoices and provider UI metadata", async () => {
    const response = await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      eaId: "ea-1", balance: "100.00", available: "100.00",
      invoices: [{ invoiceNumber: "INV-1" }], paymentTypes: ["card"], payComponentId: "fixture:Pay",
    });
    expect(mocks.authority).toHaveBeenCalledWith(expect.anything(), "worker", "worker-1", "pay");
  });

  it("denies disabled checkout without exposing account details", async () => {
    mocks.storage.ledger.accounts.get.mockResolvedValueOnce({
      id: "acct-1", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: false } },
    });
    const response = await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "Online checkout is not enabled" });
  });

  it("rejects unsupported entity scope before storage reads", async () => {
    const response = await fetch(`${base}/api/ledger/checkout/alien/entity-1/ea-1`);
    expect(response.status).toBe(400);
    expect(mocks.storage.ledger.accounts.get).not.toHaveBeenCalled();
  });

  const checkout = (body: Record<string, unknown>, entity = "worker/worker-1/ea-1") =>
    fetch(`${base}/api/ledger/checkout/${entity}/sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  const valid = (overrides: Record<string, unknown> = {}) => ({
    amount: "12.34", idempotencyKey: "idem-1",
    paymentMethodType: "card",
    selection: { mode: "statements", invoiceNumbers: ["INV-1"] },
    consent: { version: "v1", text: "Pay now", accepted: true },
    statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }], saveMethod: false, ...overrides,
  });

  it("separates missing authorization, effective method denial and unsupported providers", async () => {
    mocks.storage.variables.getByName.mockResolvedValueOnce(undefined);
    let response = await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`);
    expect(await response.json()).toMatchObject({ authorization: null, readiness: {
      paymentAuthorization: "configuration_required", methodPermission: "allowed", saveMethod: "configuration_required",
    } });
    mocks.authority.mockImplementation(async (_req, _type, _id, capability) => {
      if (capability === "methods") throw new mocks.AuthorityError("Denied");
      return "user-1";
    });
    response = await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`);
    expect(await response.json()).toMatchObject({ readiness: {
      paymentAuthorization: "ready", methodPermission: "denied", saveMethod: "permission_denied",
    } });
    mocks.authority.mockResolvedValue("user-1");
    mocks.resolve.mockResolvedValue({ ...gateway, plugin: { ...gateway.plugin, attachMethod: undefined } });
    response = await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`);
    expect(await response.json()).toMatchObject({ readiness: { saveMethod: "provider_unsupported" } });
    expect((await checkout(valid({ saveMethod: true }))).status).toBe(409);
  });

  it("locks before authoritative invoice reads and rejects changed whole statement amounts", async () => {
    mocks.storage.ledger.invoices.listForEa.mockImplementation(async () => {
      expect(mocks.storage.ledger.paymentAttempts.lockEa).toHaveBeenCalledWith("ea-1");
      return [{ invoiceNumber: "INV-1", invoiceBalance: "15.00", year: 2026, month: 9 }];
    });
    const response = await checkout(valid());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("balances changed") });
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it("rejects a competing statement reservation despite unrelated account debt", async () => {
    mocks.storage.ledger.paymentAttempts.getReservations.mockResolvedValue([{
      amount: "12.34", statementSelection: [{ invoiceNumber: "OLD-NAME", amount: "12.34" }],
      metadata: { invoicePeriods: [{ invoiceNumber: "OLD-NAME", statementYmd: "2026-09-01" }] },
    }]);
    const response = await checkout(valid());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("pending payment") });
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });

  it("snapshots full allocation and unstatemented remainder without accepting freeform amounts", async () => {
    const response = await checkout(valid({ amount: "100.00", selection: { mode: "full", invoiceNumbers: [] } }));
    expect(response.status).toBe(201);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: "100.00",
      statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
      metadata: expect.objectContaining({
        checkoutQuote: expect.objectContaining({ unstatementedAmount: "87.66" }),
        invoicePeriods: [{ invoiceNumber: "INV-1", statementYmd: "2026-09-01" }],
      }),
    }));
    expect((await checkout(valid({ amount: "5.00", statementSelection: [{ invoiceNumber: "INV-1", amount: "5.00" }] }))).status).toBe(409);
  });

  it("requires the reviewed credit sources and snapshots their zero-sum attribution", async () => {
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("150.00");
    mocks.storage.ledger.invoices.listForEa.mockResolvedValue([
      { invoiceNumber: "JAN", invoiceBalance: "100.00", year: 2026, month: 1 },
      { invoiceNumber: "FEB", invoiceBalance: "100.00", year: 2026, month: 2 },
      { invoiceNumber: "MARCH-CREDIT", invoiceBalance: "-50.00", year: 2026, month: 3 },
    ]);
    const preview = await (await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`)).json();
    const body = valid({ amount: "150.00", selection: { mode: "full", invoiceNumbers: [] },
      statementSelection: preview.quote.statementSelection });
    expect((await checkout(body)).status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect((await checkout({ ...body, creditTransfers: preview.quote.creditTransfers })).status).toBe(201);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ checkoutQuote: expect.objectContaining({
        creditTransfers: [{ sourceInvoiceNumber: "MARCH-CREDIT", sourceStatementYmd: "2026-03-01",
          targetInvoiceNumber: "JAN", targetStatementYmd: "2026-01-01", amount: "50.00" }],
      }) }),
    }));
  });

  it("rechecks current consent inside the locked boundary", async () => {
    mocks.storage.variables.getByName
      .mockResolvedValueOnce({ value: { consumer: { version: "v1", text: "Pay now" }, business: { version: "v1", text: "Pay now" } } })
      .mockResolvedValueOnce({ value: { consumer: { version: "v2", text: "New approved text" }, business: { version: "v1", text: "Pay now" } } });
    expect((await checkout(valid())).status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });

  it("preserves immutable replay even after invoices disappear and the current balance is zero", async () => {
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue({
      id: "old", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1", gatewayConfigId: "gw-1",
      createdByUserId: "user-1", amount: "12.34", currency: "USD", saveMethod: false, status: "succeeded",
      providerIntentRef: "pi-old", ledgerPaymentId: "posted",
      consent: { version: "v1", text: "Pay now" },
      statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
       metadata: { paymentMethodRef: null, paymentTypes: ["card"], checkoutSelection: { mode: "statements", invoiceNumbers: ["INV-1"] } },
    });
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("0.00");
    mocks.storage.ledger.invoices.listForEa.mockResolvedValue([]);
    expect((await checkout(valid())).status).toBe(200);
    expect(mocks.storage.ledger.invoices.listForEa).not.toHaveBeenCalled();
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect((await checkout(valid({ selection: { mode: "full", invoiceNumbers: [] } }))).status).toBe(409);
  });

  it("creates a session with minor-unit amount, consent, invoice selection, flood and gateway calls", async () => {
    const response = await checkout(valid({ statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "attempt-1", amount: "12.34", clientSecret: "cs-1" });
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: "12.34", consent: expect.objectContaining({ version: "v1", text: "Pay now" }),
      statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
    }));
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      amountMinor: 1234, currency: "USD", paymentTypes: ["card"], saveMethod: false,
    }));
  });

  it.each([
    [["card", "us_bank_account"], "card"],
    [["card", "us_bank_account"], "us_bank_account"],
    [["card"], "card"],
    [["us_bank_account"], "us_bank_account"],
  ] as const)("restricts %j checkout to selected %s", async (allowed, selected) => {
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: ["worker"], allowPartial: true, minAmount: 1, paymentTypes: [...allowed] } },
    });
    mocks.resolve.mockResolvedValue({ ...gateway, config: { ...gateway.config, data: { paymentTypes: [...allowed], publishableKey: "pk_test" } },
      plugin: { ...gateway.plugin, supportedPaymentTypes: [{ id: "card" }, { id: "us_bank_account" }] } });
    const page = await (await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`)).json();
    expect(page.paymentTypes).toEqual([...allowed]);
    const response = await checkout(valid({ paymentMethodType: selected }));
    expect(response.status).toBe(201);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ paymentTypes: [selected] }),
    }));
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ paymentTypes: [selected] }));
  });

  it("rejects missing, conflicting, and disallowed type choices before creating a reservation", async () => {
    let response = await checkout(valid({ paymentMethodType: undefined }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Choose exactly one saved method or new payment type" });
    response = await checkout(valid({ paymentMethodType: "crypto" }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("paymentMethodType");
    response = await checkout(valid({ paymentMethodType: "us_bank_account" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: expect.stringContaining("not enabled for this account") });
    response = await checkout(valid({ paymentMethodId: "saved-card" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Choose exactly one saved method or new payment type" });
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it.each(["card", "us_bank_account"] as const)(
    "reports the provider failure after accepting a new %s session request",
    async (selected) => {
      mocks.storage.ledger.accounts.get.mockResolvedValue({
        id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
        data: { onlinePayments: { enabled: true, payerTypes: ["worker"], allowPartial: true, minAmount: 1, paymentTypes: ["card", "us_bank_account"] } },
      });
      mocks.resolve.mockResolvedValue({
        ...gateway,
        config: { ...gateway.config, data: { paymentTypes: ["card", "us_bank_account"], publishableKey: "pk_test" } },
        plugin: { ...gateway.plugin, supportedPaymentTypes: [{ id: "card" }, { id: "us_bank_account" }] },
      });
      gateway.plugin.createPaymentSession.mockRejectedValueOnce(new Error("Test gateway unavailable"));
      const response = await checkout(valid({ paymentMethodType: selected }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ message: "Test gateway unavailable" });
      expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalled();
      expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ paymentTypes: [selected] }),
      );
    },
  );

  it("keeps saved-method sessions bound to their provider's authorized type", async () => {
    mocks.storage.ledger.paymentMethods.get.mockResolvedValue({
      id: "method-1", isActive: true, entityType: "worker", entityId: "worker-1",
      gatewayConfigId: "gw-1", providerMethodRef: "pm-1",
    });
    mocks.storage.ledger.gatewayCustomers.get.mockResolvedValue({ customerRef: "cus-1" });
    gateway.plugin.getMethodSummary.mockResolvedValue({ type: "card" });
    const response = await checkout(valid({ paymentMethodId: "method-1", paymentMethodType: undefined }));
    expect(response.status).toBe(201);
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      savedMethodRef: "pm-1", customerRef: "cus-1", paymentTypes: ["card"],
    }));
  });

  it("rejects a replay that changes the selected payment type", async () => {
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue({
      id: "old", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1", gatewayConfigId: "gw-1",
      createdByUserId: "user-1", amount: "12.34", currency: "USD", saveMethod: false, status: "requires_action",
      providerIntentRef: "pi-old", consent: { version: "v1", text: "Pay now" },
      statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
      metadata: { paymentMethodRef: null, paymentTypes: ["card"], checkoutSelection: { mode: "statements", invoiceNumbers: ["INV-1"] } },
    });
    expect((await checkout(valid({ paymentMethodType: "us_bank_account" }))).status).toBe(409);
    expect(gateway.plugin.retrievePayment).not.toHaveBeenCalled();
  });

  it("rejects bad amount, stale consent, and invalid invoice selection before reservation", async () => {
    let response = await checkout(valid({ amount: "12.345" }));
    expect(response.status).toBe(400);
    response = await checkout(valid({ consent: { version: "old", text: "Pay now", accepted: true } }));
    expect(response.status).toBe(400);
    response = await checkout(valid({ statementSelection: [{ invoiceNumber: "NOT-OURS", amount: "1" }] }));
    expect(response.status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });

  it("enforces account payer type and disabled checkout on session creation", async () => {
    mocks.storage.ledger.accounts.get.mockResolvedValueOnce({
      id: "acct-1", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: false, payerTypes: ["worker"] } },
    });
    const response = await checkout(valid());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "Online checkout is not enabled" });
  });

  it("gates saveMethod authority and rejects an incompatible saved method", async () => {
    mocks.authority.mockResolvedValueOnce("user-1").mockImplementationOnce(() => {
      throw new mocks.AuthorityError("Methods access denied");
    });
    const denied = await checkout(valid({ saveMethod: true }));
    expect(denied.status).toBe(403);
    expect(mocks.authority).toHaveBeenLastCalledWith(expect.anything(), "worker", "worker-1", "methods");

    mocks.authority.mockResolvedValue("user-1");
    mocks.storage.ledger.paymentMethods.get.mockResolvedValue({
      id: "method-1", isActive: true, entityType: "worker", entityId: "worker-1",
      gatewayConfigId: "gw-1", providerMethodRef: "pm-1",
    });
    gateway.plugin.getMethodSummary.mockResolvedValue({ type: "us_bank_account" });
     const mismatch = await checkout(valid({ paymentMethodId: "method-1", paymentMethodType: undefined }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ message: "Saved payment method type is not enabled" });
  });

  it("replays an idempotent attempt and retries a reserved provider failure", async () => {
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValueOnce({
      id: "attempt-existing", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      saveMethod: false, status: "succeeded", providerIntentRef: "pi-existing",
      consent: { version: "v1", text: "Pay now" }, statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
       metadata: { paymentMethodRef: null, paymentTypes: ["card"], checkoutSelection: { mode: "statements", invoiceNumbers: ["INV-1"] } },
    });
    gateway.plugin.retrievePayment.mockResolvedValue({ clientSecret: "cs-existing" });
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue({
      id: "attempt-existing", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      amount: "12.34", currency: "USD", status: "succeeded", providerIntentRef: "pi-existing",
    });
    let response = await checkout(valid());
    expect(response.status).toBe(200);
    expect(gateway.plugin.retrievePayment).toHaveBeenCalledWith(expect.anything(), "pi-existing");
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();

    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue({
      id: "attempt-retry", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      saveMethod: false, status: "processing", providerIntentRef: null,
      consent: { version: "v1", text: "Pay now" }, statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
       metadata: { paymentMethodRef: null, paymentTypes: ["card"], checkoutSelection: { mode: "statements", invoiceNumbers: ["INV-1"] } },
    });
    response = await checkout(valid());
    expect(response.status).toBe(200);
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: "attempt-retry", amountMinor: 1234,
    }));
  });

  it("retains the reservation when the provider response is ambiguous", async () => {
    gateway.plugin.createPaymentSession.mockRejectedValueOnce(new Error("provider down"));
    const response = await checkout(valid());
    expect(response.status).toBe(500);
    expect(mocks.storage.ledger.paymentAttempts.updateStatus).not.toHaveBeenCalledWith(
      "attempt-1", "failed", expect.anything(),
    );
  });

  it("allows the creator to cancel and read, but blocks another authority from canceling", async () => {
    const attempt = {
      id: "attempt-cancel", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      status: "requires_action", providerIntentRef: "pi-cancel",
    };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({
      status: "requires_action", providerRef: "pi-cancel", amountMinor: 1234, currency: "USD",
    });
    gateway.plugin.cancelPayment.mockResolvedValue({
      status: "canceled", providerRef: "pi-cancel", amountMinor: 1234, currency: "USD",
    });
    mocks.storage.ledger.paymentAttempts.updateStatus.mockResolvedValue({ ...attempt, status: "canceled" });
    let response = await fetch(`${base}/api/ledger/checkout/sessions/attempt-cancel`, { method: "GET" });
    expect(response.status).toBe(200);
    mocks.authority.mockResolvedValue("different-user");
    response = await fetch(`${base}/api/ledger/checkout/sessions/attempt-cancel/cancel`, { method: "POST" });
    expect(response.status).toBe(403);
    mocks.authority.mockResolvedValue("user-1");
    response = await fetch(`${base}/api/ledger/checkout/sessions/attempt-cancel/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(gateway.plugin.cancelPayment).toHaveBeenCalledWith(expect.anything(), "pi-cancel");
  });

  it("uses employer authority and rejects a cross-EA checkout", async () => {
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: ["employer"], allowPartial: true, minAmount: 1, paymentTypes: ["card"] } },
    });
    mocks.storage.ledger.ea.get.mockResolvedValue({ ...ea, entityType: "employer", entityId: "employer-1" });
    const response = await checkout(valid(), "employer/employer-1/ea-1");
    expect(response.status).toBe(201);
    expect(mocks.authority).toHaveBeenCalledWith(expect.anything(), "employer", "employer-1", "pay");

    mocks.storage.ledger.paymentAttempts.create.mockClear();
    mocks.storage.ledger.ea.get.mockResolvedValueOnce({ ...ea, id: "other-ea", entityId: "worker-1" });
    const cross = await checkout(valid({ idempotencyKey: "cross-ea" }));
    expect(cross.status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });

  it.each(["worker", "employer"] as const)("keeps %s sessions and receipts with the target after masquerade changes", async (kind) => {
    const entityId = kind === "worker" ? "worker-1" : "employer-1";
    const scope = `${kind}/${entityId}/ea-1`;
    const target = `${kind}-target`;
    const grants = new Set(["pay", "methods"]);
    mocks.authority.mockImplementation(async (req, type, id, capability) => {
      if (req.session.masqueradeUserId !== target || type !== kind || id !== entityId || !grants.has(capability)) {
        throw new mocks.AuthorityError("Access denied");
      }
      return target;
    });
    mocks.storage.ledger.ea.get.mockResolvedValue({ ...ea, entityType: kind, entityId });
    mocks.storage.ledger.ea.getByEntity.mockResolvedValue([{ ...ea, entityType: kind, entityId }]);
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: [kind], allowPartial: true, minAmount: 1, paymentTypes: ["card"] } },
    });
    const attempt = {
      id: "target-attempt", entityType: kind, entityId, ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: target, amount: "12.34", currency: "USD",
      saveMethod: false, status: "requires_action", providerIntentRef: null,
      consent: { version: "v1", text: "Pay now" }, statementSelection: [],
      metadata: { paymentMethodRef: null },
    };
    mocks.storage.ledger.paymentAttempts.create.mockResolvedValue(attempt);
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    const headers = { "x-target-user": target };
    let response = await fetch(`${base}/api/ledger/pay-accounts/${kind}/${entityId}`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ eaId: "ea-1" }]);
    response = await fetch(`${base}/api/ledger/checkout/${scope}`, { headers });
    expect(response.status).toBe(200);
    grants.delete("methods");
    response = await fetch(`${base}/api/ledger/checkout/${scope}/sessions`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(valid({ saveMethod: true })),
    });
    expect(response.status).toBe(403);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    response = await fetch(`${base}/api/ledger/checkout/${scope}/sessions`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(valid()),
    });
    expect(response.status).toBe(201);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      createdByUserId: target, entityType: kind, entityId,
    }));
    const receiptUrl = `${base}/api/ledger/checkout/sessions/target-attempt`;
    expect((await fetch(receiptUrl, { headers })).status).toBe(200);
    expect((await fetch(receiptUrl)).status).toBe(403); // original staff
    expect((await fetch(receiptUrl, { headers: { "x-target-user": "other-target" } })).status).toBe(403);
    expect((await fetch(`${receiptUrl}/cancel`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${receiptUrl}/cancel`, { method: "POST", headers: { "x-target-user": "other-target" } })).status).toBe(403);
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(attempt);
    expect((await fetch(`${base}/api/ledger/checkout/${scope}/sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(valid()),
    })).status).toBe(403);
    grants.delete("pay");
    expect((await fetch(receiptUrl, { headers })).status).toBe(403);
    expect((await fetch(`${receiptUrl}/cancel`, { method: "POST", headers })).status).toBe(403);
    expect((await fetch(`${base}/api/ledger/checkout/${scope}/sessions`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(valid()),
    })).status).toBe(403);
  });
});