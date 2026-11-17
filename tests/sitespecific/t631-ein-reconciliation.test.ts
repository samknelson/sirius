import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: duplicate EIN rows used to be skipped indefinitely. Keep this
// DB-free check of destructive reconciliation and source-conflict refusal.
const state = vi.hoisted(() => ({
  ids: [] as Array<{ id: string; workerId: string; typeId: string; value: string }>,
  failInsert: false,
  deleted: [] as string[],
  reconcile: vi.fn(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({
    execute: async () => ({}),
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ id: "w" }]), { for: async () => [{ id: "w" }] }) }) }),
  }),
  runInTransaction: async (fn: () => Promise<unknown>) => {
    const before = structuredClone(state.ids);
    try { return await fn(); } catch (error) { state.ids = before; throw error; }
  },
}));
vi.mock("../../server/storage/middleware/logging", () => ({}));
vi.mock("../../server/storage/database", () => ({
  storage: { workerIds: {
    deleteWorkerId: async (id: string) => {
      state.deleted.push(id);
      state.ids = state.ids.filter(row => row.id !== id);
      return true;
    },
    createWorkerId: async (row: any) => {
      if (state.failInsert) throw new Error("insert failed");
      state.ids.push({ id: "new", ...row });
    },
  } },
}));
vi.mock("../../server/storage", () => ({
  createCommSmsOptinStorage: () => ({}),
  storage: {
    variables: { getByName: async () => null },
    workerIds: {
      getTypeIdBySiriusId: async (id: string) => id,
      getWorkerIdByTypeAndValue: async (type: string, value: string) =>
        state.ids.find(row => row.typeId === type && row.value === value),
      reconcileWorkerId: state.reconcile,
    },
    workers: { getWorker: async () => null },
  },
}));
vi.mock("../../server/services/comm/validators/phone", () => ({ schedulePhoneRevalidation: vi.fn() }));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() }, storageLogger: { info: vi.fn() } }));
vi.mock("../../server/modules/options-registry", () => ({ getOptionsType: () => ({ getAll: async () => [] }) }));

import { createWorkerIdStorage } from "../../server/storage/workers/ids";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";

const row = (id: string, value: string, typeId = "freeman_ein", workerId = "w") => ({ id, value, typeId, workerId });
const target = createWorkerIdStorage();
target.getWorkerIdsByWorkerId = async id => state.ids.filter(row => row.workerId === id);
target.getWorkerIdByTypeAndValue = async (type, value) => state.ids.find(row => row.typeId === type && row.value === value);
const repair = (dry = false) => target.reconcileWorkerId("w", "freeman_ein", "correct", dry, { typeId: "t631", value: "123" });
beforeEach(() => {
  state.ids = [row("source", "123", "t631")];
  state.deleted = [];
  state.failInsert = false;
  state.reconcile.mockReset().mockResolvedValue({ deleted: 2, created: 1 });
});

describe("authoritative EIN reconciliation", () => {
  it.each([[], [row("old", "wrong")], [row("a", "wrong"), row("b", "also-wrong")]].map(ids => ({ ids })))(
    "creates the authoritative value after deleting every nonmatch: %j", async ({ ids }) => {
      state.ids.push(...ids, row("other", "untouched", "other-type"));
      expect(await repair()).toEqual({ deleted: ids.length, created: 1 });
      expect(state.ids.filter(row => row.typeId === "freeman_ein")).toEqual([row("new", "correct")]);
      expect(state.ids.some(row => row.id === "other")).toBe(true);
      expect(await repair()).toEqual({ deleted: 0, created: 0 });
    },
  );
  it("preserves the exact matching row and deletes the rest", async () => {
    state.ids.push(row("keep", "correct"), row("drop", "wrong"));
    expect(await repair()).toEqual({ deleted: 1, created: 0 });
    expect(state.deleted).toEqual(["drop"]);
    expect(state.ids.some(row => row.id === "keep")).toBe(true);
  });
  it("previews without mutating", async () => {
    state.ids.push(row("old", "wrong"));
    const before = structuredClone(state.ids);
    expect(await repair(true)).toEqual({ deleted: 1, created: 1 });
    expect(state.ids).toEqual(before);
  });
  it("rolls back deletions when creation fails", async () => {
    state.ids.push(row("old", "wrong"));
    state.failInsert = true;
    await expect(repair()).rejects.toThrow("insert failed");
    expect(state.ids.some(row => row.id === "old")).toBe(true);
  });
  it("refuses another worker's value before deleting", async () => {
    state.ids.push(row("old", "wrong"), row("foreign", "correct", "freeman_ein", "other"));
    await expect(repair()).rejects.toThrow("ein_conflict");
    expect(state.deleted).toEqual([]);
  });
  it("refuses an ambiguous T631 mapping before deleting", async () => {
    state.ids.push(row("other-source", "456", "t631"), row("old", "wrong"));
    await expect(repair()).rejects.toThrow("ambiguous_t631_identity");
    expect(state.deleted).toEqual([]);
  });
});

describe("T631 source checks", () => {
  const sync = (workers: unknown[], dry = true) => syncWorkerEins({ success: true, data: { workers } }, dry);
  it("rejects all conflicting repetitions before any reconciliation", async () => {
    const result = await sync([{ worker_id: "123", worker_ein: "a" }, { worker_id: "123", worker_ein: "b" }]);
    expect(result.skipped).toBe(2);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("never uses a blank EIN fallback to delete existing IDs", async () => {
    const result = await sync([{ worker_id: "123", worker_ein: "" }]);
    expect(result.skipped).toBe(1);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it.each([true, false])("reconciles and reports exact deletion counts (dry=%s)", async dry => {
    const result = await sync([{ worker_id: "123", worker_ein: "correct" }], dry);
    expect(state.reconcile).toHaveBeenCalledWith("w", "freeman_ein", "correct", dry, { typeId: "t631", value: "123" });
    expect(result).toMatchObject({ deleted: 2, created: 1, updated: 1, errors: 0 });
  });
});
