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
        getByIdempotencyKey: vi.fn(), getReservedAmount: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn(), lockEa: vi.fn(), expireReservations: vi.fn(),
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
    retrievePayment: vi.fn(), cancelPayment: vi.fn(), getMethodSummary: vi.fn(),
  },
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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
  mocks.storage.ledger.paymentAttempts.expireReservations.mockResolvedValue(undefined);
  mocks.storage.ledger.invoices.listForEa.mockResolvedValue([{ invoiceNumber: "INV-1", invoiceBalance: "40.00" }]);
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
    consent: { version: "v1", text: "Pay now", accepted: true },
    statementSelection: [], saveMethod: false, ...overrides,
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

  it("rejects bad amount, stale consent, and invalid invoice selection before reservation", async () => {
    let response = await checkout(valid({ amount: "12.345" }));
    expect(response.status).toBe(400);
    response = await checkout(valid({ consent: { version: "old", text: "Pay now", accepted: true } }));
    expect(response.status).toBe(400);
    response = await checkout(valid({ statementSelection: [{ invoiceNumber: "NOT-OURS", amount: "1" }] }));
    expect(response.status).toBe(400);
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
    const mismatch = await checkout(valid({ paymentMethodId: "method-1" }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ message: "Saved payment method type is not enabled" });
  });

  it("replays an idempotent attempt and retries a reserved provider failure", async () => {
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValueOnce({
      id: "attempt-existing", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      saveMethod: false, status: "succeeded", providerIntentRef: "pi-existing",
      consent: { version: "v1", text: "Pay now" }, statementSelection: [], metadata: { paymentMethodRef: null },
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
      consent: { version: "v1", text: "Pay now" }, statementSelection: [], metadata: { paymentMethodRef: null },
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
    gateway.plugin.cancelPayment.mockResolvedValue({ status: "canceled" });
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
    mocks.storage.ledger.accounts.get.mockResolvedValueOnce({
      id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: ["employer"], allowPartial: true, minAmount: 1, paymentTypes: ["card"] } },
    });
    mocks.storage.ledger.ea.get.mockResolvedValueOnce({ ...ea, entityType: "employer", entityId: "employer-1" });
    const response = await checkout(valid(), "employer/employer-1/ea-1");
    expect(response.status).toBe(201);
    expect(mocks.authority).toHaveBeenCalledWith(expect.anything(), "employer", "employer-1", "pay");

    mocks.storage.ledger.paymentAttempts.create.mockClear();
    mocks.storage.ledger.ea.get.mockResolvedValueOnce({ ...ea, id: "other-ea", entityId: "worker-1" });
    const cross = await checkout(valid({ idempotencyKey: "cross-ea" }));
    expect(cross.status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });
});