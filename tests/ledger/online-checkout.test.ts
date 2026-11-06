import express from "express";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCheckoutSelection } from "../../shared/ledger/checkout-selection";
import { CHECKOUT_SAVE_METHOD_CONSENT } from "../../shared/ledger/checkout-save-consent";
import { ADMIN_PAYMENT_CONFIRMATION } from "../../shared/ledger/admin-payment-confirmation";
import { PaymentInitiationRejected } from "../../server/plugins/ledger/payment-gateway/types";

const mocks = vi.hoisted(() => ({
  authority: vi.fn(),
  adminAuthority: vi.fn(),
  access: vi.fn(),
  processPaymentEvidence: vi.fn(),
  createPaymentFromRequestBody: vi.fn(),
  AuthorityError: class extends Error {},
  resolve: vi.fn(),
  stripeRetrieve: vi.fn(),
  stripeCancel: vi.fn(),
  storage: {
    variables: { getByName: vi.fn() },
    workers: { getWorker: vi.fn(), getWorkerDisplayName: vi.fn() },
    employers: { getEmployer: vi.fn() },
    ledger: {
      ea: { get: vi.fn(), getByEntity: vi.fn(), getBalance: vi.fn() },
      entries: { applyCheckoutCreditTransfers: vi.fn() },
      accounts: { get: vi.fn() },
      invoices: { listForEa: vi.fn() },
      paymentMethods: { get: vi.fn() },
      payments: { get: vi.fn() },
      gatewayCustomers: { get: vi.fn(), upsert: vi.fn() },
      paymentAttempts: {
        getByIdempotencyKey: vi.fn(), getReservedAmount: vi.fn(), getReservations: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn(), lockEa: vi.fn(), lockAttempt: vi.fn(), expireReservations: vi.fn(),
        get: vi.fn(), claimLedgerPosting: vi.fn(), recordEvent: vi.fn(), markEventProcessed: vi.fn(),
      },
    },
  },
}));
vi.mock("stripe", () => ({ default: class {
  paymentIntents = { retrieve: mocks.stripeRetrieve, cancel: mocks.stripeCancel };
} }));
vi.mock("../../server/plugins/ledger/payment-gateway/registry", () => ({ registerPaymentGatewayPlugin: vi.fn() }));

vi.mock("../../server/storage", () => ({ storage: mocks.storage }));
vi.mock("../../server/modules/ledger/online-payment-authority", () => ({
  assertAdminTestPaymentAuthority: mocks.adminAuthority,
  assertAdminPaymentAuthority: mocks.adminAuthority,
  assertOnlinePaymentAuthority: mocks.authority,
  OnlinePaymentAuthorityError: mocks.AuthorityError,
}));
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({ resolveGateway: mocks.resolve }));
vi.mock("../../server/modules/ledger/payment-settlement", () => ({
  processPaymentEvidence: mocks.processPaymentEvidence,
  evidenceFromPayment: (payment: { status: string }) => ({ type: `payment.${payment.status}` }),
  settlementError: () => "Payment settlement failed",
  logSettlementFailure: vi.fn(),
  SettlementRefusal: class extends Error {},
}));
vi.mock("../../server/modules/ledger/payments", () => ({
  createPaymentFromRequestBody: mocks.createPaymentFromRequestBody,
  triggerPaymentChargePlugins: vi.fn(),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: mocks.access,
  getComponentChecker: () => async () => true,
}));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({ list: vi.fn() }) }));
vi.mock("../../server/storage/transaction-context", () => ({ runInTransaction: (fn: () => unknown) => fn() }));
vi.mock("../../server/flood/service", () => ({ enforceFloodLimit: vi.fn(), FloodError: class extends Error {} }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: vi.fn().mockResolvedValue({ dbUser: { id: "user-1" } }) }));

const { registerLedgerPaymentAttemptRoutes } = await import("../../server/modules/ledger/payment-attempts");
const { stripePaymentGatewayPlugin } = await import("../../server/plugins/ledger/payment-gateway/plugins/stripe");

let server: http.Server;
let base: string;
const liveAttempts = new Map<string, any>();
const ea = { id: "ea-1", accountId: "acct-1", entityType: "worker", entityId: "worker-1" };
const gateway: { config: any; context: any; plugin: Record<string, any> } = {
  config: { id: "gw-1", data: { paymentTypes: ["card"], publishableKey: "pk_test" } },
  context: { webhookSecret: "whsec" },
  plugin: {
    id: "fixture", payComponentId: "fixture:Pay", supportedPaymentTypes: [{ id: "card" }],
    constructWebhookEvent: vi.fn(), createPaymentSession: vi.fn(), createCustomer: vi.fn(),
    isTestMode: vi.fn(() => true),
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
  liveAttempts.clear();
  mocks.storage.ledger.paymentAttempts.get.mockReset().mockImplementation(async (id: string) => {
    if (liveAttempts.has(id)) return liveAttempts.get(id);
    const created = await mocks.storage.ledger.paymentAttempts.create.mock.results.at(-1)?.value;
    const existing = await mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mock.results.at(-1)?.value;
    const row = created?.id === id ? created : existing?.id === id ? existing : undefined;
    if (row) liveAttempts.set(id, { ...row });
    return liveAttempts.get(id);
  });
  mocks.processPaymentEvidence.mockReset();
  mocks.access.mockResolvedValue({ granted: false });
  mocks.authority.mockResolvedValue("user-1");
  mocks.adminAuthority.mockResolvedValue("admin-1");
  gateway.plugin.isTestMode = vi.fn(() => true);
  gateway.plugin.cancelPayment = vi.fn();
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
  mocks.storage.ledger.paymentAttempts.updateStatus.mockImplementation(async (id: string, status: string, extra: object = {}) => {
    const row = liveAttempts.get(id) ?? {
      id, entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1", gatewayConfigId: "gw-1",
      amount: "12.34", currency: "USD",
    };
    Object.assign(row, { status }, extra);
    liveAttempts.set(id, row);
    return { ...row };
  });
  mocks.storage.ledger.paymentAttempts.lockEa.mockResolvedValue(undefined);
  mocks.storage.ledger.paymentAttempts.lockAttempt.mockResolvedValue(undefined);
  mocks.storage.ledger.paymentAttempts.expireReservations.mockResolvedValue(undefined);
  mocks.storage.ledger.invoices.listForEa.mockResolvedValue([{ invoiceNumber: "INV-1", invoiceBalance: "12.34", year: 2026, month: 9 }]);
  mocks.storage.variables.getByName.mockResolvedValue({ value: { consumer: { version: "v1", text: "Pay now" }, business: { version: "v1", text: "Pay now" } } });
  mocks.storage.workers.getWorker.mockResolvedValue({ id: "worker-1", siriusId: "worker-sid" });
  mocks.storage.workers.getWorkerDisplayName.mockResolvedValue("Test Worker");
  mocks.storage.ledger.gatewayCustomers.get.mockResolvedValue(undefined);
  mocks.storage.ledger.gatewayCustomers.upsert.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue(gateway);
  gateway.plugin.createCustomer.mockReset().mockResolvedValue({ customerRef: "customer-1" });
  gateway.plugin.createPaymentSession.mockReset().mockResolvedValue({
    status: "requires_action", providerRef: "pi-1", clientSecret: "cs-1",
    publicConfig: { publishableKey: "pk_test", paymentTypes: ["card"], secret: "never-expose" },
  });
});

