import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const state = vi.hoisted(() => ({ type: {} as any, cleared: false, writes: 0 }));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: async (fn: any) => fn(),
  getClient: () => ({
    select: () => ({ from: (table: any) => ({ where: () => {
      const rows = getTableName(table) === "ledger_payments" ? (state.cleared ? [{ id: "p1" }] : []) : [{ ...state.type }];
      return { for: async () => rows, limit: async () => rows };
    } }) }),
    update: () => ({ set: (values: any) => ({ where: () => ({ returning: async () => {
      state.writes++; Object.assign(state.type, values); return [{ ...state.type }];
    } }) }) }),
  }),
}));
vi.mock("../../server/storage/middleware/logging", () => ({
  defineLoggingConfig: (config: any) => config,
  withStorageLogging: (storage: any) => storage,
}));
vi.mock("../../server/services/entity-notes/registry", () => ({ listEntityNoteContexts: () => [] }));
vi.mock("../../server/services/entity-files/registry", () => ({ listEntityFileContexts: () => [] }));
const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");

describe("ordinary payment type saves preserve the historical guard", () => {
  beforeEach(() => { state.type = { id: "t1", direction: "credit", name: "Old name" }; state.cleared = false; state.writes = 0; });
  it("persists Charge for an unused Credit type", async () => {
    const result = await createUnifiedOptionsStorage().update("ledger-payment-type", "t1", { direction: "charge" });
    expect(result.direction).toBe("charge"); expect(state.type.direction).toBe("charge"); expect(state.writes).toBe(1);
  });
  it("refuses a direction flip when cleared payments exist without writing", async () => {
    state.cleared = true;
    await expect(createUnifiedOptionsStorage().update("ledger-payment-type", "t1", { direction: "charge" }))
      .rejects.toThrow("audited historical correction");
    expect(state.writes).toBe(0); expect(state.type.direction).toBe("credit");
  });
  it("allows unrelated edits on a used type with the same effect", async () => {
    state.cleared = true;
    const result = await createUnifiedOptionsStorage().update("ledger-payment-type", "t1", { name: "New name", direction: "credit" });
    expect(result).toMatchObject({ name: "New name", direction: "credit" }); expect(state.writes).toBe(1);
  });
});