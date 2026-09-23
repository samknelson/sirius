import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  resolveGateway: vi.fn(),
  optionList: vi.fn(),
  storage: {
    workers: { getWorker: vi.fn() },
    ledger: {
      ea: {
        get: vi.fn(),
        getByEntity: vi.fn(),
        getByEntityWithBalance: vi.fn(),
        getBalance: vi.fn(),
      },
      accounts: { get: vi.fn() },
      paymentMethods: { get: vi.fn() },
      gatewayCustomers: { get: vi.fn() },
      payments: { create: vi.fn() },
      paymentAttempts: {
        get: vi.fn(),
        getByProviderIntent: vi.fn(),
        lockAttempt: vi.fn(),
        claimLedgerPosting: vi.fn(),
        recordEvent: vi.fn(),
        completeEvent: vi.fn(),
        getByIdempotencyKey: vi.fn(),
        getReservedAmount: vi.fn(),
        lockEa: vi.fn(),
        expireReservations: vi.fn(),
        create: vi.fn(),
        updateStatus: vi.fn(),
      },
    },
  },
}));

vi.mock("../../server/storage", () => ({ storage: mocks.storage }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: mocks.access,
  getComponentChecker: () => async () => true,
}));
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({
  resolveGateway: mocks.resolveGateway,
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: mocks.optionList }),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (callback: () => unknown) => callback(),
}));
vi.mock("../../server/modules/ledger/payments", () => ({
  triggerPaymentChargePlugins: vi.fn(),
}));
vi.mock("../../server/modules/masquerade", () => ({
  getEffectiveUser: vi.fn().mockResolvedValue({
    dbUser: { id: "payer-user-1" },
    originalUser: null,
  }),
}));

const { registerLedgerPaymentAttemptRoutes } = await import(
  "../../server/modules/ledger/payment-attempts"
);

let server: http.Server;
let baseUrl: string;

const workerEa = (id: string, accountId: string) => ({
  id,
  accountId,
  entityType: "worker",
  entityId: "worker-1",
  data: null,
});

