import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: {} as any, writes: 0, recordMutation: vi.fn(), afterCommit: vi.fn(), audit: vi.fn(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({
    select: () => ({ from: (table: any) => ({ where: async () =>
      getTableName(table) === "ledger_accounts" ? [{ ...state.account }] : [] }) }),
    update: () => ({ set: (values: any) => ({ where: () => ({ returning: async () => {
      state.writes++; Object.assign(state.account, values); return [{ ...state.account }];
    } }) }) }),
  }),
  isInTransaction: () => true,
  runInTransaction: (fn: () => unknown) => fn(),
  runOutsideTransaction: (fn: () => unknown) => fn(),
  onAfterCommit: state.afterCommit,
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: {
    recordMutation: state.recordMutation, recordSubrecordTouch: vi.fn(), recordDeletion: vi.fn(),
  },
}));
vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => ({ userId: "fixture-actor" }), isFrameworkWrite: () => false,
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  storageLogger: { info: state.audit, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/event-bus", () => ({ eventBus: { emit: vi.fn() }, EventType: {} }));
import { createLedgerAccountStorage, ledgerAccountLoggingConfig } from "../../server/storage/ledger";
import { withStorageLogging, flushDeferredStorageWork } from "../../server/storage/middleware/logging";

describe("identity refusals do not advance real storage metadata middleware", () => {
  const storage = withStorageLogging(createLedgerAccountStorage(), {
    ...ledgerAccountLoggingConfig, metadataTiming: "transactional",
  });
  beforeEach(() => {
    vi.clearAllMocks(); state.writes = 0;
    state.account = { id: "account", name: "Original", currencyCode: "USD", data: null };
  });
  it("does not record a successful audit or metadata mutation on a mixed-update conflict", async () => {
    await expect(storage.update("account", { currencyCode: "EUR", name: "Lost", data: { invoicesEnabled: true } }))
      .rejects.toThrow("permanent");
    await flushDeferredStorageWork();
    expect(state.account).toMatchObject({ name: "Original", currencyCode: "USD", data: null });
    expect(state.writes).toBe(0);
    expect(state.recordMutation).not.toHaveBeenCalled();
    expect(state.afterCommit).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("retains normal provenance and before/after audit on legitimate account updates", async () => {
    await storage.update("account", { currencyCode: "USD", name: "Renamed", data: { invoicesEnabled: true } });
    await flushDeferredStorageWork();
    expect(state.writes).toBe(1);
    expect(state.recordMutation).toHaveBeenCalledTimes(1);
    expect(state.audit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      module: "ledger.accounts", operation: "update",
      meta: expect.objectContaining({
        before: expect.objectContaining({ name: "Original", currencyCode: "USD" }),
        after: expect.objectContaining({ name: "Renamed", currencyCode: "USD" }),
      }),
    }));
  });
});
