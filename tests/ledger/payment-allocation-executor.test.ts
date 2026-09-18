import { beforeEach, describe, expect, it, vi } from "vitest";

const bulkCreate = vi.fn();
const getOrCreateEaCached = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    ledger: { entries: { bulkCreate } },
    pluginConfigs: { search: vi.fn(async () => []) },
  },
}));

vi.mock("../../server/plugins/ledger/charge/ea-cache", () => ({
  getOrCreateEaCached,
}));

const { createLedgerEntries } = await import(
  "../../server/plugins/ledger/charge/executor"
);

const transaction = {
  chargePlugin: "payment-simple-allocation",
  chargePluginKey: "config-1:payment-1:ea-1:2026-01-01",
  chargePluginConfigId: "config-1",
  accountId: "account-1",
  entityType: "worker",
  entityId: "worker-1",
  amount: "-25.00",
  description: "Payment",
  transactionDate: new Date("2026-01-10T00:00:00.000Z"),
  statementYmd: "2026-01-01",
  referenceType: "payment",
  referenceId: "payment-1",
  metadata: { paymentId: "payment-1" },
};

describe("strict payment-allocation ledger writes", () => {
  beforeEach(() => {
    bulkCreate.mockReset();
    getOrCreateEaCached.mockReset();
    getOrCreateEaCached.mockResolvedValue({ id: "ea-1" });
    bulkCreate.mockResolvedValue([]);
  });

  it("uses the conflict-updating write path so stable keys retain identity", async () => {
    await createLedgerEntries([transaction], true);

    expect(bulkCreate).toHaveBeenCalledOnce();
    expect(bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({
        chargePlugin: "payment-simple-allocation",
        chargePluginKey: transaction.chargePluginKey,
        amount: "-25.00",
        eaId: "ea-1",
        date: transaction.transactionDate,
        referenceType: "payment",
        referenceId: "payment-1",
      }),
    ]);
  });

  it("writes every generated employer allocation and preserves the payment total", async () => {
    getOrCreateEaCached
      .mockResolvedValueOnce({ id: "ea-acme" })
      .mockResolvedValueOnce({ id: "ea-beta" });
    const allocations = [
      {
        ...transaction,
        chargePluginKey: "config-1:payment-1:ea-acme:2026-01-01",
        entityId: "acme",
        amount: "-60.00",
      },
      {
        ...transaction,
        chargePluginKey: "config-1:payment-1:ea-beta:2026-02-01",
        entityId: "beta",
        amount: "-40.00",
        statementYmd: "2026-02-01",
      },
    ];

    await createLedgerEntries(allocations, true);

    const written = bulkCreate.mock.calls.flatMap(([entries]) => entries);
    expect(bulkCreate).toHaveBeenCalledTimes(2);
    expect(written).toHaveLength(2);
    expect(written.map((entry: { amount: string }) => entry.amount)).toEqual(["-60.00", "-40.00"]);
    expect(written.reduce(
      (total: number, entry: { amount: string }) => total + Number(entry.amount),
      0,
    )).toBe(-100);
  });

  it("propagates a replacement write failure to the payment transaction", async () => {
    bulkCreate.mockRejectedValueOnce(new Error("injected replacement failure"));

    await expect(createLedgerEntries([transaction], true)).rejects.toThrow(
      "injected replacement failure",
    );
  });

  it("retains legacy soft-failure behavior for non-strict charge callers", async () => {
    bulkCreate.mockRejectedValueOnce(new Error("injected non-payment failure"));

    await expect(createLedgerEntries([transaction], false)).resolves.toBeUndefined();
  });
});