describe("online checkout HTTP contract", () => {
  it("locks and snapshots the $500 same-period increment without letting the pending $802.05 be selected again", async () => {
    const original = calculateCheckoutSelection({
      balance: "802.05", reserved: "0.00", reservations: [], allowPartial: true, minAmount: 1,
      invoices: [{ invoiceNumber: "INV-1", invoiceBalance: "802.05", year: 2026, month: 9 }],
    }, { mode: "full", invoiceNumbers: [] });
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("1302.05");
    mocks.storage.ledger.invoices.listForEa.mockResolvedValue([{ invoiceNumber: "INV-1", invoiceBalance: "1302.05", year: 2026, month: 9 }]);
    mocks.storage.ledger.paymentAttempts.getReservations.mockResolvedValue([{
      amount: "802.05", statementSelection: original.statementSelection,
      metadata: { invoicePeriods: original.invoicePeriods, checkoutQuote: original },
    }]);
    const preview = await (await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`)).json();
    expect(preview.quote).toMatchObject({ amount: "500.00", available: "500.00", issues: [],
      statementSelection: [{ invoiceNumber: "INV-1", amount: "500.00" }] });
    const body = valid({ amount: "500.00", selection: { mode: "full", invoiceNumbers: [] },
      statementSelection: preview.quote.statementSelection });
    expect((await checkout(valid({ amount: "802.05", statementSelection: original.statementSelection }))).status).toBe(409);
    expect((await checkout(body)).status).toBe(201);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: "500.00", statementSelection: [{ invoiceNumber: "INV-1", amount: "500.00" }],
      metadata: expect.objectContaining({ invoicePeriods: [{ invoiceNumber: "INV-1", statementYmd: "2026-09-01" }],
        checkoutQuote: expect.objectContaining({ statements: [expect.objectContaining({ due: "500.00", payable: "500.00" })] }) }),
    }));
    mocks.storage.ledger.paymentAttempts.getReservations.mockResolvedValue([{
      amount: "802.05", statementSelection: original.statementSelection,
      metadata: { invoicePeriods: original.invoicePeriods, checkoutQuote: original },
    }, { amount: "500.00", statementSelection: preview.quote.statementSelection,
      metadata: { invoicePeriods: preview.quote.invoicePeriods, checkoutQuote: preview.quote } }]);
    const after = await (await fetch(`${base}/api/ledger/checkout/worker/worker-1/ea-1`)).json();
    expect(after.quote).toMatchObject({ amount: "0.00", available: "0.00" });
    expect((await checkout(body)).status).toBe(409);
  });
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
  const adminTestUrl = (entity = "worker/worker-1/ea-1") =>
    `${base}/api/ledger/admin-test-checkout/${entity}`;
  const adminTestBody = (preview: any, id = "admin-test-idem") => ({
    amount: preview.quote.amount, idempotencyKey: id, paymentMethodType: "card",
    selection: { mode: "full", invoiceNumbers: [] },
    statementSelection: preview.quote.statementSelection,
    creditTransfers: preview.quote.creditTransfers, saveMethod: false,
    adminTestConfirmation: true, purpose: "Verify test payment setup",
  });
  const adminTestPost = (body: Record<string, unknown>, entity = "worker/worker-1/ea-1") =>
    fetch(`${adminTestUrl(entity)}/sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });

  const onBehalfUrl = (scope = "worker/worker-1/ea-1") => `${base}/api/ledger/admin-checkout/${scope}`;
  const onBehalfBody = (overrides: Record<string, unknown> = {}) => ({
    amount: "100.00", idempotencyKey: "admin-assisted-1", paymentMethodType: "card",
    selection: { mode: "full", invoiceNumbers: [] },
    statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
    creditTransfers: [], saveMethod: false,
    adminConfirmation: { ...ADMIN_PAYMENT_CONFIRMATION, accepted: true }, ...overrides,
  });
  const onBehalfPost = (body = onBehalfBody(), scope?: string) => fetch(`${onBehalfUrl(scope)}/sessions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const retainCreatedAttempt = () => {
    mocks.storage.ledger.paymentAttempts.create.mockImplementation(async input => {
      const row = { ...input, id: "on-behalf-1", __created: true };
      liveAttempts.set(row.id, row);
      return row;
    });
  };

  it.each([true, false, undefined])("allows administrator worker checkout independently of a gateway test-mode signal %s", async signal => {
    gateway.plugin.isTestMode = signal === undefined ? undefined : vi.fn(() => signal);
    retainCreatedAttempt();
    const response = await fetch(onBehalfUrl());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      entityType: "worker", entityId: "worker-1", isAdminAssisted: true,
      adminConfirmation: ADMIN_PAYMENT_CONFIRMATION,
    });
    const created = await onBehalfPost();
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: "on-behalf-1", isAdminAssisted: true, isAdminTest: false });
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "worker-1", entityType: "worker", entityId: "worker-1",
      ledgerEaId: "ea-1", createdByUserId: "admin-1", consent: null, saveMethod: false,
      metadata: expect.objectContaining({
        source: "admin_assisted_checkout", paymentMethodRef: null,
        adminAssisted: { actorUserId: "admin-1", gatewayFingerprint: expect.any(String), confirmation: {
          ...ADMIN_PAYMENT_CONFIRMATION, accepted: true, acceptedAt: expect.any(String),
        } },
      }),
    }));
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      savedMethodRef: undefined, customerRef: undefined, saveMethod: false,
      description: "Administrator payment on behalf of worker",
      metadata: expect.objectContaining({ paymentPurpose: "admin_assisted" }),
    }));
    expect(mocks.authority).not.toHaveBeenCalled();
    expect(gateway.plugin.createCustomer).not.toHaveBeenCalled();
  });

  it.each([
    { adminConfirmation: undefined },
    { adminConfirmation: { ...ADMIN_PAYMENT_CONFIRMATION, accepted: false } },
    { adminConfirmation: { ...ADMIN_PAYMENT_CONFIRMATION, version: "stale", accepted: true } },
    { paymentMethodId: "saved-worker-method", paymentMethodType: undefined },
    { saveMethod: true, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } },
    { consent: { version: "v1", text: "Pay now", accepted: true } },
    { metadata: { paymentPurpose: "admin_assisted" } },
  ])("rejects missing authorization, saving and forged payer consent before provider entry: %j", async overrides => {
    const result = await onBehalfPost(onBehalfBody(overrides));
    expect(result.status).toBe(400);
    expect(result.headers.get("content-type")).toContain("application/json");
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator and does not broaden employer or ordinary payer authority", async () => {
    mocks.adminAuthority.mockRejectedValue(new mocks.AuthorityError("Administrator access is required"));
    expect((await fetch(onBehalfUrl())).status).toBe(403);
    expect((await onBehalfPost()).status).toBe(403);
    expect((await onBehalfPost(onBehalfBody(), "employer/employer-1/ea-1")).status).toBe(400);
    mocks.authority.mockRejectedValue(new mocks.AuthorityError("Staff cannot perform online payment actions"));
    expect((await checkout(valid())).status).toBe(403);
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it("checks account owner and enabled checkout before administrator provider entry", async () => {
    mocks.storage.ledger.ea.get.mockResolvedValueOnce({ ...ea, entityId: "another-worker" });
    expect((await fetch(onBehalfUrl())).status).toBe(409);
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", currencyCode: "USD", isActive: false, gatewayConfigId: "gw-1",
    });
    expect((await onBehalfPost()).status).toBe(409);
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it("returns JSON rather than the SPA HTML for a malformed administrator checkout path", async () => {
    const response = await fetch(`${base}/api/ledger/admin-checkout/worker/worker-1`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("Reopen Make payment") });
    expect(mocks.adminAuthority).not.toHaveBeenCalled();
  });

  it("keeps failures structured and safe at preview, creation and status", async () => {
    const sensitive = "private failure body must not reach the browser";
    mocks.adminAuthority.mockRejectedValueOnce(new Error(sensitive));
    const preview = await fetch(onBehalfUrl());
    expect(preview.status).toBe(500);
    expect(JSON.stringify(await preview.json())).not.toContain(sensitive);
    mocks.storage.ledger.paymentAttempts.create.mockRejectedValueOnce(new Error(sensitive));
    const create = await onBehalfPost();
    expect(create.status).toBe(500);
    expect(await create.json()).toMatchObject({ message: expect.stringContaining("unfinished payment status") });
    mocks.storage.ledger.paymentAttempts.get.mockRejectedValueOnce(new Error(sensitive));
    const status = await fetch(`${base}/api/ledger/admin-checkout/sessions/on-behalf-1`);
    expect(status.status).toBe(502);
    expect(await status.json()).toMatchObject({ message: expect.stringContaining("Do not start another payment") });
  });

  it("keeps administrator receipts creator-only and separate from payer and test receipts", async () => {
    retainCreatedAttempt();
    expect((await onBehalfPost()).status).toBe(201);
    gateway.plugin.retrievePayment.mockResolvedValue({ providerRef: "pi-1", status: "created", amountMinor: 10000, currency: "USD" });
    const path = `${base}/api/ledger/admin-checkout/sessions/on-behalf-1`;
    expect((await fetch(path)).status).toBe(200);
    expect((await fetch(`${base}/api/ledger/checkout/sessions/on-behalf-1`)).status).toBe(403);
    expect((await fetch(`${base}/api/ledger/admin-test-checkout/sessions/on-behalf-1`)).status).toBe(403);
    mocks.adminAuthority.mockResolvedValue("other-admin");
    expect((await fetch(path)).status).toBe(403);
    expect((await fetch(`${path}/cancel`, { method: "POST" })).status).toBe(403);
  });

  it("confirms provider cancellation before releasing an administrator payment", async () => {
    retainCreatedAttempt();
    expect((await onBehalfPost()).status).toBe(201);
    const attempt = liveAttempts.get("on-behalf-1");
    attempt.status = "created";
    gateway.plugin.retrievePayment.mockResolvedValue({ providerRef: "pi-1", status: "created", amountMinor: 10000, currency: "USD" });
    gateway.plugin.cancelPayment.mockResolvedValue({ providerRef: "pi-1", status: "canceled", amountMinor: 10000, currency: "USD" });
    mocks.processPaymentEvidence.mockImplementation(async (_id, _gateway, evidence) => {
      if (evidence.type === "payment.canceled") attempt.status = "canceled";
    });
    const response = await fetch(`${base}/api/ledger/admin-checkout/sessions/on-behalf-1/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "on-behalf-1", status: "canceled", isAdminAssisted: true });
    expect(gateway.plugin.cancelPayment).toHaveBeenCalledWith(expect.anything(), "pi-1", { adminAssistedAttemptId: "on-behalf-1" });
  });

  it("does not cancel an administrator payment after provider confirmation has begun", async () => {
    retainCreatedAttempt();
    expect((await onBehalfPost()).status).toBe(201);
    liveAttempts.get("on-behalf-1").status = "created";
    gateway.plugin.retrievePayment.mockResolvedValue({ providerRef: "pi-1", status: "processing", amountMinor: 10000, currency: "USD" });
    const response = await fetch(`${base}/api/ledger/admin-checkout/sessions/on-behalf-1/cancel`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(gateway.plugin.cancelPayment).not.toHaveBeenCalled();
  });
  it("cancels an unconfirmed live administrator payment through the actual Stripe adapter and releases its reservation", async () => {
    const liveConfig = { ...gateway.config, data: { publishableKey: "pk_live_fixture", paymentTypes: ["card"] } };
    mocks.resolve.mockResolvedValue({ ...gateway, config: liveConfig,
      context: { ...gateway.context, apiKey: "sk_live_fixture", config: liveConfig },
      plugin: { ...gateway.plugin, isTestMode: () => false, cancelPayment: stripePaymentGatewayPlugin.cancelPayment } });
    retainCreatedAttempt();
    expect((await onBehalfPost()).status).toBe(201);
    const attempt = liveAttempts.get("on-behalf-1");
    attempt.status = "created";
    const intent = { id: "pi-1", livemode: true, status: "requires_payment_method",
      amount: 10000, currency: "usd", metadata: { attemptId: attempt.id, paymentPurpose: "admin_assisted" } };
    mocks.stripeRetrieve.mockResolvedValue(intent);
    mocks.stripeCancel.mockResolvedValue({ ...intent, status: "canceled" });
    gateway.plugin.retrievePayment.mockResolvedValue({ providerRef: "pi-1", status: "created", amountMinor: 10000, currency: "USD" });
    mocks.processPaymentEvidence.mockImplementation(async (_id, _gateway, evidence) => {
      if (evidence.type === "payment.canceled") attempt.status = "canceled";
    });
    mocks.storage.ledger.paymentAttempts.getReservations.mockImplementation(async () =>
      [...liveAttempts.values()].filter(row => ["created", "requires_action", "processing"].includes(row.status)));
    const before = await (await fetch(onBehalfUrl())).json();
    expect(before.quote.available).toBe("0.00");
    const response = await fetch(`${base}/api/ledger/admin-checkout/sessions/on-behalf-1/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "canceled" });
    expect(mocks.stripeCancel).toHaveBeenCalledWith("pi-1");
    const after = await (await fetch(onBehalfUrl())).json();
    expect(after.quote).toMatchObject({ pendingPayments: "0.00", available: "100.00" });
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledTimes(1);
  });

  it("lists only the acting administrator's on-behalf unfinished payments on the new checkout", async () => {
    mocks.storage.ledger.paymentAttempts.getReservations.mockResolvedValue([
      { id: "owned-admin", createdByUserId: "admin-1", amount: "1.00", currency: "USD", status: "created", metadata: { source: "admin_assisted_checkout" } },
      { id: "owned-old-test", createdByUserId: "admin-1", amount: "1.00", currency: "USD", status: "created", metadata: { source: "admin_test_checkout" } },
      { id: "other-admin", createdByUserId: "admin-2", amount: "1.00", currency: "USD", status: "created", metadata: { source: "admin_assisted_checkout" } },
    ]);
    const response = await fetch(onBehalfUrl());
    expect(response.status).toBe(200);
    expect((await response.json()).pendingCheckouts.map((a: { id: string }) => a.id)).toEqual(["owned-admin"]);
  });

  it("replays the same administrator payment without reserving or creating twice", async () => {
    retainCreatedAttempt();
    expect((await onBehalfPost()).status).toBe(201);
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(liveAttempts.get("on-behalf-1"));
    gateway.plugin.retrievePayment.mockResolvedValue({ providerRef: "pi-1", status: "created", clientSecret: "cs-1" });
    expect((await onBehalfPost()).status).toBe(200);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledTimes(1);
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledTimes(1);
    mocks.adminAuthority.mockResolvedValue("other-admin");
    expect((await onBehalfPost()).status).toBe(409);
  });
  it("refuses retry and status retrieval with changed gateway credentials instead of creating in another mode or account", async () => {
    retainCreatedAttempt();
    expect((await onBehalfPost()).status).toBe(201);
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(liveAttempts.get("on-behalf-1"));
    mocks.resolve.mockResolvedValue({ ...gateway, context: { ...gateway.context, apiKey: "changed-fixture-credentials" } });
    expect((await onBehalfPost()).status).toBe(500);
    expect((await fetch(`${base}/api/ledger/admin-checkout/sessions/on-behalf-1`)).status).toBe(502);
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledTimes(1);
    expect(gateway.plugin.retrievePayment).not.toHaveBeenCalled();
  });
  it("refuses a gateway credential change between preflight and the locked payment insert", async () => {
    mocks.resolve.mockResolvedValueOnce(gateway).mockResolvedValue({
      ...gateway, context: { ...gateway.context, apiKey: "changed-fixture-credentials" },
    });
    const response = await onBehalfPost();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("credentials changed") });
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it.each(["worker", "employer"])("creates a distinct admin test attempt for a %s ledger owner", async entityType => {
    const entityId = `${entityType}-1`;
    mocks.storage.ledger.ea.get.mockResolvedValue({ ...ea, entityType, entityId });
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: [entityType], allowPartial: true, minAmount: 1, paymentTypes: ["card"] } },
    });
    const previewResponse = await fetch(adminTestUrl(`${entityType}/${entityId}/ea-1`));
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({ entityType, entityId, eaId: "ea-1", isAdminTest: true, testMode: true });
    const response = await adminTestPost(adminTestBody(preview, `admin-${entityType}`), `${entityType}/${entityId}/ea-1`);
    expect(response.status).toBe(201);
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      entityType, entityId, workerId: entityType === "worker" ? entityId : null,
      accountId: "acct-1", ledgerEaId: "ea-1", createdByUserId: "admin-1",
      consent: null,
      metadata: expect.objectContaining({
        source: "admin_test_checkout",
        adminTest: expect.objectContaining({
          isAdminTest: true, actorUserId: "admin-1", purpose: "Verify test payment setup",
        }),
      }),
    }));
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: "Admin test payment",
        metadata: expect.objectContaining({ paymentPurpose: "admin_test" }),
      }),
    );
    expect(gateway.plugin.createCustomer).not.toHaveBeenCalled();
  });

  it("denies non-admins from both admin test checkout endpoints", async () => {
    mocks.adminAuthority.mockRejectedValue(new mocks.AuthorityError("Administrator access is required"));
    expect((await fetch(adminTestUrl())).status).toBe(403);
    const response = await adminTestPost(adminTestBody({ quote: { amount: "12.34", statementSelection: [], creditTransfers: [] } }));
    expect(response.status).toBe(403);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it("keeps ordinary checkout subject to payer authorization even for an administrator", async () => {
    mocks.authority.mockRejectedValue(new mocks.AuthorityError("Staff cannot perform online payment actions"));
    const response = await checkout(valid());
    expect(response.status).toBe(403);
    expect(mocks.adminAuthority).not.toHaveBeenCalled();
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it("restricts admin test receipts to their recorded acting administrator", async () => {
    const attempt = {
      id: "admin-test-attempt", entityType: "employer", entityId: "employer-1",
      ledgerEaId: "ea-1", gatewayConfigId: "gw-1", createdByUserId: "admin-1",
      amount: "12.34", currency: "USD", status: "created", providerIntentRef: "pi-test",
      metadata: { source: "admin_test_checkout", adminTest: {
        isAdminTest: true, actorUserId: "admin-1", purpose: "Verify gateway",
      } },
    };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({
      providerRef: "pi-test", status: "created", amountMinor: 1234, currency: "USD",
    });
    const testReceipt = await fetch(`${base}/api/ledger/admin-test-checkout/sessions/${attempt.id}`);
    expect(testReceipt.status).toBe(200);
    expect(await testReceipt.json()).toMatchObject({
      id: attempt.id, entityType: "employer", entityId: "employer-1",
      isAdminTest: true, adminTestPurpose: "Verify gateway",
    });
    expect((await fetch(`${base}/api/ledger/checkout/sessions/${attempt.id}`)).status).toBe(403);
  });

  it.each([
    ["live-mode signal", false],
    ["missing test-mode signal", undefined],
  ])("fails closed for a gateway with a %s before provider creation", async (_label, testMode) => {
    if (testMode === undefined) delete gateway.plugin.isTestMode;
    else gateway.plugin.isTestMode = vi.fn(() => testMode);
    const preview = await fetch(adminTestUrl());
    expect(preview.status).toBe(409);
    const create = await adminTestPost(adminTestBody({ quote: { amount: "12.34", statementSelection: [], creditTransfers: [] } }));
    expect(create.status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createCustomer).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
  });

  it.each(["worker", "employer"])("rejects disabled and incompatible gateway types for %s without reserving $150 or the later $387", async entityType => {
    const entityId = `${entityType}-1`;
    mocks.storage.ledger.ea.get.mockResolvedValue({ ...ea, entityType, entityId });
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: [entityType], paymentTypes: ["card"], minAmount: 1 } },
    });
    for (const configured of [[], ["us_bank_account"]]) {
      mocks.resolve.mockResolvedValue({ ...gateway, config: { ...gateway.config, data: { paymentTypes: configured } } });
      for (const balance of ["150.00", "387.00"]) {
        mocks.storage.ledger.ea.getBalance.mockResolvedValue(balance);
        mocks.storage.ledger.invoices.listForEa.mockResolvedValue([]);
        const preview = await (await fetch(`${base}/api/ledger/checkout/${entityType}/${entityId}/ea-1`)).json();
        expect(preview).toMatchObject({ paymentTypes: [], quote: { postedBalance: balance, pendingPayments: "0.00", available: balance } });
        const response = await checkout(valid({ amount: balance, selection: { mode: "full", invoiceNumbers: [] }, statementSelection: [] }), `${entityType}/${entityId}/ea-1`);
        expect(response.status).toBe(409);
        expect((await response.json()).message).toContain("administrator");
      }
    }
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
    expect(mocks.createPaymentFromRequestBody).not.toHaveBeenCalled();
  });

  it.each(["worker", "employer"])("audits a definite post-save rejection for %s and permits only a deliberate new retry", async entityType => {
    const entityId = `${entityType}-1`;
    mocks.storage.ledger.ea.get.mockResolvedValue({ ...ea, entityType, entityId });
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: [entityType], paymentTypes: ["card"], minAmount: 1 } },
    });
    mocks.storage.ledger.paymentAttempts.create.mockImplementation(async input => {
      const row = { ...input, id: input.idempotencyKey, __created: true };
      liveAttempts.set(row.id, row);
      return row;
    });
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockImplementation(async key => liveAttempts.get(key));
    gateway.plugin.createPaymentSession.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Ask an administrator to enable card payments"));
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("150.00");
    mocks.storage.ledger.invoices.listForEa.mockResolvedValue([]);
    mocks.storage.ledger.paymentAttempts.getReservations.mockImplementation(async () => [...liveAttempts.values()].filter(a => ["created", "requires_action", "processing"].includes(a.status)));
    const body = valid({ amount: "150.00", selection: { mode: "full", invoiceNumbers: [] }, statementSelection: [] });
    const scope = `${entityType}/${entityId}/ea-1`;
    expect((await checkout(body, scope)).status).toBe(409);
    expect(liveAttempts.get("idem-1")).toMatchObject({ status: "failed", failureCode: "method_disabled" });
    expect(mocks.storage.ledger.paymentAttempts.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "payment.initiation_rejected", attemptId: "idem-1", payload: { failureCode: "method_disabled" },
    }));
    const preview = await (await fetch(`${base}/api/ledger/checkout/${scope}`)).json();
    expect(preview.quote).toMatchObject({ postedBalance: "150.00", pendingPayments: "0.00", available: "150.00" });
    expect((await checkout(body, scope)).status).toBe(409);
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledTimes(1);
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("387.00");
    const after = await (await fetch(`${base}/api/ledger/checkout/${scope}`)).json();
    expect(after.quote).toMatchObject({ postedBalance: "387.00", pendingPayments: "0.00", available: "387.00" });
    expect((await checkout({ ...body, amount: "387.00", idempotencyKey: "deliberate-retry" }, scope)).status).toBe(201);
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledTimes(2);
    expect(mocks.createPaymentFromRequestBody).not.toHaveBeenCalled();
  });

  it("rechecks configuration and creation prerequisites before the reserving insert", async () => {
    const preflight = vi.fn(() => { throw new PaymentInitiationRejected("credentials_not_ready", "Configure matching test keys"); });
    mocks.resolve.mockResolvedValue({ ...gateway, plugin: { ...gateway.plugin, validatePaymentSession: preflight } });
    const response = await checkout(valid());
    expect(response.status).toBe(409);
    expect((await response.json()).message).toBe("Configure matching test keys");
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValueOnce(gateway).mockResolvedValue({ ...gateway,
      config: { ...gateway.config, data: { paymentTypes: [] } } });
    const changed = await checkout(valid());
    expect(changed.status).toBe(409);
    expect((await changed.json()).message).toContain("no longer enabled");
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
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
    expect((await checkout(valid({ saveMethod: true, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } }))).status).toBe(409);
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

  it.each(["card", "us_bank_account"] as const)(
    "opens a %s session as created without settling or applying credit",
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
      gateway.plugin.createPaymentSession.mockResolvedValueOnce({
        status: "created", providerRef: "pi-created", clientSecret: "cs-created",
        publicConfig: { publishableKey: "pk_test", paymentTypes: [selected] },
      });
      const response = await checkout(valid({ paymentMethodType: selected }));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        id: "attempt-1", status: "created", ledgerPaymentId: null, clientSecret: "cs-created",
      });
      expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ paymentTypes: [selected] }),
      }));
      expect(mocks.storage.ledger.paymentAttempts.updateStatus).toHaveBeenCalledWith(
        "attempt-1", "created", { providerIntentRef: "pi-created" },
      );
      expect(mocks.processPaymentEvidence).not.toHaveBeenCalled();
      expect(mocks.createPaymentFromRequestBody).not.toHaveBeenCalled();
      expect(mocks.storage.ledger.paymentAttempts.claimLedgerPosting).not.toHaveBeenCalled();
      expect(mocks.storage.ledger.entries.applyCheckoutCreditTransfers).not.toHaveBeenCalled();
    },
  );

  it("reports a provider success awaiting ledger posting on shared receipts and replays", async () => {
    const attempt = {
      id: "attempt-1", workerId: "worker-1", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      saveMethod: false, status: "succeeded", ledgerPaymentId: null, providerIntentRef: "pi-1",
      consent: { version: "v1", text: "Pay now" },
      statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
      metadata: { paymentMethodRef: null, paymentTypes: ["card"],
        checkoutSelection: { mode: "statements", invoiceNumbers: ["INV-1"] } },
    };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({
      status: "succeeded", providerRef: "pi-1", amountMinor: 1234, currency: "USD",
    });
    const receipt = await fetch(`${base}/api/ledger/checkout/sessions/attempt-1`);
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toMatchObject({ status: "succeeded", ledgerPaymentId: null });
    expect(await (await checkout(valid())).json()).toMatchObject({ status: "succeeded", ledgerPaymentId: null });
    const legacy = await fetch(`${base}/api/ledger/payment-attempts/attempt-1`);
    expect(await legacy.json()).toMatchObject({ status: "processing", ledgerPaymentId: null });
  });

  it("shows a verified pending receipt and its separate receipt and clearing dates", async () => {
    const attempt = {
      id: "attempt-1", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      status: "processing", ledgerPaymentId: "payment-1", providerIntentRef: "pi-1",
    };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    mocks.storage.ledger.payments.get.mockResolvedValueOnce({
      status: "pending", dateReceived: new Date("2026-09-01T12:00:00Z"), dateCleared: null,
    }).mockResolvedValueOnce({
      status: "cleared", dateReceived: new Date("2026-09-01T12:00:00Z"),
      dateCleared: new Date("2026-09-05T12:00:00Z"),
    });
    gateway.plugin.retrievePayment.mockResolvedValue({
      status: "processing", providerRef: "pi-1", amountMinor: 1234, currency: "USD",
    });
    const pending = await (await fetch(`${base}/api/ledger/checkout/sessions/attempt-1`)).json();
    expect(pending).toMatchObject({
      paymentStatus: "pending", dateReceived: "2026-09-01T12:00:00.000Z",
      dateCleared: null, ledgerPaymentId: "payment-1",
    });
    const cleared = await (await fetch(`${base}/api/ledger/checkout/sessions/attempt-1`)).json();
    expect(cleared).toMatchObject({
      paymentStatus: "cleared", dateReceived: "2026-09-01T12:00:00.000Z",
      dateCleared: "2026-09-05T12:00:00.000Z",
    });
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
      expect((await response.json()).message).toContain("Your balance remains reserved");
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

  it.each(["card", "us_bank_account"] as const)("saves an explicitly authorized new %s only after the successful settlement path", async paymentMethodType => {
    mocks.storage.ledger.accounts.get.mockResolvedValue({
      id: "acct-1", name: "Health", currencyCode: "USD", isActive: true, gatewayConfigId: "gw-1",
      data: { onlinePayments: { enabled: true, payerTypes: ["worker"], allowPartial: true, minAmount: 1, paymentTypes: ["card", "us_bank_account"] } },
    });
    mocks.resolve.mockResolvedValue({
      ...gateway,
      config: { ...gateway.config, data: { paymentTypes: ["card", "us_bank_account"], publishableKey: "pk_test" } },
      context: { ...gateway.context, apiKey: "sk_test_fixture",
        config: { id: "gw-1", data: { publishableKey: "pk_test_fixture", paymentTypes: ["card", "us_bank_account"] } } },
      plugin: { ...gateway.plugin, validatePaymentSession: stripePaymentGatewayPlugin.validatePaymentSession,
        supportedPaymentTypes: [{ id: "card" }, { id: "us_bank_account" }] },
    });
    const response = await checkout(valid({
      paymentMethodType,
      saveMethod: true,
      saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true },
    }));
    expect(response.status).toBe(201);
    expect(mocks.authority).toHaveBeenCalledWith(expect.anything(), "worker", "worker-1", "methods");
    expect(mocks.storage.ledger.paymentAttempts.create).toHaveBeenCalledWith(expect.objectContaining({
      saveMethod: true,
      consent: expect.objectContaining({ version: "v1", text: "Pay now" }),
      metadata: expect.objectContaining({
        saveMethodConsent: expect.objectContaining({
          version: CHECKOUT_SAVE_METHOD_CONSENT.version,
          text: CHECKOUT_SAVE_METHOD_CONSENT.text,
          accepted: true,
          authorizationType: "save_payment_method",
          textVersion: CHECKOUT_SAVE_METHOD_CONSENT.version,
          acceptedAt: expect.any(String),
        }),
      }),
    }));
    expect(gateway.plugin.createPaymentSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      customerRef: "customer-1", paymentTypes: [paymentMethodType], saveMethod: true,
    }));
  });

  it("rejects missing or mismatched save consent and an incompatible saved method", async () => {
    let invalid = await checkout(valid({ saveMethod: true }));
    expect(invalid.status).toBe(400);
    invalid = await checkout(valid({ saveMethod: false, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } }));
    expect(invalid.status).toBe(400);
    invalid = await checkout(valid({ saveMethod: true, saveMethodConsent: { version: "old", text: "Other copy", accepted: true } }));
    expect(invalid.status).toBe(400);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();

    mocks.authority.mockResolvedValueOnce("user-1").mockImplementationOnce(() => {
      throw new mocks.AuthorityError("Methods access denied");
    });
    const denied = await checkout(valid({ saveMethod: true, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } }));
    expect(denied.status).toBe(403);
    expect(mocks.authority).toHaveBeenLastCalledWith(expect.anything(), "worker", "worker-1", "methods");

    mocks.authority.mockResolvedValue("user-1");
    mocks.resolve.mockResolvedValue({ ...gateway, plugin: { ...gateway.plugin, attachMethod: undefined } });
    const unsupported = await checkout(valid({ saveMethod: true, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } }));
    expect(unsupported.status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(gateway);
    mocks.storage.ledger.paymentMethods.get.mockResolvedValue({
      id: "method-1", isActive: true, entityType: "worker", entityId: "worker-1",
      gatewayConfigId: "gw-1", providerMethodRef: "pm-1",
    });
    gateway.plugin.getMethodSummary.mockResolvedValue({ type: "us_bank_account" });
     const mismatch = await checkout(valid({ paymentMethodId: "method-1", paymentMethodType: undefined }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ message: "Saved payment method type is not enabled" });
  });

  it("binds idempotent checkout replay to the save choice and selected payment type", async () => {
    const existing = {
      id: "idem-1", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      saveMethod: true, status: "requires_action", providerIntentRef: "pi-existing",
      consent: { version: "v1", text: "Pay now" },
      statementSelection: [{ invoiceNumber: "INV-1", amount: "12.34" }],
      metadata: {
        paymentMethodRef: null, paymentTypes: ["card"],
        checkoutSelection: { mode: "statements", invoiceNumbers: ["INV-1"] },
        checkoutQuote: { creditTransfers: [] },
        saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true },
      },
    };
    mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(existing);
    gateway.plugin.retrievePayment.mockResolvedValue({ providerRef: "pi-existing", status: "requires_action", clientSecret: "cs-existing" });
    expect((await checkout(valid({ saveMethod: false }))).status).toBe(409);
    expect((await checkout(valid({
      paymentMethodType: "us_bank_account", saveMethod: true,
      saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true },
    }))).status).toBe(409);
    const replay = await checkout(valid({
      saveMethod: true, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true },
    }));
    expect(replay.status).toBe(200);
    expect(gateway.plugin.createPaymentSession).not.toHaveBeenCalled();
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

  it.each(["card", "us_bank_account"])("allows the creator to cancel a new %s draft, but blocks another authority", async (type) => {
    const attempt = {
      id: "attempt-cancel", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "12.34", currency: "USD",
      status: "created", providerIntentRef: "pi-cancel", metadata: { paymentTypes: [type] },
    };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({
      status: "created", providerRef: "pi-cancel", amountMinor: 1234, currency: "USD",
    });
    gateway.plugin.cancelPayment.mockResolvedValue({
      status: "canceled", providerRef: "pi-cancel", amountMinor: 1234, currency: "USD",
    });
    let response = await fetch(`${base}/api/ledger/checkout/sessions/attempt-cancel`, { method: "GET" });
    expect(response.status).toBe(200);
    mocks.authority.mockResolvedValue("different-user");
    response = await fetch(`${base}/api/ledger/checkout/sessions/attempt-cancel/cancel`, { method: "POST" });
    expect(response.status).toBe(403);
    mocks.authority.mockResolvedValue("user-1");
    mocks.processPaymentEvidence.mockImplementation(async () => {
      mocks.storage.ledger.paymentAttempts.get.mockResolvedValue({ ...attempt, status: "canceled" });
    });
    response = await fetch(`${base}/api/ledger/checkout/sessions/attempt-cancel/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(gateway.plugin.cancelPayment).toHaveBeenCalledWith(expect.anything(), "pi-cancel");
  });

  it("shows only the creator's reserved checkouts, including multiple attempts with zero available", async () => {
    mocks.storage.ledger.ea.getByEntity.mockResolvedValue([ea]);
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("481.00");
    mocks.storage.ledger.paymentAttempts.getReservedAmount.mockResolvedValue(481);
    mocks.storage.ledger.paymentAttempts.getReservations.mockResolvedValue([
      { id: "one", ledgerEaId: "ea-1", amount: "140.00", currency: "USD", status: "created", createdByUserId: "user-1", providerIntentRef: "pi-one" },
      { id: "two", ledgerEaId: "ea-1", amount: "321.00", currency: "USD", status: "created", createdByUserId: "user-1", providerIntentRef: "pi-two" },
      { id: "other", ledgerEaId: "ea-1", amount: "20.00", currency: "USD", status: "processing", createdByUserId: "user-2" },
    ]);
    const response = await fetch(`${base}/api/ledger/pay-accounts/worker/worker-1`);
    expect(await response.json()).toMatchObject([{ available: "0.00", pendingCheckouts: [
      { id: "one", amount: "140.00", canCancel: true },
      { id: "two", amount: "321.00", canCancel: true },
    ] }]);
    mocks.authority.mockResolvedValue("user-2");
    const second = await (await fetch(`${base}/api/ledger/pay-accounts/worker/worker-1`)).json();
    expect(second[0].pendingCheckouts).toEqual([{ id: "other", amount: "20.00", currency: "USD", status: "processing", canCancel: false }]);
  });

  it("refuses cancellation without a reference, after processing, or when the provider changes state", async () => {
    const attempt = { id: "one", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "140.00", currency: "USD",
      status: "created", providerIntentRef: "pi-one" };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    const url = `${base}/api/ledger/checkout/sessions/one/cancel`;
    mocks.authority.mockResolvedValue("user-2");
    expect((await fetch(url, { method: "POST" })).status).toBe(403);
    mocks.authority.mockResolvedValue("user-1");
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue({ ...attempt, providerIntentRef: null });
    expect((await fetch(url, { method: "POST" })).status).toBe(409);
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue({ ...attempt, status: "processing" });
    expect((await fetch(url, { method: "POST" })).status).toBe(409);
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({ status: "processing", providerRef: "pi-one", amountMinor: 14000, currency: "USD" });
    expect((await fetch(url, { method: "POST" })).status).toBe(409);
    expect(gateway.plugin.cancelPayment).not.toHaveBeenCalled();
    expect(mocks.processPaymentEvidence).toHaveBeenCalled();
  });

  it("keeps the reservation on provider refusal, outage, or ambiguous cancellation result", async () => {
    const attempt = { id: "one", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "140.00", currency: "USD",
      status: "created", providerIntentRef: "pi-one" };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({ status: "created", providerRef: "pi-one", amountMinor: 14000, currency: "USD" });
    gateway.plugin.cancelPayment.mockRejectedValueOnce(new Error("provider down")).mockResolvedValueOnce({
      status: "processing", providerRef: "pi-one", amountMinor: 14000, currency: "USD",
    });
    const url = `${base}/api/ledger/checkout/sessions/one/cancel`;
    expect((await fetch(url, { method: "POST" })).status).toBe(502);
    expect((await fetch(url, { method: "POST" })).status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.updateStatus).not.toHaveBeenCalledWith("one", "canceled", expect.anything());
  });

  it("does not report released funds when confirmation races the provider cancellation", async () => {
    const attempt = { id: "one", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "140.00", currency: "USD",
      status: "created", providerIntentRef: "pi-one" };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue(attempt);
    gateway.plugin.retrievePayment.mockResolvedValue({ status: "created", providerRef: "pi-one", amountMinor: 14000, currency: "USD" });
    gateway.plugin.cancelPayment.mockResolvedValue({ status: "canceled", providerRef: "pi-one", amountMinor: 14000, currency: "USD" });
    mocks.processPaymentEvidence.mockImplementation(async () => {
      mocks.storage.ledger.paymentAttempts.get.mockResolvedValue({ ...attempt, status: "succeeded", ledgerPaymentId: "posted" });
    });
    const response = await fetch(`${base}/api/ledger/checkout/sessions/one/cancel`, { method: "POST" });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain("Check the payment status");
  });

  it("rechecks local state under the attempt lock before contacting the provider", async () => {
    const draft = { id: "one", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "140.00", currency: "USD",
      status: "created", providerIntentRef: "pi-one" };
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValueOnce(draft).mockResolvedValueOnce({ ...draft, status: "processing" });
    const response = await fetch(`${base}/api/ledger/checkout/sessions/one/cancel`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(mocks.storage.ledger.paymentAttempts.lockAttempt).toHaveBeenCalledWith("one");
    expect(gateway.plugin.cancelPayment).not.toHaveBeenCalled();
  });

  it("releases only the provider-canceled draft and leaves the other reservation in the server balance", async () => {
    const draft = { id: "one", entityType: "worker", entityId: "worker-1", ledgerEaId: "ea-1",
      gatewayConfigId: "gw-1", createdByUserId: "user-1", amount: "140.00", currency: "USD",
      status: "created", providerIntentRef: "pi-one" };
    let canceled = false;
    mocks.storage.ledger.ea.getByEntity.mockResolvedValue([ea]);
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("461.00");
    mocks.storage.ledger.paymentAttempts.getReservedAmount.mockImplementation(async () => canceled ? 321 : 461);
    mocks.storage.ledger.paymentAttempts.getReservations.mockImplementation(async () => [
      ...(!canceled ? [draft] : []),
      { ...draft, id: "two", amount: "321.00", providerIntentRef: "pi-two" },
    ]);
    mocks.storage.ledger.paymentAttempts.get.mockImplementation(async () => canceled ? { ...draft, status: "canceled" } : draft);
    gateway.plugin.retrievePayment.mockResolvedValue({ status: "created", providerRef: "pi-one", amountMinor: 14000, currency: "USD" });
    gateway.plugin.cancelPayment.mockResolvedValue({ status: "canceled", providerRef: "pi-one", amountMinor: 14000, currency: "USD" });
    mocks.processPaymentEvidence.mockImplementation(async () => { canceled = true; });
    const accounts = () => fetch(`${base}/api/ledger/pay-accounts/worker/worker-1`).then(r => r.json());
    expect((await accounts())[0].available).toBe("0.00");
    const response = await fetch(`${base}/api/ledger/checkout/sessions/one/cancel`, { method: "POST" });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("canceled");
    expect((await accounts())[0]).toMatchObject({ available: "140.00", pendingCheckouts: [{ id: "two", amount: "321.00" }] });
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
      body: JSON.stringify(valid({ saveMethod: true, saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } })),
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
