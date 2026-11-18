import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ plugin: null as any, entries: [] as any[] }));
vi.mock("../../server/plugins/ledger/charge/registry", () => ({ registerChargePlugin: (plugin: any) => { state.plugin = plugin; } }));
vi.mock("../../server/storage", () => ({ storage: { ledger: { entries: {
  getByReferenceAndConfig: async (paymentId: string, configId: string) =>
    state.entries.filter(entry => entry.referenceId === paymentId && entry.chargePluginConfigId === configId),
  delete: async (id: string) => { state.entries = state.entries.filter(entry => entry.id !== id); },
} } } }));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({ get: async () => ({ name: "Check", currencyCode: "USD" }) }) }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import "../../server/plugins/ledger/charge/plugins/paymentSimpleAllocation";
import { TriggerType } from "../../server/plugins/ledger/charge/types";
beforeEach(() => { state.entries = []; });
async function reconcile(status: string) {
  const result = await state.plugin.execute({
    trigger: TriggerType.PAYMENT_SAVED, status, paymentId: "original-receipt", amount: "100.00",
    ledgerEaId: "ea", accountId: "account", entityType: "employer", entityId: "employer",
    paymentTypeId: "check", allocationId: "ea:2026-11-01", allocationStatementYmd: "2026-11-01",
    dateReceived: null, dateCleared: null,
  }, { id: "payment-config", account: "account", settings: {} });
  expect(result.success).toBe(true);
  for (const transaction of result.transactions) {
    state.entries.push({ ...transaction, id: `entry-${state.entries.length}`, chargePluginConfigId: "payment-config" });
  }
}
it("does not credit pending receipts and reconciles repeated clearance of the original payment once", async () => {
  await reconcile("employer_submitted"); expect(state.entries).toHaveLength(0);
  await reconcile("cleared"); await reconcile("cleared");
  expect(state.entries).toHaveLength(1);
  expect(state.entries[0]).toMatchObject({ amount: "-100.00", referenceType: "payment", referenceId: "original-receipt" });
});
it.each(["draft", "employer_submitted", "canceled", "error"])("removes the same allocation credit when staff change a cleared payment to %s", async status => {
  await reconcile("cleared");
  const unrelated = { ...state.entries[0], id: "another", chargePluginKey: "payment-config:original-receipt:other:2026-11-01" };
  state.entries.push(unrelated);
  await reconcile(status);
  expect(state.entries).toEqual([unrelated]);
});
