import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  handlers: new Map<string, (payload: any) => Promise<void>>(),
  afterCommit: [] as Array<() => void>,
  execute: vi.fn(), emit: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: { ledger: {
  ea: { get: async () => ({ id: "ea", accountId: "account", entityType: "employer", entityId: "employer" }) },
  entries: { getByReference: async () => [] },
} } }));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({}) }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccessInline: vi.fn(), requireAccess: vi.fn() }));
vi.mock("../../server/modules/components", () => ({ requireComponent: vi.fn() }));
vi.mock("../../server/plugins/ledger/charge", () => ({
  executeChargePlugins: state.execute, TriggerType: { PAYMENT_SAVED: "payment_saved" },
}));
vi.mock("../../server/plugins/ledger/charge/executor", () => ({ executeChargePlugins: state.execute }));
vi.mock("../../server/plugins/ledger/charge/execution-observer", () => ({ reportChargeResult: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({
  onAfterCommit: (callback: () => void) => state.afterCommit.push(callback),
  runOutsideTransaction: (callback: () => void) => callback(),
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { PAYMENT_SAVED: "payment.saved" },
  eventBus: {
    getHandlerCount: () => state.handlers.size,
    on: ({ event, handler }: any) => state.handlers.set(event, handler),
    emit: async (event: string, payload: any) => {
      state.emit(event, payload);
      await state.handlers.get(event)?.(payload);
    },
  },
}));
import { triggerPaymentChargePlugins } from "../../server/modules/ledger/payments";
import { registerChargePluginListeners } from "../../server/plugins/ledger/charge/listener";
beforeEach(() => {
  state.handlers.clear(); state.afterCommit = []; state.emit.mockClear();
  state.execute.mockReset().mockResolvedValue({ executed: [], notifications: [], totalTransactions: [] });
  registerChargePluginListeners();
});
it.each([false, true])("does not double-execute billing through the saved-event listener (allocation: %s)", async allocation => {
  const receipt = {
    id: "original-receipt", amount: "100.00", status: "cleared", ledgerEaId: "ea",
    paymentType: "check", dateReceived: null, dateCleared: null, memo: null,
    details: allocation ? { proposedAllocation: [{ eaId: "ea", amount: "100.00", statementYmd: "" }] } : {},
  } as any;
  await triggerPaymentChargePlugins(receipt);
  expect(state.execute).toHaveBeenCalledTimes(1);
  expect(state.emit).not.toHaveBeenCalled(); // Still inside the receipt transaction.
  state.afterCommit.forEach(callback => callback());
  await Promise.resolve();
  expect(state.emit).toHaveBeenCalledWith("payment.saved", expect.objectContaining({ paymentId: receipt.id, chargesHandled: true }));
  expect(state.execute).toHaveBeenCalledTimes(1);
});
it("still reconciles legacy event-only payment saves", async () => {
  await state.handlers.get("payment.saved")!({ paymentId: "legacy", status: "cleared" });
  expect(state.execute).toHaveBeenCalledTimes(1);
});
