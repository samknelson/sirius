import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerPaymentAttempt } from "@shared/schema";
import { PaymentInitiationRejected } from "../../server/plugins/ledger/payment-gateway/types";

const mocks = vi.hoisted(() => ({
  row: {} as any,
  create: vi.fn(), retrieve: vi.fn(),
  audit: vi.fn(), processed: vi.fn(), lockEa: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { ledger: { paymentAttempts: {
    lockAttempt: vi.fn(),
    lockEa: mocks.lockEa,
    get: vi.fn(async () => ({ ...mocks.row })),
    updateStatus: mocks.update,
    recordEvent: mocks.audit,
    markEventProcessed: mocks.processed,
  } } },
}));
vi.mock("../../server/storage/transaction-context", () => {
  let serial = Promise.resolve();
  return { runInTransaction: (fn: () => Promise<unknown>) => {
    const next = serial.then(fn);
    serial = next.then(() => {}, () => {});
    return next;
  } };
});
const { initiatePayment } = await import("../../server/modules/ledger/payment-initiation");
const resolved = {
  config: { data: { paymentTypes: ["card"] } }, context: {},
  plugin: { createPaymentSession: mocks.create, retrievePayment: mocks.retrieve },
} as any;
const args = { sessionId: "attempt", amountMinor: 15000, currency: "USD", saveMethod: false,
  paymentTypes: ["card"], description: "Ledger payment", metadata: { attemptId: "attempt" } };
const session = { providerRef: "pi-existing", status: "created", clientSecret: "safe-secret", publicConfig: { paymentTypes: ["card"] } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = { id: "attempt", ledgerEaId: "ea", gatewayConfigId: "gw", status: "requires_action",
    amount: "150.00", currency: "USD", providerIntentRef: null, ledgerPaymentId: null, failureCode: null };
  mocks.create.mockReset().mockResolvedValue(session);
  mocks.retrieve.mockReset().mockImplementation(async (_ctx, ref) => ({ ...session, providerRef: ref }));
  mocks.update.mockReset().mockImplementation(async (_id, status, fields) => {
    Object.assign(mocks.row, fields, { status });
    return { ...mocks.row };
  });
});
const start = (fresh = false) => initiatePayment(mocks.row as LedgerPaymentAttempt, resolved, args, fresh);

describe("payment initiation failure boundary", () => {
  it("commits its provider-entry fence before calling the provider", async () => {
    mocks.create.mockImplementationOnce(async () => {
      expect(mocks.row.failureCode).toBe("creation_started");
      return session;
    });
    await start(true);
    expect(mocks.row).toMatchObject({ status: "created", providerIntentRef: "pi-existing", failureCode: null });
  });

  it("records safe rejection once and prevents recovery after configuration is enabled", async () => {
    mocks.create.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Enable card payments"));
    await expect(start(true)).rejects.toBeInstanceOf(PaymentInitiationRejected);
    expect(mocks.row).toMatchObject({ status: "failed", failureCode: "method_disabled", providerIntentRef: null, ledgerPaymentId: null });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "payment.initiation_rejected", providerEventId: "initiation-rejected:attempt",
    }));
    expect(mocks.processed).toHaveBeenCalledWith("gw", "initiation-rejected:attempt");
    await expect(start()).rejects.toThrow("has ended");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("Timeout"), Object.assign(new Error("HTTP 400"), { statusCode: 400 }),
    Object.assign(new Error("Lost response"), { code: "method_disabled" })])("keeps untyped errors reserved regardless of message or HTTP status: %s", async cause => {
    mocks.create.mockRejectedValueOnce(cause);
    await expect(start(true)).rejects.toThrow("remains reserved");
    expect(mocks.row).toMatchObject({ status: "requires_action", failureCode: "creation_uncertain", providerIntentRef: null });
    expect(mocks.audit).not.toHaveBeenCalled();
    mocks.create.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Configuration was disabled later"));
    await expect(start()).rejects.toThrow("remains reserved");
    expect(mocks.row.status).toBe("requires_action");
    await start();
    expect(mocks.create.mock.calls.every(([, input]) => input.sessionId === "attempt")).toBe(true);
    expect(mocks.row.providerIntentRef).toBe("pi-existing");
  });

  it("retains historical no-reference attempts when current configuration rejects recovery", async () => {
    mocks.create.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Disabled now"));
    await expect(start()).rejects.toThrow("remains reserved");
    expect(mocks.row.status).toBe("requires_action");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("audits a definite recovery rejection when a new attempt proves provider entry never started", async () => {
    mocks.row.failureCode = "creation_not_started";
    mocks.create.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Enable card payments"));
    await expect(start()).rejects.toBeInstanceOf(PaymentInitiationRejected);
    expect(mocks.row.status).toBe("failed");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    await expect(start()).rejects.toThrow("has ended");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("keeps a committed entry fence reserved after a process crash, even for a late fresh caller", async () => {
    mocks.row.failureCode = "creation_started";
    mocks.create.mockRejectedValueOnce(new PaymentInitiationRejected("method_disabled", "Disabled after crash"));
    await expect(start(true)).rejects.toThrow("remains reserved");
    expect(mocks.row.status).toBe("requires_action");
  });

  it("serializes concurrent initial creation and recovery without issuing two create calls", async () => {
    const results = await Promise.all([start(true), start()]);
    expect(results.map(r => r.providerRef)).toEqual(["pi-existing", "pi-existing"]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.row.status).toBe("created");
  });

  it.each(["processing", "succeeded"])("does not reject or recreate concurrent webhook progress to %s", async status => {
    // The webhook wins the lifecycle lock before the creation request.
    mocks.row.status = status;
    mocks.row.providerIntentRef = "pi-webhook";
    mocks.row.ledgerPaymentId = "ledger-payment";
    mocks.retrieve.mockResolvedValueOnce({ ...session, status, providerRef: "pi-webhook" });
    expect(await start(true)).toMatchObject({ status, providerRef: "pi-webhook" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.row.ledgerPaymentId).toBe("ledger-payment");
  });

  it("does not reopen provider-confirmed cancellation", async () => {
    mocks.row.status = "canceled";
    mocks.row.providerIntentRef = "pi-canceled";
    await expect(start(true)).rejects.toThrow("has ended");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
