import { beforeEach, describe, expect, it, vi } from "vitest";

const getType = vi.fn();
const getEntries = vi.fn();
const deleteEntry = vi.fn();
let plugin: any;

vi.mock("../../server/plugins/ledger/charge/registry", () => ({
  registerChargePlugin: (instance: unknown) => { plugin = instance; },
}));
vi.mock("../../server/plugins/ledger/charge/base", () => ({
  ChargePlugin: class {
    validateSettings() { return { valid: true }; }
  },
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ get: getType }),
}));
vi.mock("../../server/storage", () => ({
  storage: { ledger: { entries: {
    getByReferenceAndConfig: getEntries,
    delete: deleteEntry,
  } } },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { TriggerType } = await import("../../server/plugins/ledger/charge/types");
await import("../../server/plugins/ledger/charge/plugins/paymentSimpleAllocation");

const context = (overrides: Record<string, unknown> = {}) => ({
  trigger: TriggerType.PAYMENT_SAVED,
  paymentId: "payment-1",
  paymentTypeId: "type-1",
  amount: "50.00",
  status: "cleared",
  ledgerEaId: "ea-1",
  accountId: "account-1",
  entityType: "worker",
  entityId: "worker-1",
  dateReceived: new Date("2026-01-10T00:00:00.000Z"),
  dateCleared: null,
  memo: null,
  details: {},
  allocationId: "ea-1:2026-01-01",
  allocationStatementYmd: "2026-01-01",
  ...overrides,
});

describe("payment type ledger direction", () => {
  beforeEach(() => {
    getType.mockReset();
    getEntries.mockReset().mockResolvedValue([]);
    deleteEntry.mockReset();
  });

  it.each([
    ["Adjustment - Charge", "financial", "charge", "50.00"],
    ["COBRA Charge", "financial", "charge", "50.00"],
    ["Credit Adjustment", "adjustment", "credit", "-50.00"],
    ["Check", "financial", "credit", "-50.00"],
  ])("%s posts as %s category / %s effect", async (name, category, direction, amount) => {
    getType.mockResolvedValue({ name, category, direction, currencyCode: "USD" });
    const first = await plugin.execute(context(), { id: "config-1", account: "account-1", settings: {} });
    const second = await plugin.execute(context(), { id: "config-1", account: "account-1", settings: {} });
    expect(first.success).toBe(true);
    expect(first.transactions[0].amount).toBe(amount);
    expect(second.transactions[0].chargePluginKey).toBe(first.transactions[0].chargePluginKey);
    expect(second.transactions[0].amount).toBe(amount);
  });

  it("voids the existing allocation without creating a charge", async () => {
    getType.mockResolvedValue({ name: "COBRA Charge", direction: "charge", currencyCode: "USD" });
    getEntries.mockResolvedValue([{
      id: "entry-1", amount: "50.00", chargePlugin: "payment-simple-allocation",
      chargePluginKey: "config-1:payment-1:ea-1:2026-01-01",
    }]);
    const result = await plugin.execute(context({ status: "canceled" }), {
      id: "config-1", account: "account-1", settings: {},
    });
    expect(result.transactions).toEqual([]);
    expect(deleteEntry).toHaveBeenCalledWith("entry-1");
  });

  it.each([null, "Original payment memo"])("keeps persisted provenance identical across directions for memo %s", async memo => {
    const config = { id: "config-1", account: "account-1", settings: {} };
    getType.mockResolvedValue({ name: "Legacy", direction: "credit", currencyCode: "USD" });
    const credit = (await plugin.execute(context({ memo }), config)).transactions[0];
    getType.mockResolvedValue({ name: "Legacy", direction: "charge", currencyCode: "USD" });
    const charge = (await plugin.execute(context({ memo }), config)).transactions[0];
    // createLedgerEntries persists memo, NOT description, even for null.
    expect(credit.memo).toBe(memo);
    expect(charge.memo).toBe(memo);
    expect(credit.description).not.toBe(charge.description);
    const { amount: creditAmount, description: creditDescription, ...creditProvenance } = credit;
    const { amount: chargeAmount, description: chargeDescription, ...chargeProvenance } = charge;
    expect(chargeProvenance).toEqual(creditProvenance);
    expect(charge.metadata).toEqual({
      pluginId: "payment-simple-allocation", pluginConfigId: "config-1", paymentId: "payment-1",
      originalAmount: "50.00", ledgerEaId: "ea-1", allocationId: "ea-1:2026-01-01",
    });
    expect(chargeAmount).toBe("50.00");
    expect(creditAmount).toBe("-50.00");
  });
});