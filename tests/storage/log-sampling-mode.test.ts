import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  readMode: vi.fn(), select: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  mutation: vi.fn(), deletion: vi.fn(), touch: vi.fn(),
  framework: false,
}));
vi.mock("../../server/storage/db", () => ({
  db: { select: io.select },
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: {
    recordMutation: io.mutation, recordDeletion: io.deletion, recordSubrecordTouch: io.touch,
  },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  isInTransaction: () => false,
  onAfterCommit: (fn: () => void) => fn(),
  runOutsideTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => undefined, isFrameworkWrite: () => io.framework,
}));
vi.mock("../../server/logger", () => ({
  storageLogger: { info: io.info, warn: io.warn, error: io.error, debug: vi.fn() },
}));

const { setStorageLogSampling, withStorageLogging, flushDeferredStorageWork } =
  await import("../../server/storage/middleware/logging");
const { hasVerifiedMaintenanceMode } = await import("../../server/storage/system/verified-maintenance");
const before = vi.fn(async () => ({ id: "record", value: "old" }));
const after = vi.fn(async () => ({ id: "record", value: "new" }));
const storage = withStorageLogging({
  async save(fail = false) {
    if (fail) throw new Error("write failed");
    return { id: "record" };
  },
  async other() { return { id: "other" }; },
}, {
  module: "sampling-test", table: "sampling_records",
  methods: {
    save: { before, after, getEntityId: () => "record" },
    other: { getEntityId: () => "other" },
  },
});
async function operations() {
  await storage.save();
  await expect(storage.save(true)).rejects.toThrow("write failed");
  await flushDeferredStorageWork();
}

beforeEach(async () => {
  await flushDeferredStorageWork();
  await setStorageLogSampling(null);
  vi.clearAllMocks();
  io.framework = false;
  io.select.mockImplementation(() => ({ from: () => ({ where: io.readMode }) }));
  io.readMode.mockReset().mockResolvedValue([{ value: "maintenance" }]);
});

describe("verified target maintenance authorization", () => {
  it.each(["live", "dev", "test", undefined, null, "", "MAINTENANCE", {}, ["maintenance"]])(
    "refuses unverified mode %j for both suppression and positive sampling",
    async value => {
      io.readMode.mockResolvedValue(value === undefined ? [] : [{ value }]);
      for (const frequency of [0, 3]) {
        await expect(setStorageLogSampling(frequency)).rejects.toThrow("requires verified maintenance");
        expect(io.warn).toHaveBeenLastCalledWith(
          expect.stringContaining("sampling refused"),
          expect.objectContaining({ sampleEvery: frequency, phase: "activation" }),
        );
        await operations();
      }
      expect(io.warn).toHaveBeenCalledTimes(2);
      expect(io.info).toHaveBeenCalledTimes(2);
      expect(io.error).toHaveBeenCalledTimes(2);
      expect(after).toHaveBeenCalledTimes(2);
      expect(io.mutation).toHaveBeenCalledTimes(2);
    },
  );

  it("fails closed when the authoritative read fails without swallowing storage failures", async () => {
    io.readMode.mockRejectedValue(new Error("database unavailable"));
    await expect(setStorageLogSampling(0)).rejects.toThrow("requires verified maintenance");
    await operations();
    expect(io.info).toHaveBeenCalledOnce();
    expect(io.error).toHaveBeenCalledOnce();
  });

  it("reads fresh target configuration rather than an ambient or boot flag", async () => {
    expect(await hasVerifiedMaintenanceMode()).toBe(true);
    io.readMode.mockResolvedValue([{ value: "live" }]);
    expect(await hasVerifiedMaintenanceMode()).toBe(false);
    expect(io.select).toHaveBeenCalledTimes(2);
  });
});

