import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  getClient: vi.fn(), callbacks: [] as Array<() => void>, emit: vi.fn(async () => undefined),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: f.getClient, onAfterCommit: (fn: () => void) => f.callbacks.push(fn),
}));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { LEDGER_ENTRY_SAVED: "ledger.entry.saved" }, eventBus: { emit: f.emit },
}));
const { createLedgerEntryStorage, createLedgerEaStorage, createLedgerPaymentStorage } = await import("../../server/storage/ledger");

describe("actual ledger storage financial-link moves", () => {
  beforeEach(() => { vi.clearAllMocks(); f.callbacks = []; });
  it("delivers old and new worker/account coordinates only after commit, without rebilling", async () => {
    const before = { id: "imported", eaId: "old-ea", statementYmd: "2026-01-01" };
    const after = { ...before, eaId: "new-ea" };
    const eas = [
      { id: "old-ea", entityType: "worker", entityId: "old-worker", accountId: "fund" },
      { id: "new-ea", entityType: "worker", entityId: "exact-worker", accountId: "fund" },
    ];
    let selects = 0;
    const set = vi.fn(() => ({ where: () => ({ returning: async () => [after] }) }));
    f.getClient.mockReturnValue({
      select: () => ({ from: () => ({ where: async () => ++selects === 1 ? [before] : eas }) }),
      update: () => ({ set }),
    });
    await createLedgerEntryStorage().update("imported", { eaId: "new-ea" });
    expect(set).toHaveBeenCalledWith({ eaId: "new-ea" });
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.callbacks).toHaveLength(2);
    f.callbacks.forEach((fn) => fn());
    expect(f.emit.mock.calls).toEqual(expect.arrayContaining([
      ["ledger.entry.saved", expect.objectContaining({ entityId: "old-worker", accountId: "fund", operation: "updated" })],
      ["ledger.entry.saved", expect.objectContaining({ entityId: "exact-worker", accountId: "fund", operation: "updated" })],
    ]));
  });
  it("uses existing worker EA/payment retrieval without exposing contact-owned accounts", async () => {
    const where = vi.fn(async () => [{ id: "canonical-worker-ea", entityType: "worker", entityId: "worker" }]);
    f.getClient.mockReturnValue({ select: () => ({ from: () => ({ where }) }) });
    expect(await createLedgerEaStorage().getByEntity("worker", "worker")).toMatchObject([{ id: "canonical-worker-ea" }]);
    const set = vi.fn(() => ({ where: () => ({ returning: async () => [{ id: "payment", ledgerEaId: "canonical-worker-ea" }] }) }));
    f.getClient.mockReturnValue({ update: () => ({ set }) });
    expect(await createLedgerPaymentStorage().updateForMigration("payment", { ledgerEaId: "canonical-worker-ea" }))
      .toMatchObject({ id: "payment", ledgerEaId: "canonical-worker-ea" });
    expect(set).toHaveBeenCalledWith({ ledgerEaId: "canonical-worker-ea" });
    expect(f.emit).not.toHaveBeenCalled();
  });
});