const account = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Account ${id}`,
  currencyCode: "USD",
  isActive: true,
  gatewayConfigId: "gateway-1",
  data: null,
  description: null,
  siriusId: null,
  ...overrides,
});

const gateway = (status: string = "requires_action") => ({
  config: {
    id: "gateway-1",
    data: { publishableKey: "pk_test_fixture" },
  },
  context: { webhookSecret: "whsec_fixture" },
  plugin: {
    createPaymentIntent: vi.fn().mockResolvedValue({
      status,
      providerIntentRef: "pi-fixture",
      clientSecret: "pi-fixture_secret",
    }),
    getMethodSummary: vi.fn().mockResolvedValue({ type: "card" }),
    addComponentId: "stripe:StripeAddPaymentMethod",
    constructWebhookEvent: vi.fn(),
  },
});

beforeAll(async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, body) => {
    (req as typeof req & { rawBody: Buffer }).rawBody = body;
  } }));
  registerLedgerPaymentAttemptRoutes(app, (_req, _res, next) => next());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((cause) => (cause ? reject(cause) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ granted: true });
  mocks.optionList.mockResolvedValue([
    { id: "financial-usd", category: "financial", currencyCode: "USD" },
  ]);
  mocks.resolveGateway.mockResolvedValue(gateway());
  mocks.storage.workers.getWorker.mockResolvedValue({ id: "worker-1" });
  mocks.storage.ledger.paymentAttempts.getByIdempotencyKey.mockResolvedValue(undefined);
  mocks.storage.ledger.paymentAttempts.getReservedAmount.mockResolvedValue(0);
});

describe("worker payable account routes", () => {
  it.each([false, true])("locks before inserting and links afterward (already posted: %s)", async (alreadyPosted) => {
    const attempt = {
      id: "attempt-1", gatewayConfigId: "gateway-1", providerIntentRef: "pi-fixture",
      amount: "40.00", currency: "USD", status: "succeeded",
      ledgerEaId: "ea-dp", ledgerPaymentId: null, lastProviderEventCreated: 1,
    };
    mocks.resolveGateway.mockResolvedValue({
      ...gateway(),
      plugin: {
        id: "dummy",
        verifyWebhook: vi.fn().mockReturnValue({
          eventId: "event-1", type: "payment.succeeded",
          providerEventType: "payment.succeeded", providerRef: "pi-fixture",
          amountMinor: 4000, currency: "USD", providerCreated: 2, payload: {},
        }),
      },
    });
    mocks.storage.ledger.paymentAttempts.getByProviderIntent.mockResolvedValue(attempt);
    mocks.storage.ledger.paymentAttempts.updateStatus.mockResolvedValue(attempt);
    mocks.storage.ledger.paymentAttempts.get.mockResolvedValue({
      ...attempt, ledgerPaymentId: alreadyPosted ? "payment-existing" : null,
    });
    mocks.storage.ledger.paymentAttempts.claimLedgerPosting.mockResolvedValue(true);
    mocks.storage.ledger.payments.create.mockResolvedValue({ id: "payment-new" });
    const response = await fetch(`${baseUrl}/api/ledger/payment-gateways/gateway-1/webhook`, {
      method: "POST", headers: { "content-type": "application/json", "dummy-signature": "fixture" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(mocks.storage.ledger.paymentAttempts.lockAttempt).toHaveBeenCalledWith("attempt-1");
    if (alreadyPosted) {
      expect(mocks.storage.ledger.payments.create).not.toHaveBeenCalled();
      expect(mocks.storage.ledger.paymentAttempts.claimLedgerPosting).not.toHaveBeenCalled();
    } else {
      expect(mocks.storage.ledger.paymentAttempts.lockAttempt.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.storage.ledger.payments.create.mock.invocationCallOrder[0]);
      expect(mocks.storage.ledger.payments.create.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.storage.ledger.paymentAttempts.claimLedgerPosting.mock.invocationCallOrder[0]);
    }
  });

  it("requires explicit EA selection rather than choosing an arbitrary worker account", async () => {
    mocks.storage.ledger.ea.getByEntity.mockResolvedValue([
      workerEa("ea-health", "account-health"),
      workerEa("ea-dp", "account-dp"),
    ]);

    const ambiguous = await fetch(`${baseUrl}/api/workers/worker-1/ledger/payable`);
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toEqual({
      message: "eaId is required when a worker has multiple ledger accounts",
    });

    mocks.storage.ledger.ea.get.mockResolvedValue(workerEa("ea-dp", "account-dp"));
    mocks.storage.ledger.accounts.get.mockResolvedValue(
      account("account-dp", { name: "Domestic Partner" }),
    );
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("125.50");
    mocks.storage.ledger.paymentAttempts.getReservedAmount.mockResolvedValue(20);

    const selected = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payable?eaId=ea-dp`,
    );
    expect(selected.status).toBe(200);
    expect(await selected.json()).toEqual({
      eaId: "ea-dp",
      accountId: "account-dp",
      accountName: "Domestic Partner",
      balance: "125.50",
      currencyCode: "USD",
      availableBalance: "105.50",
      reservedAmount: "20.00",
      gatewayConfigId: "gateway-1",
    });
    expect(mocks.storage.ledger.ea.getBalance).toHaveBeenCalledWith("ea-dp");
    expect(mocks.storage.ledger.paymentAttempts.getReservedAmount).toHaveBeenCalledWith(
      "ea-dp",
    );
  });

  it("rejects an explicitly selected EA owned by another worker", async () => {
    mocks.storage.ledger.ea.get.mockResolvedValue({
      ...workerEa("ea-other", "account-dp"),
      entityId: "worker-2",
    });
    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payable?eaId=ea-other`,
    );
    expect(response.status).toBe(403);
    expect(mocks.storage.ledger.ea.getBalance).not.toHaveBeenCalled();
  });

  it.each([
    "?eaId=",
    "?eaId=ea-dp&eaId=ea-other",
    "?eaId=%20ea-dp%20",
  ])("rejects malformed explicit EA selection %s", async (query) => {
    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payable${query}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "eaId must be a non-empty ledger account entry id",
    });
    expect(mocks.storage.ledger.ea.get).not.toHaveBeenCalled();
    expect(mocks.storage.ledger.ea.getByEntity).not.toHaveBeenCalled();
  });

  it.each([
    [null, 0, "Payable balance"],
    ["", 0, "Payable balance"],
    ["NaN", 0, "Payable balance"],
    ["10.001", 0, "Payable balance"],
    ["10.00", Number.NaN, "Reserved payment amount"],
    ["10.00", -1, "Reserved payment amount"],
  ])(
    "returns an actionable conflict for malformed balance %s / reservation %s",
    async (balance, reserved, label) => {
      mocks.storage.ledger.ea.get.mockResolvedValue(
        workerEa("ea-dp", "account-dp"),
      );
      mocks.storage.ledger.accounts.get.mockResolvedValue(account("account-dp"));
      mocks.storage.ledger.ea.getBalance.mockResolvedValue(balance);
      mocks.storage.ledger.paymentAttempts.getReservedAmount.mockResolvedValue(
        reserved,
      );
      const response = await fetch(
        `${baseUrl}/api/workers/worker-1/ledger/payable?eaId=ea-dp`,
      );
      expect(response.status).toBe(409);
      expect((await response.json()).message).toContain(
        `${label} is unavailable`,
      );
    },
  );

  it("does not present an unsupported currency as a genuine zero balance", async () => {
    mocks.storage.ledger.ea.get.mockResolvedValue(
      workerEa("ea-points", "account-points"),
    );
    mocks.storage.ledger.accounts.get.mockResolvedValue(
      account("account-points", { currencyCode: "POINTS" }),
    );
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("0.00");
    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payable?eaId=ea-points`,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "Online worker payments do not support POINTS accounts",
    });
    expect(mocks.storage.ledger.ea.getBalance).not.toHaveBeenCalled();
  });

  it("lists account identity and actionable payment eligibility without writing", async () => {
    mocks.storage.ledger.ea.getByEntityWithBalance.mockResolvedValue([
      { ...workerEa("ea-ok", "account-ok"), balance: "80.00" },
      { ...workerEa("ea-no-gateway", "account-no-gateway"), balance: "30.00" },
    ]);
    mocks.storage.ledger.accounts.get
      .mockResolvedValueOnce(account("account-ok"))
      .mockResolvedValueOnce(
        account("account-no-gateway", {
          name: "No gateway",
          gatewayConfigId: null,
        }),
      );

    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payable-accounts`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        eaId: "ea-ok",
        accountId: "account-ok",
        accountName: "Account account-ok",
        currencyCode: "USD",
        gatewayConfigId: "gateway-1",
        eligible: true,
      },
      {
        eaId: "ea-no-gateway",
        accountId: "account-no-gateway",
        accountName: "No gateway",
        currencyCode: "USD",
        gatewayConfigId: null,
        eligible: false,
        error: "This ledger account does not have a payment gateway configured",
      },
    ]);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });
});

describe("worker payment submission contract", () => {
  beforeEach(() => {
    mocks.storage.ledger.ea.get.mockResolvedValue(workerEa("ea-dp", "account-dp"));
    mocks.storage.ledger.ea.getBalance.mockResolvedValue("100.00");
    mocks.storage.ledger.accounts.get.mockResolvedValue(account("account-dp"));
    mocks.storage.ledger.paymentMethods.get.mockResolvedValue({
      id: "method-1",
      entityType: "worker",
      entityId: "worker-1",
      gatewayConfigId: "gateway-1",
      paymentMethod: "pm-fixture",
      isActive: true,
    });
    mocks.storage.ledger.gatewayCustomers.get.mockResolvedValue({
      customerRef: "cus-fixture",
    });
    mocks.storage.ledger.paymentAttempts.create.mockResolvedValue({
      id: "attempt-1",
      workerId: "worker-1",
      ledgerEaId: "ea-dp",
      gatewayConfigId: "gateway-1",
      paymentMethodId: "method-1",
      idempotencyKey: "key-1",
      amount: "40.00",
      currency: "USD",
      status: "requires_action",
    });
    mocks.storage.ledger.paymentAttempts.updateStatus.mockImplementation(
      async (_id, status, fields) => ({
        id: "attempt-1",
        status,
        ledgerPaymentId: null,
        ...fields,
      }),
    );
  });

  it.each(["requires_action", "processing", "succeeded"])(
    "refuses retired legacy charge creation (%s)",
    async (providerStatus) => {
      mocks.resolveGateway.mockResolvedValue(gateway(providerStatus));
      const response = await fetch(
        `${baseUrl}/api/workers/worker-1/ledger/payment-intent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eaId: "ea-dp",
            paymentMethodId: "method-1",
            amount: "40.00",
            idempotencyKey: "key-1",
          }),
        },
      );
       expect(response.status).toBe(410);
       expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
    },
  );

  it("refuses the retired legacy provider rejection path", async () => {
    const resolved = gateway();
    resolved.plugin.createPaymentIntent.mockRejectedValue(new Error("declined"));
    mocks.resolveGateway.mockResolvedValue(resolved);
    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payment-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eaId: "ea-dp",
          paymentMethodId: "method-1",
          amount: "40.00",
          idempotencyKey: "key-1",
        }),
      },
    );
     expect(response.status).toBe(410);
     expect(mocks.storage.ledger.paymentAttempts.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses legacy balance charging", async () => {
    mocks.storage.ledger.paymentAttempts.getReservedAmount.mockResolvedValue(70);
    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payment-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eaId: "ea-dp",
          paymentMethodId: "method-1",
          amount: "40.00",
          idempotencyKey: "key-1",
        }),
      },
    );
     expect(response.status).toBe(410);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });

  it("refuses legacy currency charging", async () => {
    mocks.storage.ledger.accounts.get.mockResolvedValue(
      account("account-dp", { currencyCode: "SHARES" }),
    );
    const response = await fetch(
      `${baseUrl}/api/workers/worker-1/ledger/payment-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eaId: "ea-dp",
          paymentMethodId: "method-1",
          amount: "40.00",
          idempotencyKey: "key-1",
        }),
      },
    );
     expect(response.status).toBe(410);
    expect(mocks.storage.ledger.paymentAttempts.create).not.toHaveBeenCalled();
  });
});