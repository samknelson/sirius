import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { PaymentGatewayContext } from "../../server/plugins/ledger/payment-gateway/types";

let attempt: any;
const paymentCreate = vi.fn();
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
};
vi.mock("../../server/storage", () => ({
  storage: {
    ledger: {
      paymentAttempts: events,
      paymentMethods: { upsertProviderMethod: methodUpsert },
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
    context: {}, plugin: { retrievePayment: retrieve, cancelPayment: cancel, createPaymentSession: createSession },
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
const success = (overrides: Record<string, unknown> = {}) => ({
  type: "payment.succeeded" as const, providerRef: "ref-1", amountMinor: 10000,
  currency: "USD", methodRef: "pm-1", providerCreated: 100, ...overrides,
});

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
      ] }, statementSelection: [
        { invoiceNumber: "INV-JAN", amount: "60.00" },
        { invoiceNumber: "INV-FEB", amount: "40.00" },
      ],
    };
    paymentCreate.mockImplementation(async (body) => ({
      ok: true, payment: { ...body, id: "payment-1" },
    }));
    allocation.mockResolvedValue([]);
    methodUpsert.mockResolvedValue({ id: "method-1" });
    retrieve.mockResolvedValue({
      providerRef: "ref-1", status: "succeeded", amountMinor: 10000,
      currency: "USD", methodRef: "pm-1",
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

  it.each(["payment.processing", "payment.failed", "payment.canceled"] as const)(
    "does not post on %s", async type => {
      await processPaymentEvidence("attempt-1", "gateway-1", success({ type }));
      expect(paymentCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { gateway: "another-gateway" }, { providerRef: "another-ref" },
    { amountMinor: 10001 }, { currency: "CAD" },
  ])("refuses mismatched gateway, reference, amount and currency: %j", async mismatch => {
    const { gateway, ...event } = mismatch;
    await expect(processPaymentEvidence("attempt-1", gateway ?? "gateway-1", success(event)))
      .rejects.toThrow();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("resumes a failed allocation without completing the attempt", async () => {
    allocation.mockRejectedValueOnce(new Error("injected allocation failure"));
    await expect(processPaymentEvidence("attempt-1", "gateway-1", success())).rejects.toThrow();
    // The real transaction rolls back both payment and claim on this error.
    attempt.ledgerPaymentId = null;
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
      entityType: "worker", entityId: "worker-1", consent: attempt.consent,
    });
    expect(events.setDefaultIfAbsent).toHaveBeenCalledOnce();
  });

  it("recovers a saved method from the signed inbox when provider retrieval omits its reference", async () => {
    attempt.saveMethod = true;
    attempt.ledgerPaymentId = "payment-1";
    attempt.status = "succeeded";
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
    expect(methodUpsert).toHaveBeenCalledWith(expect.objectContaining({
      providerMethodRef: "pm-1", entityId: "worker-1",
    }));
    expect(events.markEventProcessed).toHaveBeenCalledOnce();
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
    expect(paymentCreate).not.toHaveBeenCalled();
    retrieve.mockResolvedValue({ providerRef: "ref-1", status: "failed", amountMinor: 10000, currency: "USD" });
    await recoverOnlinePayments();
    expect(attempt.status).toBe("failed");
    expect(paymentCreate).not.toHaveBeenCalled();
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
    expect(paymentCreate).toHaveBeenCalledTimes(posts ? 1 : 0);
  });
});