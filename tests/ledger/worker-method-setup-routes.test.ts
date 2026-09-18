import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type StoredMethod = {
  id: string;
  entityType: string;
  entityId: string;
  gatewayConfigId: string;
  paymentMethod: string;
  isActive: boolean;
  isDefault: boolean;
};

const h = vi.hoisted(() => ({
  methods: [] as StoredMethod[],
  customer: undefined as
    | {
        entityType: string;
        entityId: string;
        gatewayConfigId: string;
        customerRef: string;
      }
    | undefined,
  access: vi.fn(),
  getPlugin: vi.fn(),
  resolveGateway: vi.fn(),
  plugin: {
    createCustomer: vi.fn(),
    createSetupSession: vi.fn(),
    attachMethod: vi.fn(),
    detachMethod: vi.fn(),
    getMethodSummary: vi.fn(),
    getMethodDetails: vi.fn(),
    getCustomerDetails: vi.fn(),
  },
  financialWrites: {
    paymentCreate: vi.fn(),
    entryCreate: vi.fn(),
    attemptCreate: vi.fn(),
    eaCreate: vi.fn(),
  },
  balanceReads: {
    getBalance: vi.fn(),
    getByEntityWithBalance: vi.fn(),
  },
  storage: {
    workers: {
      getWorker: vi.fn(),
      getWorkerDisplayName: vi.fn(),
    },
    employers: { getEmployer: vi.fn() },
    pluginConfigs: {
      getByKind: vi.fn(),
    },
    ledger: {
      gatewayCustomers: {
        get: vi.fn(),
        upsert: vi.fn(),
      },
      paymentMethods: {
        get: vi.fn(),
        getByEntity: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        setAsDefault: vi.fn(),
      },
      payments: { create: vi.fn() },
      entries: { create: vi.fn() },
      paymentAttempts: { create: vi.fn() },
      ea: {
        create: vi.fn(),
        getBalance: vi.fn(),
        getByEntityWithBalance: vi.fn(),
      },
    },
  },
}));

vi.mock("../../server/storage", () => ({ storage: h.storage }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: h.access,
  getComponentChecker: () => async () => true,
}));
vi.mock("../../server/plugins/ledger/payment-gateway", () => ({
  getPaymentGatewayPlugin: h.getPlugin,
}));
vi.mock("../../server/modules/ledger/payment-gateway-context", () => ({
  resolveGateway: h.resolveGateway,
  GatewayResolutionError: class GatewayResolutionError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

const { registerLedgerPaymentMethodRoutes } = await import(
  "../../server/modules/ledger/payment-methods"
);

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerLedgerPaymentMethodRoutes(app, (_req, _res, next) => next());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((cause) => (cause ? reject(cause) : resolve())),
  );
});

function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, init);
}

function post(path: string, body?: unknown) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.methods.splice(0);
  h.customer = undefined;
  vi.clearAllMocks();

  h.access.mockResolvedValue({ granted: true });
  h.storage.workers.getWorker.mockImplementation(async (id) => ({
    id,
    siriusId: 42,
  }));
  h.storage.workers.getWorkerDisplayName.mockResolvedValue("Fixture Worker");
  h.storage.pluginConfigs.getByKind.mockResolvedValue([
    {
      id: "gateway-1",
      pluginKind: "payment-gateway",
      pluginId: "stripe",
      enabled: true,
      name: "Fixture Stripe",
    },
  ]);
  h.storage.ledger.gatewayCustomers.get.mockImplementation(
    async (entityType, entityId, gatewayConfigId) => {
      const customer = h.customer;
      return customer &&
        customer.entityType === entityType &&
        customer.entityId === entityId &&
        customer.gatewayConfigId === gatewayConfigId
          ? customer
          : undefined;
    },
  );
  h.storage.ledger.gatewayCustomers.upsert.mockImplementation(async (row) => {
    h.customer = row;
    return row;
  });
  h.storage.ledger.paymentMethods.get.mockImplementation(
    async (id) => h.methods.find((method) => method.id === id),
  );
  h.storage.ledger.paymentMethods.getByEntity.mockImplementation(
    async (entityType, entityId) =>
      h.methods.filter(
        (method) =>
          method.entityType === entityType && method.entityId === entityId,
      ),
  );
  h.storage.ledger.paymentMethods.create.mockImplementation(async (input) => {
    const method = { id: `method-${h.methods.length + 1}`, ...input };
    h.methods.push(method);
    return method;
  });
  h.storage.ledger.paymentMethods.update.mockImplementation(
    async (id, patch) => {
      const method = h.methods.find((candidate) => candidate.id === id);
      if (!method) return undefined;
      Object.assign(method, patch);
      return method;
    },
  );
  h.storage.ledger.paymentMethods.setAsDefault.mockImplementation(
    async (id, entityType, entityId, gatewayConfigId) => {
      for (const method of h.methods) {
        if (
          method.entityType === entityType &&
          method.entityId === entityId &&
          method.gatewayConfigId === gatewayConfigId
        ) {
          method.isDefault = method.id === id;
        }
      }
      return h.methods.find((method) => method.id === id);
    },
  );

  h.plugin.createCustomer.mockResolvedValue({ customerRef: "cus-fixture" });
  h.plugin.createSetupSession.mockResolvedValue({
    clientSecret: "seti-fixture_secret",
    publicConfig: { publishableKey: "pk_test_fixture" },
  });
  h.plugin.attachMethod.mockResolvedValue(undefined);
  h.plugin.detachMethod.mockResolvedValue(undefined);
  h.plugin.getMethodSummary.mockImplementation(async (_context, token) => ({
    type: "card",
    card: { brand: "visa", last4: token.slice(-4), expMonth: 12, expYear: 2030 },
  }));
  const resolved = {
    config: { id: "gateway-1" },
    context: { apiKey: "fixture" },
    plugin: {
      ...h.plugin,
      addComponentId: "stripe:StripeAddPaymentMethod",
    },
  };
  h.resolveGateway.mockResolvedValue(resolved);
  h.getPlugin.mockReturnValue(resolved.plugin);

  h.storage.ledger.payments.create.mockImplementation(h.financialWrites.paymentCreate);
  h.storage.ledger.entries.create.mockImplementation(h.financialWrites.entryCreate);
  h.storage.ledger.paymentAttempts.create.mockImplementation(h.financialWrites.attemptCreate);
  h.storage.ledger.ea.create.mockImplementation(h.financialWrites.eaCreate);
  h.storage.ledger.ea.getBalance.mockImplementation(h.balanceReads.getBalance);
  h.storage.ledger.ea.getByEntityWithBalance.mockImplementation(
    h.balanceReads.getByEntityWithBalance,
  );
});

