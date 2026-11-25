import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: duplicate EIN rows used to be skipped indefinitely. Keep this
// DB-free check of destructive reconciliation and source-conflict refusal.
const state = vi.hoisted(() => ({
  ids: [] as Array<{ id: string; workerId: string; typeId: string; value: string }>,
  failInsert: false,
  deleted: [] as string[],
  reconcile: vi.fn(),
  syncStatus: false,
  currentStatus: false,
  deactivate: vi.fn(),
  candidates: vi.fn(),
}));
vi.mock("../../../../server/storage/transaction-context", () => ({
  getClient: () => ({
    execute: async () => ({}),
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ id: "w" }]), { for: async () => [{ id: "w" }] }) }) }),
  }),
  runInTransaction: async (fn: () => Promise<unknown>) => {
    const before = structuredClone(state.ids);
    try { return await fn(); } catch (error) { state.ids = before; throw error; }
  },
}));
vi.mock("../../../../server/storage/middleware/logging", () => ({}));
vi.mock("../../../../server/storage/database", () => ({
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
vi.mock("../../../../server/storage", () => ({
  createCommSmsOptinStorage: () => ({}),
  storage: {
    variables: { getByName: async () => state.syncStatus ? { value: ["ms"] } : null },
    workerMsh: {
      getWorkerIdsWithCurrentMs: (...args: unknown[]) => state.candidates(...args),
      getCurrentMemberStatusIds: async () => state.currentStatus ? ["ms"] : [],
    },
    workerEdls: {
      getByWorker: async () => ({ active: true }),
      setActive: state.deactivate,
    },
    workerIds: {
      withLockedIdentityReads: async (work: () => Promise<unknown>) => work(),
      getTypeIdBySiriusId: async (id: string) => id,
      getWorkerIdByTypeAndValue: async (type: string, value: string) =>
        state.ids.find(row => row.typeId === type && row.value === value),
      getByTypeAndValues: async (type: string, values: string[]) =>
        state.ids.filter(row => row.typeId === type && values.includes(row.value)),
      resolveT631Identity: (...args: Parameters<typeof target.resolveT631Identity>) => target.resolveT631Identity(...args),
      reconcileWorkerId: state.reconcile,
    },
    workers: { getWorkerContactId: async () => undefined },
  },
}));
vi.mock("../../../../server/services/comm/validators/phone", () => ({ schedulePhoneRevalidation: vi.fn() }));
vi.mock("../../../../server/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() }, storageLogger: { info: vi.fn() } }));
vi.mock("../../../../server/modules/options-registry", () => ({ getOptionsType: () => ({
  getAll: async () => state.syncStatus ? [{ id: "ms", industryId: "industry", siriusId: "APP", name: "Apprentice" }] : [],
}) }));

import { createWorkerIdStorage } from "../../../../server/storage/workers/ids";
import { syncWorkerEins } from "../../server/modules/t631/sync-workers";

const row = (id: string, value: string, typeId = "freeman_ein", workerId = "w") => ({ id, value, typeId, workerId });
const target = createWorkerIdStorage();
target.getWorkerIdsByWorkerId = async id => state.ids.filter(row => row.workerId === id);
target.getWorkerIdByTypeAndValue = async (type, value) => state.ids.find(row => row.typeId === type && row.value === value);
target.getByTypeAndValues = async (type, values) => state.ids.filter(row => row.typeId === type && values.includes(row.value));
const repair = (dry = false) => target.reconcileWorkerId("w", "freeman_ein", "correct", dry, { typeId: "t631", value: "123" });
beforeEach(() => {
  state.ids = [row("source", "123", "t631")];
  state.deleted = [];
  state.failInsert = false;
  state.syncStatus = state.currentStatus = false;
  state.deactivate.mockReset();
  state.candidates.mockReset().mockResolvedValue([{ workerId: "w", msId: "ms" }]);
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
  it("revalidates missing-worker status inside its fenced unit", async () => {
    state.syncStatus = true;
    const result = await syncWorkerEins({ success: true, data: { workers: [] } }, false, async work => {
      // Candidate held the selected status at enumeration, but no longer does.
      state.currentStatus = false;
      await work();
    });
    expect(state.candidates).toHaveBeenCalledWith(["ms"], true);
    expect(state.deactivate).not.toHaveBeenCalled();
    expect(result.edlsDeactivated).toBe(0);
  });
  it("keeps seen-worker protection for a rejected source row", async () => {
    state.syncStatus = state.currentStatus = true;
    const result = await sync([{ worker_id: "123", worker_ein: "" }], false);
    expect(result.skipped).toBe(1);
    expect(state.deactivate).not.toHaveBeenCalled();
  });
  it.each([true, false])("preserves missing-worker preview/live results (dry=%s)", async dry => {
    state.syncStatus = state.currentStatus = true;
    const result = await sync([], dry);
    expect(result.edlsDeactivated).toBe(1);
    expect(state.deactivate).toHaveBeenCalledTimes(dry ? 0 : 1);
  });
});

describe("T631 EIN fallback", () => {
  const resolve = (value = "I123", dry = false, ein = "correct") =>
    target.resolveT631Identity("t631", value, "freeman_ein", ein, dry);
  it("reuses numeric identity without changing its spelling", async () => {
    expect(await resolve()).toEqual({ workerId: "w", value: "123", linked: false });
    expect(state.ids).toHaveLength(1);
  });
  it("links an EIN owner and is idempotent", async () => {
    state.ids = [row("ein", "correct")];
    expect(await resolve()).toEqual({ workerId: "w", value: "I123", linked: true });
    expect(await resolve()).toMatchObject({ linked: false });
    expect(state.ids.filter(r => r.typeId === "t631")).toHaveLength(1);
  });
  it("previews attachment without writing", async () => {
    state.ids = [row("ein", "correct")];
    expect(await resolve("I123", true)).toMatchObject({ linked: true });
    expect(state.ids).toHaveLength(1);
  });
  it("rejects an EIN owner with another T631 identity", async () => {
    state.ids.push(row("ein", "correct"));
    await expect(resolve("I456")).rejects.toThrow("t631_conflict");
  });
  it("rejects aliases belonging to different workers", async () => {
    state.ids.push(row("alias", "I123", "t631", "other"));
    await expect(resolve()).rejects.toThrow("ambiguous_t631_identity");
  });
  it("rejects a T631 match whose EIN belongs elsewhere", async () => {
    state.ids.push(row("ein", "correct", "freeman_ein", "other"));
    await expect(resolve()).rejects.toThrow("ein_conflict");
  });
  it("does not use blank EINs or unrelated prefixes as matches", async () => {
    state.ids = [row("ein", "I456")];
    expect(await resolve("I456", false, "")).toBeNull();
    expect(await resolve("O456", false, "")).toBeNull();
  });
  it("rolls back an unsuccessful attachment", async () => {
    state.ids = [row("ein", "correct")];
    state.failInsert = true;
    await expect(resolve()).rejects.toThrow("insert failed");
    expect(state.ids).toEqual([row("ein", "correct")]);
  });
  it.each([true, false])("links without requiring a name (dry=%s)", async dry => {
    state.ids = [row("ein", "correct")];
    const result = await syncWorkerEins({ success: true, data: { workers: [
      { worker_id: "I123", worker_ein: "correct" },
    ] } }, dry);
    expect(result.errors).toBe(0);
    expect(result.workersCreated).toBe(0);
    expect(result.details.some(d => d.action === (dry ? "would_link_t631" : "linked_t631"))).toBe(true);
    if (dry) expect(state.reconcile).not.toHaveBeenCalled();
    else expect(state.reconcile).toHaveBeenCalledWith("w", "freeman_ein", "correct", false, { typeId: "t631", value: "I123" });
  });
  it("prevalidates conflicting EINs across alternate source spellings", async () => {
    const result = await syncWorkerEins({ success: true, data: { workers: [
      { worker_id: "I123", worker_ein: "a" }, { worker_id: "123", worker_ein: "b" },
    ] } }, false);
    expect(result.skipped).toBe(2);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it.each([true, false])("rejects all competing EIN claimants before linking (dry=%s)", async dry => {
    state.ids = [row("ein", "correct")];
    const result = await syncWorkerEins({ success: true, data: { workers: [
      { worker_id: "I123", worker_ein: "correct" }, { worker_id: "I456", worker_ein: "correct" },
    ] } }, dry);
    expect(result.details.filter(d => d.action === "would_link_t631" || d.action === "linked_t631")).toHaveLength(0);
    expect(result.skipped).toBe(2);
    expect(state.ids).toHaveLength(1);
  });
  it("treats numeric and I forms as one incoming EIN claimant", async () => {
    state.ids = [row("ein", "correct")];
    const result = await syncWorkerEins({ success: true, data: { workers: [
      { worker_id: "I123", worker_ein: "correct" }, { worker_id: "123", worker_ein: "correct" },
    ] } }, false);
    expect(result.details.filter(d => d.action === "linked_t631")).toHaveLength(1);
    expect(result.details.some(d => d.error?.startsWith("conflicting_source_t631_ids"))).toBe(false);
  });
});
