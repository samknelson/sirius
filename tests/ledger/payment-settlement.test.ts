import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PaymentInitiationRejected, type PaymentGatewayContext } from "../../server/plugins/ledger/payment-gateway/types";
import { CHECKOUT_SAVE_METHOD_CONSENT } from "../../shared/ledger/checkout-save-consent";
import { ADMIN_PAYMENT_CONFIRMATION } from "../../shared/ledger/admin-payment-confirmation";

const stripeSdk = vi.hoisted(() => ({ retrieve: vi.fn(), cancel: vi.fn() }));
vi.mock("stripe", async importOriginal => {
  const { default: RealStripe } = await importOriginal<typeof import("stripe")>();
  return { default: class {
  paymentIntents = stripeSdk;
  webhooks = new RealStripe("sk_test_fixture").webhooks;
} };
});
vi.mock("../../server/plugins/ledger/payment-gateway/registry", () => ({ registerPaymentGatewayPlugin: vi.fn() }));

let attempt: any;
let ledgerPayment: any;
const paymentCreate = vi.fn();
const paymentGet = vi.fn(async () => ledgerPayment);
const paymentUpdate = vi.fn(async (_id: string, status: string, clearedAt?: Date) => {
  const patch = { status, ...(clearedAt ? { dateCleared: clearedAt } : {}) };
  ledgerPayment = { ...ledgerPayment, ...patch };
  return ledgerPayment;
});
const allocation = vi.fn();
const methodUpsert = vi.fn();
const retrieve = vi.fn();
const cancel = vi.fn();
const createSession = vi.fn();
let configuredTypes: Array<{ id: string; category: string; currencyCode: string; direction: "charge" | "credit" }> = [];
const events = {
  lockEa: vi.fn(),
  lockAttempt: vi.fn(),
  get: vi.fn(async () => ({ ...attempt })),
  claimLedgerPosting: vi.fn(async (_id: string, paymentId: string) => {
    if (attempt.ledgerPaymentId) return false;
    attempt.ledgerPaymentId = paymentId;
    return true;
  }),
  updateStatus: vi.fn(async (_id: string, status: string, fields: any) => {
    Object.assign(attempt, fields, { status });
    return { ...attempt };
  }),
  markMethodSaved: vi.fn(async () => {
    attempt.metadata.methodSavedAt = "now";
  }),
  setDefaultIfAbsent: vi.fn(),
  listPendingEvents: vi.fn(async (): Promise<any[]> => []),
  listForRecovery: vi.fn(async () => [{ ...attempt }]),
  markEventProcessed: vi.fn(),
  markEventError: vi.fn(),
  markEventIgnored: vi.fn(),
  touchRecovery: vi.fn(),
  recordEvent: vi.fn(),
};
vi.mock("../../server/storage", () => ({
  storage: {
    ledger: {
      paymentAttempts: events,
      payments: { get: paymentGet, settleOnline: paymentUpdate,
        update: vi.fn(async () => { throw new Error("Online payments cannot be edited"); }) },
      paymentMethods: { upsertProviderMethod: methodUpsert },
      gatewayCustomers: { get: vi.fn(async () => ({ customerRef: "customer-1" })) },
      invoices: { listForEa: vi.fn(async () => [
        { invoiceNumber: "INV-JAN", year: 2026, month: 1 },
        { invoiceNumber: "INV-FEB", year: 2026, month: 2 },
      ]) },
    },
  },
}));
vi.mock("../../server/storage/transaction-context", () => {
  let serial = Promise.resolve();
  return {
    // Simulates the database's FOR UPDATE serialization for one attempt.
    runInTransaction: (fn: () => Promise<unknown>) => {
      const next = serial.then(fn);
      serial = next.then(() => {}, () => {});
      return next;
    },
  };
});
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: vi.fn(async () => configuredTypes) }),
}));
vi.mock("../../server/modules/ledger/payments", () => ({
  createPaymentFromRequestBody: paymentCreate,
  triggerPaymentChargePlugins: allocation,
}));
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({
  resolveGateway: vi.fn(async () => ({
    config: { id: "gateway-1", data: {} }, context: { apiKey: "fixture" },
    plugin: { id: "fixture", retrievePayment: retrieve, cancelPayment: cancel, createPaymentSession: createSession, isTestMode: () => true },
  })),
}));
vi.mock("../../server/modules/ledger/payment-methods", () => ({
  ensureCustomer: vi.fn(async () => "customer-1"),
}));
vi.mock("../../server/logger", () => ({
  storageLogger: { error: vi.fn() },
}));

