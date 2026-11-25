import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage/system/component-ownership", () => ({
  componentOwnershipStorage: { read: async () => ({}) },
}));

const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), inTransaction: vi.fn(() => false),
  afterCommit: vi.fn(),
}));
vi.mock("../../server/storage/configuration-revisions", () => ({
  readConfigurationSnapshot: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { variables: { getJsonState: mocks.read, upsertJsonBooleanKey: mocks.write } },
}));
vi.mock("../../server/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  isInTransaction: mocks.inTransaction, onAfterCommit: mocks.afterCommit,
  runOutsideTransaction: (fn: () => unknown) => fn(),
}));

async function cache() {
  return import("../../server/services/component-cache");
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.inTransaction.mockReturnValue(false);
  mocks.read.mockResolvedValue({ value: { facility: false }, version: "1" });
  mocks.write.mockResolvedValue({});
});

describe("committed component state", () => {
  it("keeps direct status reads independent of stale/uninitialized cache and broken listeners", async () => {
    const c = await cache();
    await c.loadComponentCache();
    const revision = c.getComponentCacheRevision();
    const listener = vi.fn(() => { throw new Error("Listener failed"); });
    c.onComponentCacheChange(listener);
    mocks.read.mockResolvedValue({ value: { facility: true }, version: "2" });
    const { getComponentConfigsFromStorage } = await import("../../server/services/component-state");
    expect((await getComponentConfigsFromStorage()).find(row => row.componentId === "facility")?.enabled).toBe(true);
    expect(c.isComponentEnabledSync("facility")).toBe(false);
    expect(c.getComponentCacheRevision()).toBe(revision);
    expect(listener).not.toHaveBeenCalled();
    c.invalidateComponentCache();
    const invalidatedRevision = c.getComponentCacheRevision();
    expect((await getComponentConfigsFromStorage()).find(row => row.componentId === "facility")?.enabled).toBe(true);
    expect(c.isCacheInitialized()).toBe(false);
    expect(c.getComponentCacheRevision()).toBe(invalidatedRevision);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not invalidate derived caches on unchanged reads", async () => {
    const c = await cache();
    await c.loadComponentCache();
    const revision = c.getComponentCacheRevision();
    await c.loadComponentCache();
    expect(c.getComponentCacheRevision()).toBe(revision);
    expect(Object.isFrozen(c.getComponentCache())).toBe(true);
  });

  it("notices same-value committed repairs through the database row version", async () => {
    const c = await cache();
    await c.loadComponentCache();
    const changed = vi.fn();
    c.onComponentCacheChange(changed);
    mocks.read.mockResolvedValue({ value: { facility: false }, version: "2" });
    await c.loadComponentCache();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("does not mutate the cache when persistence fails", async () => {
    const c = await cache();
    await c.loadComponentCache();
    mocks.write.mockRejectedValueOnce(new Error("Write refused"));
    await expect(c.updateComponentCache("facility", true)).rejects.toThrow("Write refused");
    expect(c.isComponentEnabledSync("facility")).toBe(false);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("patches one key at the storage boundary and then reads confirmed state", async () => {
    const c = await cache();
    await c.loadComponentCache();
    mocks.read.mockResolvedValue({ value: { facility: true, "future.retained": true }, version: "2" });
    await c.updateComponentCache("facility", true);
    expect(mocks.write).toHaveBeenCalledWith("components", "facility", true);
    expect(c.getComponentCache()).toEqual({ facility: true, "future.retained": true });
    expect(c.isComponentEnabledSync("future.retained")).toBe(false);
  });

  it("defers publication until an outer transaction actually commits", async () => {
    const c = await cache();
    await c.loadComponentCache();
    mocks.inTransaction.mockReturnValue(true);
    await c.updateComponentCache("facility", true);
    expect(mocks.afterCommit).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(c.isComponentEnabledSync("facility")).toBe(false);
  });

  it("does not let an earlier slow read undo a newer confirmed read", async () => {
    const c = await cache();
    let finish!: (result: unknown) => void;
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const oldRead = c.loadComponentCache();
    mocks.read.mockResolvedValueOnce({ value: { facility: true }, version: "2" });
    await c.loadComponentCache();
    finish({ value: { facility: false }, version: "1" });
    await oldRead;
    expect(c.isComponentEnabledSync("facility")).toBe(true);
  });

  it.each([[], "invalid", { facility: "true" }])("refuses malformed persisted state: %j", async value => {
    const c = await cache();
    await c.loadComponentCache();
    mocks.read.mockResolvedValueOnce({ value, version: "2" });
    await expect(c.loadComponentCache()).rejects.toThrow("boolean flags");
    expect(c.isCacheInitialized()).toBe(false);
    expect(() => c.isComponentEnabledSync("facility")).toThrow();
  });

  it("fails closed on unreadable state and recovers after a successful refresh", async () => {
    const c = await cache();
    await c.loadComponentCache();
    mocks.read.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(c.loadComponentCache()).rejects.toThrow("Database unavailable");
    expect(() => c.isComponentEnabledSync("facility")).toThrow();
    await c.loadComponentCache();
    expect(c.isComponentEnabledSync("facility")).toBe(false);
  });

  it("does not let an earlier failed read invalidate newer confirmed state", async () => {
    const c = await cache();
    let fail!: (error: Error) => void;
    mocks.read.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const oldRead = c.loadComponentCache();
    await c.loadComponentCache();
    fail(new Error("Old query failed"));
    await expect(oldRead).rejects.toThrow("Old query failed");
    expect(c.isCacheInitialized()).toBe(true);
  });
});
