import { describe, expect, it, vi } from "vitest";
import { computeCobraPaymentState } from "../../shared/schema/sitespecific/bao/cobra";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: any) => Promise<void>>(),
  enqueueWorker: vi.fn(),
  getWorkerQueueEntry: vi.fn(),
  tryImmediateScan: vi.fn(),
}));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { LEDGER_ENTRY_SAVED: "ledger.entry.saved" },
  eventBus: {
    on: vi.fn(({ name, handler }) => {
      mocks.handlers.set(name, handler);
      return name;
    }),
    off: vi.fn(),
  },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  onAfterCommit: (callback: () => void) => callback(),
}));
vi.mock("../../server/middleware/request-context", () => ({
  isWmbScanWrite: () => false,
}));
vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  isComponentEnabledSync: () => true,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    wmbScanQueue: {
      getWorkerQueueEntry: mocks.getWorkerQueueEntry,
      enqueueWorker: mocks.enqueueWorker,
    },
  },
}));
vi.mock("../../server/services/wmb-scan-queue", () => ({
  enqueueMonthScan: vi.fn(),
  processNextQueueJob: vi.fn(),
  tryImmediateScan: mocks.tryImmediateScan,
  PER_WORKER_AUTO_TRIGGER_SOURCES: ["ledger_entry_saved"],
}));

const { initWmbAutoRescan, shutdownWmbAutoRescan } = await import(
  "../../server/services/wmb-auto-rescan"
);

describe("COBRA allocation rescan and independent case grace", () => {
  it("enqueues both old and new statement months when an allocation is moved", async () => {
    mocks.getWorkerQueueEntry.mockResolvedValue(null);
    mocks.enqueueWorker.mockImplementation(async (_worker, month, year) => ({
      id: `${year}-${month}`,
    }));
    mocks.tryImmediateScan.mockResolvedValue(undefined);
    initWmbAutoRescan();
    try {
      const handler = mocks.handlers.get("wmb-auto-rescan-ledger-entry");
      expect(handler).toBeDefined();
      // Ledger storage emits both old and new statements after an update.
      for (const statementYmd of ["2026-03-01", "2026-04-01"]) {
        await handler!({
          entryId: "allocation-1",
          eaId: "ea-cobra",
          accountId: "cobra-account",
          entityType: "worker",
          entityId: "worker-1",
          statementYmd,
          operation: "updated",
        });
      }
      expect(mocks.enqueueWorker.mock.calls).toEqual(expect.arrayContaining([
        ["worker-1", 3, 2026, "ledger_entry_saved"],
        ["worker-1", 4, 2026, "ledger_entry_saved"],
      ]));
    } finally {
      shutdownWmbAutoRescan();
    }
  });

  it("keeps grace as a case payment state, not proof of monthly eligibility", () => {
    expect(computeCobraPaymentState("100.00", "2026-04-15", "2026-05-15")).toBe("grace");
    expect(computeCobraPaymentState("100.00", "2026-06-15", "2026-05-15")).toBe("grace");
    // The rolling monthly grace window is deliberately unchanged here.
    expect(computeCobraPaymentState("100.00", "2026-06-30", "2026-05-15")).toBe("grace");
    expect(computeCobraPaymentState("0.00", "2026-06-30", "2026-05-15")).toBe("paid");
  });
});