const { processPaymentEvidence } = await import("../../server/modules/ledger/payment-settlement");
const { recoverOnlinePayments } = await import("../../server/modules/ledger/payment-recovery");
const { adminPaymentGatewayFingerprint } = await import("../../server/modules/ledger/admin-assisted-payment");
const { stripePaymentGatewayPlugin } = await import("../../server/plugins/ledger/payment-gateway/plugins/stripe");
const success = (overrides: Record<string, unknown> = {}) => ({
  type: "payment.succeeded" as const, providerRef: "ref-1", amountMinor: 10000,
  currency: "USD", methodRef: "pm-1", providerCreated: 100, ...overrides,
});

function markAdminAssisted() {
  attempt.consent = null;
  attempt.createdByUserId = "admin-1";
  attempt.saveMethod = false;
  attempt.metadata = { ...attempt.metadata, source: "admin_assisted_checkout",
    adminAssisted: { actorUserId: "admin-1", gatewayFingerprint: adminPaymentGatewayFingerprint({
      context: { apiKey: "fixture" }, plugin: { id: "fixture" }, config: { id: "gateway-1", data: {} },
    } as any), confirmation: {
      ...ADMIN_PAYMENT_CONFIRMATION, accepted: true, acceptedAt: "2026-11-06T12:00:00.000Z",
    } },
  };
  delete attempt.metadata.saveMethodConsent;
}

