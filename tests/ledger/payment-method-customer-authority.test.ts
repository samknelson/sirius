import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  authority: vi.fn(),
  customerGet: vi.fn(),
  customerUpsert: vi.fn(),
}));

vi.mock("../../server/modules/ledger/online-payment-authority", () => ({
  assertOnlinePaymentAuthority: h.authority,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    employers: { getEmployer: vi.fn() },
    workers: { getWorker: vi.fn(), getWorkerDisplayName: vi.fn() },
    ledger: {
      gatewayCustomers: { get: h.customerGet, upsert: h.customerUpsert },
    },
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
  registerLedgerPaymentMethodRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  h.authority.mockRejectedValue(
    Object.assign(new Error("No active payment grant for this employer"), { status: 403 }),
  );
});

describe("payment-method customer side effects", () => {
  it("denies an unauthorized customer lookup before any provider or mapping writes", async () => {
    const response = await fetch(
      `${baseUrl}/api/ledger/payment-methods/employer/employer-1/customer/gateway-1`,
    );

    expect(response.status).toBe(403);
    expect(h.authority).toHaveBeenCalledWith(
      expect.anything(),
      "employer",
      "employer-1",
      "methods",
    );
    expect(h.customerGet).not.toHaveBeenCalled();
    expect(h.customerUpsert).not.toHaveBeenCalled();
  });
});