describe("sampling and ordinary logging", () => {
  it("suppresses success and error audit rows only in maintenance, retaining all successful metadata", async () => {
    await setStorageLogSampling(0);
    await operations();
    expect(io.info).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(before).toHaveBeenCalledTimes(2);
    expect(io.mutation).toHaveBeenCalledOnce();
    expect(io.readMode).toHaveBeenCalledTimes(3);
  });

  it("samples the first and every Nth subsequent call independently per operation", async () => {
    await setStorageLogSampling(3);
    for (let i = 0; i < 7; i++) {
      await storage.save();
      await storage.other();
    }
    await flushDeferredStorageWork();
    expect(io.info).toHaveBeenCalledTimes(6); // 1, 4, 7 for each method
    expect(after).toHaveBeenCalledTimes(3);
    expect(io.mutation).toHaveBeenCalledTimes(14);
    await setStorageLogSampling(3); // resetting the frequency resets its counters
    await storage.save();
    await flushDeferredStorageWork();
    expect(after).toHaveBeenCalledTimes(4);
  });

  it.each([null, 1, -1, NaN, Infinity])("restores full logging with %s without a mode read", async reset => {
    await setStorageLogSampling(0);
    io.readMode.mockClear();
    await setStorageLogSampling(reset);
    await operations();
    expect(io.readMode).not.toHaveBeenCalled();
    expect(io.info).toHaveBeenCalledOnce();
    expect(io.error).toHaveBeenCalledOnce();
  });

  it("normalizes a positive fractional frequency to its integer", async () => {
    await setStorageLogSampling(2.9);
    for (let i = 0; i < 4; i++) await storage.save();
    await flushDeferredStorageWork();
    expect(io.info).toHaveBeenCalledTimes(2);
  });

  it.each([0.5, 1.9])("preserves legacy floor normalization for %s, still requiring maintenance", async frequency => {
    io.readMode.mockResolvedValue([{ value: "live" }]);
    await expect(setStorageLogSampling(frequency)).rejects.toThrow("requires verified maintenance");
    io.readMode.mockResolvedValue([{ value: "maintenance" }]);
    await setStorageLogSampling(frequency);
    await operations();
    expect(io.info).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
  });

  it("includes failed calls in each operation's sampling count", async () => {
    await setStorageLogSampling(2);
    await expect(storage.save(true)).rejects.toThrow("write failed"); // 1: audited
    await storage.save(); // 2: sampled out
    await storage.save(); // 3: audited
    await expect(storage.save(true)).rejects.toThrow("write failed"); // 4: sampled out
    await flushDeferredStorageWork();
    expect(io.error).toHaveBeenCalledOnce();
    expect(io.info).toHaveBeenCalledOnce();
    expect(io.mutation).toHaveBeenCalledTimes(2);
  });

  it.each(["live", undefined, "invalid", "read-failure"])("revokes active sampling on transition to %s", async mode => {
    await setStorageLogSampling(0);
    await storage.save();
    if (mode === "read-failure") io.readMode.mockRejectedValue(new Error("read failed"));
    else io.readMode.mockResolvedValue(mode === undefined ? [] : [{ value: mode }]);
    await operations();
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining("sampling refused"),
      expect.objectContaining({ phase: "operation" }));
    io.readMode.mockResolvedValue([{ value: "maintenance" }]);
    await storage.save(); // maintenance re-entry must not restore bypass
    await flushDeferredStorageWork();
    expect(io.info).toHaveBeenCalledTimes(2);
    expect(io.error).toHaveBeenCalledOnce();
    expect(io.mutation).toHaveBeenCalledTimes(3);
  });

  it("does not reactivate an in-flight request after a full-logging reset", async () => {
    let release!: (rows: Array<{ value: string }>) => void;
    io.readMode.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const activation = setStorageLogSampling(0);
    await vi.waitFor(() => expect(io.readMode).toHaveBeenCalledOnce());
    await setStorageLogSampling(null);
    release([{ value: "maintenance" }]);
    await activation;
    await operations();
    expect(io.info).toHaveBeenCalledOnce();
    expect(io.error).toHaveBeenCalledOnce();
  });

  it("keeps the no-bypass fast path and framework-write exclusion", async () => {
    await operations();
    expect(io.select).not.toHaveBeenCalled();
    io.framework = true;
    await operations();
    expect(io.info).toHaveBeenCalledOnce();
    expect(io.error).toHaveBeenCalledTimes(2);
    expect(io.mutation).toHaveBeenCalledTimes(2);
  });

  it("still waits for sampled-out deferred metadata to finish", async () => {
    await setStorageLogSampling(0);
    let release!: () => void;
    io.mutation.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await storage.save();
    let drained = false;
    const flush = flushDeferredStorageWork().then(() => { drained = true; });
    await vi.waitFor(() => expect(io.mutation).toHaveBeenCalledOnce());
    expect(drained).toBe(false);
    release();
    await flush;
    expect(drained).toBe(true);
  });
});
