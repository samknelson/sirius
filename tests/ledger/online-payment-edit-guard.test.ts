import express from "express";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  executeChargePlugins: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { ledger: { payments: {
    get: mocks.get, update: mocks.update, delete: mocks.delete,
  } } },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  checkAccessInline: vi.fn(async () => ({ granted: true })),
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  isComponentEnabled: vi.fn(async () => true),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => fn(),
  onAfterCommit: vi.fn(),
  runOutsideTransaction: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/plugins/ledger/charge", () => ({
  executeChargePlugins: mocks.executeChargePlugins,
  TriggerType: { PAYMENT_SAVED: "payment_saved" },
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ get: vi.fn() }),
}));

const { registerLedgerPaymentRoutes } = await import("../../server/modules/ledger/payments");
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerLedgerPaymentRoutes(app);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

it("refuses staff clearing a provider-linked pending payment without creating ledger credit", async () => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    id: "payment-1", status: "pending",
    details: { paymentAttemptId: "attempt-1", proposedAllocation: [
      { eaId: "ea-1", amount: "100.00", statementYmd: "2026-01-01" },
    ] },
  });
  const response = await fetch(`${base}/api/ledger/payments/payment-1`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cleared", dateCleared: new Date().toISOString() }),
  });
  expect(response.status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.executeChargePlugins).not.toHaveBeenCalled();
});