describe("worker payment method setup routes", () => {
  it("supports setup, attach, list/default, and remove at zero debt without ledger activity", async () => {
    const setup = await post(
      "/api/ledger/payment-methods/worker/worker-1/setup",
      { gatewayConfigId: "gateway-1" },
    );
    expect(setup.status).toBe(200);
    expect(await setup.json()).toEqual({
      clientSecret: "seti-fixture_secret",
      componentId: "stripe:StripeAddPaymentMethod",
      publicConfig: { publishableKey: "pk_test_fixture" },
    });

    for (const methodToken of ["pm_visa_4242", "pm_visa_4444"]) {
      const attached = await post(
        "/api/ledger/payment-methods/worker/worker-1",
        { gatewayConfigId: "gateway-1", methodToken },
      );
      expect(attached.status).toBe(200);
    }
    expect(h.methods.map((method) => method.isDefault)).toEqual([true, false]);

    const madeDefault = await post(
      "/api/ledger/payment-methods/worker/worker-1/method-2/set-default",
    );
    expect(madeDefault.status).toBe(200);
    expect(h.methods.map((method) => method.isDefault)).toEqual([false, true]);

    const listed = await request(
      "/api/ledger/payment-methods/worker/worker-1",
    );
    expect(listed.status).toBe(200);
    const listedMethods = await listed.json();
    expect(listedMethods).toHaveLength(2);
    expect(listedMethods[1]).toMatchObject({
      id: "method-2",
      isDefault: true,
      providerDetails: {
        type: "card",
        card: { brand: "visa", last4: "4444" },
      },
    });

    const removed = await request(
      "/api/ledger/payment-methods/worker/worker-1/method-2",
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    expect(h.methods[1]).toMatchObject({
      isActive: false,
      isDefault: false,
    });
    expect(h.plugin.detachMethod).toHaveBeenCalledWith(
      expect.anything(),
      "pm_visa_4444",
    );

    expect(h.plugin.createCustomer).toHaveBeenCalledTimes(1);
    expect(h.storage.ledger.gatewayCustomers.upsert).toHaveBeenCalledTimes(1);
    expect(h.financialWrites.paymentCreate).not.toHaveBeenCalled();
    expect(h.financialWrites.entryCreate).not.toHaveBeenCalled();
    expect(h.financialWrites.attemptCreate).not.toHaveBeenCalled();
    expect(h.financialWrites.eaCreate).not.toHaveBeenCalled();
    expect(h.balanceReads.getBalance).not.toHaveBeenCalled();
    expect(h.balanceReads.getByEntityWithBalance).not.toHaveBeenCalled();
  });

  it("rejects a method belonging to another worker before provider access", async () => {
    h.methods.push({
      id: "method-other",
      entityType: "worker",
      entityId: "worker-2",
      gatewayConfigId: "gateway-1",
      paymentMethod: "pm_other",
      isActive: true,
      isDefault: true,
    });
    const response = await request(
      "/api/ledger/payment-methods/worker/worker-1/method-other",
      { method: "DELETE" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Payment method does not belong to this entity",
    });
    expect(h.plugin.detachMethod).not.toHaveBeenCalled();
    expect(h.storage.ledger.paymentMethods.update).not.toHaveBeenCalled();
  });

  it("does not persist a method when the provider refuses attachment", async () => {
    const refusal = Object.assign(new Error("Payment method was declined"), {
      statusCode: 402,
    });
    h.plugin.attachMethod.mockRejectedValueOnce(refusal);
    const response = await post(
      "/api/ledger/payment-methods/worker/worker-1",
      { gatewayConfigId: "gateway-1", methodToken: "pm_declined" },
    );
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      message: "Payment method was declined",
    });
    expect(h.storage.ledger.paymentMethods.create).not.toHaveBeenCalled();
    expect(h.methods).toEqual([]);
    expect(h.financialWrites.paymentCreate).not.toHaveBeenCalled();
    expect(h.financialWrites.entryCreate).not.toHaveBeenCalled();
    expect(h.financialWrites.attemptCreate).not.toHaveBeenCalled();
  });
});