describe("online settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredTypes = [{ id: "financial-usd", category: "financial", currencyCode: "USD", direction: "credit" }];
    attempt = {
      id: "attempt-1", gatewayConfigId: "gateway-1", providerIntentRef: "ref-1",
      status: "processing", amount: "100.00", currency: "USD", ledgerEaId: "ea-1",
      accountId: "account-1", entityType: "worker", entityId: "worker-1",
      saveMethod: false, consent: { version: "1", accepted: true },
      metadata: { source: "online_checkout", invoicePeriods: [
        { invoiceNumber: "INV-JAN", statementYmd: "2026-01-01" },
        { invoiceNumber: "INV-FEB", statementYmd: "2026-02-01" },
      ],
        saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true,
          acceptedAt: "2026-01-01T00:00:00.000Z", textVersion: CHECKOUT_SAVE_METHOD_CONSENT.version,
          authorizationType: "save_payment_method" },
      }, statementSelection: [
        { invoiceNumber: "INV-JAN", amount: "60.00" },
        { invoiceNumber: "INV-FEB", amount: "40.00" },
      ],
    };
    ledgerPayment = undefined;
    paymentCreate.mockImplementation(async (body) => {
      ledgerPayment = { ...body, dateReceived: new Date(body.dateReceived),
        dateCleared: body.dateCleared ? new Date(body.dateCleared) : null, id: "payment-1" };
      return { ok: true, payment: ledgerPayment };
    });
    allocation.mockResolvedValue([]);
    methodUpsert.mockResolvedValue({ id: "method-1" });
    retrieve.mockResolvedValue({
      providerRef: "ref-1", status: "succeeded", amountMinor: 10000,
      currency: "USD", methodRef: "pm-1", customerRef: "customer-1", reusableMethod: true,
    });
    cancel.mockReset();
    createSession.mockReset();
  });

  it("posts one cleared payment with the same statement allocation format as manual payments", async () => {
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(paymentCreate.mock.calls[0][0]).toMatchObject({
      status: "cleared", amount: "100.00", paymentType: "financial-usd",
      details: { proposedAllocation: [
        { eaId: "ea-1", amount: "60.00", statementYmd: "2026-01-01" },
        { eaId: "ea-1", amount: "40.00", statementYmd: "2026-02-01" },
      ] },
    });
    expect(allocation).toHaveBeenCalledOnce();
    expect(attempt.ledgerPaymentId).toBe("payment-1");
  });

  it("posts an administrator-assisted payment to the worker ledger once, with separate authorization", async () => {
    markAdminAssisted();
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(paymentCreate.mock.calls[0][0]).toMatchObject({
      ledgerEaId: "ea-1", status: "cleared", amount: "100.00",
      memo: "Administrator payment on behalf of worker",
      details: { adminAssisted: true, adminActorUserId: "admin-1",
        adminConfirmation: { ...ADMIN_PAYMENT_CONFIRMATION, accepted: true },
        proposedAllocation: [
          { eaId: "ea-1", amount: "60.00", statementYmd: "2026-01-01" },
          { eaId: "ea-1", amount: "40.00", statementYmd: "2026-02-01" },
        ],
      },
    });
    expect(methodUpsert).not.toHaveBeenCalled();
    expect(attempt.consent).toBeNull();
  });
  it("recovers an uncertain administrator-assisted creation using the same idempotent payment contract", async () => {
    markAdminAssisted();
    attempt.providerIntentRef = null;
    attempt.status = "requires_action";
    attempt.failureCode = "creation_uncertain";
    attempt.metadata.paymentTypes = ["card"];
    createSession.mockResolvedValueOnce({ providerRef: "ref-1", status: "processing" });
    retrieve.mockResolvedValueOnce({ providerRef: "ref-1", status: "succeeded",
      amountMinor: 10000, currency: "USD", methodRef: "pm-admin" });
    expect((await recoverOnlinePayments()).failures).toBe(0);
    expect(createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: "attempt-1", saveMethod: false, customerRef: undefined,
      description: "Administrator payment on behalf of worker",
      metadata: expect.objectContaining({ paymentPurpose: "admin_assisted" }),
    }));
    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      ledgerEaId: "ea-1", details: expect.objectContaining({ adminAssisted: true }),
    }), { requireAccountId: "account-1" });
  });
  it.each(["actor", "confirmation", "source", "payer-consent", "saving", "owner"])(
    "refuses damaged administrator %s provenance in settlement and recovery", async damage => {
      markAdminAssisted();
      if (damage === "actor") attempt.metadata.adminAssisted.actorUserId = "other-admin";
      if (damage === "confirmation") attempt.metadata.adminAssisted.confirmation.accepted = false;
      if (damage === "source") attempt.metadata.source = "online_checkout";
      if (damage === "payer-consent") attempt.consent = { accepted: true };
      if (damage === "saving") attempt.saveMethod = true;
      if (damage === "owner") attempt.entityType = "employer";
      await expect(processPaymentEvidence("attempt-1", "gateway-1", success())).rejects.toThrow("provenance");
      expect((await recoverOnlinePayments()).failures).toBe(1);
      expect(createSession).not.toHaveBeenCalled();
      expect(retrieve).not.toHaveBeenCalled();
      expect(paymentCreate).not.toHaveBeenCalled();
    },
  );
  it("does not recover an administrator attempt with changed credentials", async () => {
    markAdminAssisted();
    attempt.providerIntentRef = null;
    attempt.metadata.adminAssisted.gatewayFingerprint = "a".repeat(64);
    expect((await recoverOnlinePayments()).failures).toBe(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("marks admin test settlement and retains the admin actor and purpose separately from payer consent", async () => {
    attempt.metadata = {
      source: "admin_test_checkout",
      adminTest: { isAdminTest: true, actorUserId: "admin-1", purpose: "Verify gateway", confirmedAt: "2026-11-06T12:00:00Z" },
      invoicePeriods: [{ invoiceNumber: "INV-JAN", statementYmd: "2026-01-01" }],
    };
    attempt.statementSelection = [{ invoiceNumber: "INV-JAN", amount: "100.00" }];
    attempt.consent = null;
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate.mock.calls[0][0]).toMatchObject({
      memo: "Admin test payment",
      details: {
        adminTest: true, adminTestPurpose: "Verify gateway",
        adminTestActorUserId: "admin-1", providerTestMode: true,
      },
    });
    expect(attempt.consent).toBeNull();
  });

  it("refuses to settle an admin test attempt if its gateway no longer proves test mode", async () => {
    attempt.metadata = {
      source: "admin_test_checkout",
      adminTest: { isAdminTest: true, actorUserId: "admin-1", purpose: "Verify gateway" },
    };
    const { resolveGateway } = await import("../../server/modules/ledger/payment-gateway-context");
    vi.mocked(resolveGateway).mockResolvedValueOnce({
      context: {}, plugin: { isTestMode: () => false },
    } as any);
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success()))
      .rejects.toThrow("no longer confirms test mode");
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("refuses settlement when admin-test source and marker do not match", async () => {
    attempt.metadata = {
      source: "admin_test_checkout",
      adminTest: { isAdminTest: false, actorUserId: "admin-1", purpose: "Verify gateway" },
    };
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success()))
      .rejects.toThrow("provenance is invalid");
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("ignores a preferred charge-directed type when recording received funds", async () => {
    configuredTypes.unshift({ id: "charge-usd", category: "financial", currencyCode: "USD", direction: "charge" });
    attempt.metadata.ledgerPaymentTypeId = "charge-usd";
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate.mock.calls[0][0].paymentType).toBe("financial-usd");
  });

  it("settles the immutable COBRA selection exactly once without allocating unrelated statements", async () => {
    attempt.amount = "267.35";
    attempt.statementSelection = [{ invoiceNumber: "2163-COBRA-202609", amount: "267.35" }];
    attempt.metadata = {
      saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true,
        acceptedAt: "2026-01-01T00:00:00.000Z", textVersion: CHECKOUT_SAVE_METHOD_CONSENT.version,
        authorizationType: "save_payment_method" },
      invoicePeriods: [{ invoiceNumber: "2163-COBRA-202609", statementYmd: "2026-09-01" }],
      checkoutQuote: { unstatementedAmount: "0.00" },
    };
    await processPaymentEvidence("attempt-1", "gateway-1", success({ amountMinor: 26735 }));
    await processPaymentEvidence("attempt-1", "gateway-1", success({ amountMinor: 26735 }));
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(paymentCreate.mock.calls[0][0].details.proposedAllocation).toEqual([
      { eaId: "ea-1", amount: "267.35", statementYmd: "2026-09-01" },
    ]);
    expect(events.lockEa).toHaveBeenCalledWith("ea-1");
  });

  it("preserves full balance unstatemented remainder alongside immutable statement periods", async () => {
    attempt.statementSelection = [{ invoiceNumber: "INV-JAN", amount: "60.00" }];
    attempt.metadata.checkoutQuote = { unstatementedAmount: "40.00" };
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate.mock.calls[0][0].details.proposedAllocation).toEqual([
      { eaId: "ea-1", amount: "60.00", statementYmd: "2026-01-01" },
      { eaId: "ea-1", amount: "40.00", statementYmd: "" },
    ]);
  });

  it("refuses malformed selection snapshots rather than redirecting funds", async () => {
    attempt.metadata.checkoutQuote = { unstatementedAmount: "10.00" };
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success())).rejects.toThrow("allocation total");
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("does not insert two payments for concurrent confirmations", async () => {
    await Promise.all([
      processPaymentEvidence("attempt-1", "gateway-1", success()),
      processPaymentEvidence("attempt-1", "gateway-1", success()),
    ]);
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(allocation).toHaveBeenCalledOnce();
  });

  it("records processing without credit then clears the same payment on success", async () => {
    attempt.status = "requires_action";
    attempt.saveMethod = true;
    await processPaymentEvidence("attempt-1", "gateway-1", success({ type: "payment.processing", providerCreated: 90 }));
    const received = ledgerPayment.dateReceived;
    expect(ledgerPayment).toMatchObject({ status: "pending", dateCleared: null });
    expect(allocation).not.toHaveBeenCalled();
    expect(methodUpsert).not.toHaveBeenCalled();
    await processPaymentEvidence("attempt-1", "gateway-1", success({ type: "payment.processing", providerCreated: 90 }));
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(paymentUpdate).toHaveBeenCalledWith("payment-1", "cleared", expect.any(Date));
    expect(ledgerPayment.dateReceived).toEqual(received);
    expect(ledgerPayment.dateCleared).toBeInstanceOf(Date);
    expect(allocation).toHaveBeenCalledOnce();
    expect(methodUpsert).toHaveBeenCalledOnce();
    expect(methodUpsert).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "worker", entityId: "worker-1",
      consent: expect.objectContaining({
        authorizationType: "save_payment_method",
        textVersion: CHECKOUT_SAVE_METHOD_CONSENT.version,
        text: CHECKOUT_SAVE_METHOD_CONSENT.text,
      }),
    }));
    expect(allocation.mock.calls[0][0].dateReceived).toEqual(received);
    await processPaymentEvidence("attempt-1", "gateway-1", success({ type: "payment.processing", providerCreated: 90 }));
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentUpdate).toHaveBeenCalledOnce();
    expect(allocation).toHaveBeenCalledOnce();
  });

  it("refuses to settle a pending payment whose allocation was changed", async () => {
    attempt.status = "requires_action";
    await processPaymentEvidence("attempt-1", "gateway-1", success({ type: "payment.processing", providerCreated: 90 }));
    ledgerPayment.details.proposedAllocation[0].statementYmd = "2026-03-01";
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success()))
      .rejects.toThrow("differs from checkout snapshot");
    expect(ledgerPayment.status).toBe("pending");
    expect(allocation).not.toHaveBeenCalled();
  });

  it.each(["payment.failed", "payment.canceled"] as const)(
    "closes pending without allocating on %s", async type => {
      attempt.status = "requires_action";
      attempt.saveMethod = true;
      await processPaymentEvidence("attempt-1", "gateway-1", success({ type: "payment.processing", providerCreated: 90 }));
      await processPaymentEvidence("attempt-1", "gateway-1", success({ type }));
      expect(ledgerPayment.status).toBe(type === "payment.failed" ? "error" : "canceled");
      expect(ledgerPayment.dateCleared).toBeNull();
      expect(allocation).not.toHaveBeenCalled();
      expect(methodUpsert).not.toHaveBeenCalled();
      expect(attempt.status).toBe(type === "payment.failed" ? "failed" : "canceled");
    },
  );

  it.each([
    { gateway: "another-gateway" }, { providerRef: "another-ref" },
    { amountMinor: 10001 }, { currency: "CAD" }, { customerRef: "wrong-customer" },
  ])("refuses mismatched gateway, reference, amount and currency: %j", async mismatch => {
    const { gateway, ...event } = mismatch;
    await expect(processPaymentEvidence("attempt-1", gateway ?? "gateway-1", success(event)))
      .rejects.toThrow();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it.each([false, true])("reconciles signed Stripe ACH processing→success with save consent %s", async save => {
    attempt.status = "requires_action";
    attempt.saveMethod = save;
    attempt.amount = "25.00";
    attempt.statementSelection = [{ invoiceNumber: "INV-JAN", amount: "25.00" }];
    retrieve.mockResolvedValue({
      providerRef: "ref-1", status: "succeeded", amountMinor: 2500, currency: "USD",
      methodRef: "pm-bank", customerRef: "customer-1", reusableMethod: true,
      methodType: "us_bank_account",
    });
    const ctx = { apiKey: "sk_test_fixture", webhookSecret: "whsec_fixture",
      config: { id: "gateway-1", data: {} } } as PaymentGatewayContext;
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = (status: string, created: number) => {
      const body = Buffer.from(JSON.stringify({
        id: `evt-${status}`, type: `payment_intent.${status}`, created,
        data: { object: { object: "payment_intent", id: "ref-1", status,
          amount: 2500, currency: "usd", customer: "customer-1",
          payment_method: "pm-bank", metadata: { attemptId: attempt.id } } },
      }));
      const signature = createHmac("sha256", ctx.webhookSecret!).update(`${timestamp}.${body}`).digest("hex");
      return { body, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } };
    };
    const processing = signed("processing", timestamp - 10);
    expect(() => stripePaymentGatewayPlugin.verifyWebhook!(ctx, processing.body, {
      "stripe-signature": `t=${timestamp},v1=invalid`,
    })).toThrow();
    expect(paymentCreate).not.toHaveBeenCalled();
    const apply = async (event: ReturnType<typeof signed>) =>
      processPaymentEvidence(attempt.id, "gateway-1", stripePaymentGatewayPlugin.verifyWebhook!(ctx, event.body, event.headers));
    await apply(processing);
    const received = ledgerPayment.dateReceived;
    const intended = structuredClone(ledgerPayment.details.proposedAllocation);
    expect(ledgerPayment.status).toBe("pending");
    expect(methodUpsert).not.toHaveBeenCalled();
    // A transient reconciliation failure keeps the same pending payment.
    retrieve.mockRejectedValueOnce(new Error("temporary provider outage"));
    expect((await recoverOnlinePayments()).failures).toBe(1);
    expect(ledgerPayment.status).toBe("pending");
    const succeeded = signed("succeeded", timestamp);
    await apply(succeeded);
    await apply(succeeded);
    await apply(processing);
    await apply(signed("canceled", timestamp + 1));
    expect(ledgerPayment).toMatchObject({ id: "payment-1", status: "cleared", amount: "25.00", dateReceived: received });
    expect(ledgerPayment.details.proposedAllocation).toEqual(intended);
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(paymentUpdate).toHaveBeenCalledOnce();
    expect(allocation).toHaveBeenCalledOnce();
    expect(methodUpsert).toHaveBeenCalledTimes(save ? 1 : 0);
    expect(createSession).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("resumes a failed allocation without completing the attempt", async () => {
    allocation.mockRejectedValueOnce(new Error("injected allocation failure"));
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success())).rejects.toThrow();
    // The real transaction rolls back both payment and claim on this error.
    attempt.ledgerPaymentId = null;
    ledgerPayment = undefined;
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(allocation).toHaveBeenCalledTimes(2);
    expect(attempt.status).toBe("succeeded");
  });

  it("replays method saving after posting without re-posting or changing absent opt-in", async () => {
    attempt.saveMethod = true;
    methodUpsert.mockRejectedValueOnce(new Error("injected method failure"));
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success())).rejects.toThrow();
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(methodUpsert).toHaveBeenCalledTimes(2);
    expect(methodUpsert.mock.calls[1][0]).toMatchObject({
      entityType: "worker", entityId: "worker-1",
      consent: expect.objectContaining({
        authorizationType: "save_payment_method",
        text: CHECKOUT_SAVE_METHOD_CONSENT.text,
      }),
    });
    expect(events.setDefaultIfAbsent).toHaveBeenCalledOnce();
  });

  it("retains an unfinished save when provider retrieval cannot confirm the inbox method", async () => {
    attempt.saveMethod = true;
    attempt.ledgerPaymentId = "payment-1";
    attempt.status = "succeeded";
    ledgerPayment = { id: "payment-1", ledgerEaId: "ea-1", status: "cleared",
      amount: "100.00", paymentType: "financial-usd", dateReceived: new Date(),
      details: { paymentAttemptId: "attempt-1", proposedAllocation: [
        { eaId: "ea-1", amount: "60.00", statementYmd: "2026-01-01" },
        { eaId: "ea-1", amount: "40.00", statementYmd: "2026-02-01" },
      ] } };
    retrieve.mockResolvedValue({
      providerRef: "ref-1", status: "succeeded", amountMinor: 10000, currency: "USD",
    });
    events.listPendingEvents.mockResolvedValueOnce([{
      attemptId: attempt.id, gatewayConfigId: attempt.gatewayConfigId,
      providerEventId: "event-1", receivedAt: new Date(Date.now() - 60_000),
      payload: { type: "payment.succeeded", providerRef: "ref-1", methodRef: "pm-1" },
    }]);
    events.listForRecovery.mockResolvedValueOnce([]);
    await recoverOnlinePayments();
    expect(methodUpsert).not.toHaveBeenCalled();
    expect(events.markEventProcessed).not.toHaveBeenCalled();
    expect(events.markEventError).toHaveBeenCalledOnce();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("never lets a stale failure undo confirmed funds", async () => {
    await processPaymentEvidence("attempt-1", "gateway-1", success());
    expect(await processPaymentEvidence("attempt-1", "gateway-1", success({
      type: "payment.failed", providerCreated: 99,
    }))).toBe("stale");
    expect(attempt.status).toBe("succeeded");
    expect(paymentCreate).toHaveBeenCalledOnce();
  });

  it("recovers a missed card confirmation without a webhook", async () => {
    attempt.status = "requires_action";
    expect((await recoverOnlinePayments()).attempts).toBe(1);
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(attempt.status).toBe("succeeded");
  });

  it("keeps ACH processing reserved, then settles or releases it on provider outcome", async () => {
    retrieve.mockResolvedValueOnce({ providerRef: "ref-1", status: "processing", amountMinor: 10000, currency: "USD" })
      .mockResolvedValueOnce({ providerRef: "ref-1", status: "processing", amountMinor: 10000, currency: "USD" });
    await recoverOnlinePayments();
    expect(attempt.status).toBe("processing");
    expect(ledgerPayment.status).toBe("pending");
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(allocation).not.toHaveBeenCalled();
    retrieve.mockResolvedValue({ providerRef: "ref-1", status: "failed", amountMinor: 10000, currency: "USD" });
    await recoverOnlinePayments();
    expect(attempt.status).toBe("failed");
    expect(ledgerPayment.status).toBe("error");
    expect(allocation).not.toHaveBeenCalled();
  });

  it("saves a bank method only when ACH recovery later confirms success", async () => {
    attempt.saveMethod = true;
    retrieve.mockResolvedValueOnce({ providerRef: "ref-1", status: "processing", amountMinor: 10000, currency: "USD" })
      .mockResolvedValueOnce({ providerRef: "ref-1", status: "processing", amountMinor: 10000, currency: "USD" });
    await recoverOnlinePayments();
    expect(attempt.status).toBe("processing");
    expect(methodUpsert).not.toHaveBeenCalled();

    retrieve.mockResolvedValue({ providerRef: "ref-1", status: "succeeded", amountMinor: 10000,
      currency: "USD", methodRef: "pm-ach", methodType: "us_bank_account", customerRef: "customer-1", reusableMethod: true });
    await recoverOnlinePayments();
    expect(attempt.status).toBe("succeeded");
    expect(ledgerPayment.status).toBe("cleared");
    expect(methodUpsert).toHaveBeenCalledOnce();
    expect(methodUpsert).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "worker", entityId: "worker-1", providerMethodRef: "pm-ach",
      consent: expect.objectContaining({
        authorizationType: "save_payment_method",
        textVersion: CHECKOUT_SAVE_METHOD_CONSENT.version,
      }),
    }));
  });

  it("does not release an old created payment when cancellation loses a race", async () => {
    attempt.status = "created";
    attempt.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    retrieve.mockResolvedValue({ providerRef: "ref-1", status: "requires_action", amountMinor: 10000, currency: "USD" });
    cancel.mockRejectedValue(new Error("already processing"));
    await recoverOnlinePayments();
    expect(attempt.status).toBe("requires_action");
    expect(paymentCreate).not.toHaveBeenCalled();
    retrieve.mockResolvedValue({ providerRef: "ref-1", status: "succeeded", amountMinor: 10000, currency: "USD" });
    await recoverOnlinePayments();
    expect(paymentCreate).toHaveBeenCalledOnce();
  });
  it("expires an old unconfirmed live administrator payment only after actual Stripe cancellation confirms it", async () => {
    markAdminAssisted();
    attempt.status = "created";
    attempt.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const config = { id: "gateway-1", data: { publishableKey: "pk_live_fixture" } };
    const resolved = { config, context: { apiKey: "sk_live_fixture", config },
      plugin: { ...stripePaymentGatewayPlugin, retrievePayment: retrieve } };
    attempt.metadata.adminAssisted.gatewayFingerprint = adminPaymentGatewayFingerprint(resolved as any);
    const { resolveGateway } = await import("../../server/modules/ledger/payment-gateway-context");
    vi.mocked(resolveGateway).mockResolvedValueOnce(resolved as any);
    retrieve.mockResolvedValue({ providerRef: "ref-1", status: "created", amountMinor: 10000, currency: "USD" });
    const providerIntent = { id: "ref-1", status: "requires_payment_method", amount: 10000,
      currency: "usd", livemode: true, metadata: { paymentPurpose: "admin_assisted", attemptId: "attempt-1" } };
    stripeSdk.retrieve.mockReset().mockResolvedValue(providerIntent);
    stripeSdk.cancel.mockReset().mockResolvedValue({ ...providerIntent, status: "canceled" });
    expect((await recoverOnlinePayments()).failures).toBe(0);
    expect(stripeSdk.cancel).toHaveBeenCalledWith("ref-1");
    expect(attempt.status).toBe("expired");
    expect(events.updateStatus).toHaveBeenCalledWith("attempt-1", "canceled", expect.anything());
    expect(events.updateStatus).toHaveBeenCalledWith("attempt-1", "expired", expect.anything());
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("recovers a provider reference lost after checkout creation with the same session id", async () => {
    attempt.providerIntentRef = null;
    attempt.status = "requires_action";
    createSession.mockResolvedValue({ providerRef: "ref-1", status: "succeeded" });
    await recoverOnlinePayments();
    expect(createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: "attempt-1", amountMinor: 10000,
    }));
    expect(attempt.providerIntentRef).toBe("ref-1");
    expect(paymentCreate).toHaveBeenCalledOnce();
  });

  it("recovers an admin test attempt using the same test-mode idempotency contract", async () => {
    attempt.providerIntentRef = null;
    attempt.status = "requires_action";
    attempt.failureCode = "creation_uncertain";
    attempt.metadata = {
      source: "admin_test_checkout",
      adminTest: { isAdminTest: true, actorUserId: "admin-1", purpose: "Verify gateway" },
      paymentTypes: ["card"],
      invoicePeriods: [{ invoiceNumber: "INV-JAN", statementYmd: "2026-01-01" }],
    };
    attempt.statementSelection = [{ invoiceNumber: "INV-JAN", amount: "100.00" }];
    createSession.mockResolvedValue({ providerRef: "ref-1", status: "succeeded" });
    await recoverOnlinePayments();
    expect(createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: "attempt-1", description: "Admin test payment",
      metadata: expect.objectContaining({ paymentPurpose: "admin_test" }),
    }));
    expect(paymentCreate.mock.calls[0][0]).toMatchObject({
      memo: "Admin test payment", details: { adminTest: true, adminTestActorUserId: "admin-1" },
    });
  });

  it("does not recover or create an admin test payment after test mode is no longer verified", async () => {
    attempt.providerIntentRef = null;
    attempt.status = "requires_action";
    attempt.failureCode = "creation_uncertain";
    attempt.metadata = {
      source: "admin_test_checkout",
      adminTest: { isAdminTest: true, actorUserId: "admin-1", purpose: "Verify gateway" },
      paymentTypes: ["card"],
    };
    const { resolveGateway } = await import("../../server/modules/ledger/payment-gateway-context");
    vi.mocked(resolveGateway).mockResolvedValueOnce({
      context: {}, plugin: { retrievePayment: retrieve, createPaymentSession: createSession, isTestMode: () => false },
    } as any);
    expect((await recoverOnlinePayments()).failures).toBe(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("does not release a lost create response when current gateway configuration rejects recovery", async () => {
    attempt.status = "requires_action";
    attempt.providerIntentRef = null;
    attempt.failureCode = "creation_uncertain";
    attempt.metadata.paymentTypes = ["card"];
    createSession.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Card was disabled later"));
    expect((await recoverOnlinePayments()).failures).toBe(1);
    expect(attempt).toMatchObject({ status: "requires_action", providerIntentRef: null, failureCode: "creation_uncertain" });
    expect(paymentCreate).not.toHaveBeenCalled();
    createSession.mockResolvedValueOnce({ providerRef: "ref-1", status: "created", clientSecret: "secret", publicConfig: {} });
    await recoverOnlinePayments();
    expect(createSession.mock.calls.every(([, input]) => input.sessionId === "attempt-1")).toBe(true);
    expect(attempt.status).toBe("succeeded");
    expect(paymentCreate).toHaveBeenCalledOnce();
  });

  it("audits a first-call recovery refusal but does not recreate that rejected payment later", async () => {
    attempt.status = "requires_action";
    attempt.providerIntentRef = null;
    attempt.failureCode = "creation_not_started";
    attempt.metadata.paymentTypes = ["card"];
    createSession.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Card is disabled"));
    await recoverOnlinePayments();
    expect(attempt.status).toBe("failed");
    expect(events.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "payment.initiation_rejected" }));
    // Storage excludes this row in real scans; even a stale scan cannot create.
    await recoverOnlinePayments();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["card", "succeeded", true],
    ["card", "failed", false],
    ["us_bank_account", "processing", false],
    ["us_bank_account", "failed", false],
    ["us_bank_account", "succeeded", true],
  ] as const)("settles signed dummy %s %s evidence", async (method, outcome, posts) => {
    const { dummyPaymentGatewayPlugin } = await import("../../server/plugins/ledger/payment-gateway/plugins/dummy");
    const ctx = { apiKey: "", webhookSecret: "test-only-webhook-key",
      config: { id: "gateway-1", data: { paymentTypes: [method] } } } as PaymentGatewayContext;
    const session = await dummyPaymentGatewayPlugin.createPaymentSession!(ctx, {
      sessionId: `attempt-${method}-${outcome}`, amountMinor: 10000, currency: "USD",
      saveMethod: false, paymentTypes: [method], description: "Test settlement",
      metadata: { dummyOutcome: outcome },
    });
    attempt.providerIntentRef = session.providerRef;
    const raw = Buffer.from(JSON.stringify({
      eventId: `evt-${method}-${outcome}`, type: `payment.${outcome}`,
      providerRef: session.providerRef,
    }));
    const signature = createHmac("sha256", ctx.webhookSecret!).update(raw).digest("hex");
    expect(() => dummyPaymentGatewayPlugin.verifyWebhook!(ctx, raw, {
      "x-dummy-signature": "invalid",
    })).toThrow();
    expect(paymentCreate).not.toHaveBeenCalled();
    const verified = dummyPaymentGatewayPlugin.verifyWebhook!(ctx, raw, {
      "x-dummy-signature": signature,
    });
    await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, verified);
    expect(paymentCreate).toHaveBeenCalledTimes(posts || outcome === "processing" ? 1 : 0);
    expect(allocation).toHaveBeenCalledTimes(posts ? 1 : 0);
  });
});
