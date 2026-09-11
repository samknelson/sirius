import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createLog,
  recordDeletion,
  recordMutation,
  recordSubrecordTouch,
  storageInfo,
} = vi.hoisted(() => ({
  createLog: vi.fn(),
  recordDeletion: vi.fn(),
  recordMutation: vi.fn(),
  recordSubrecordTouch: vi.fn(),
  storageInfo: vi.fn(),
}));

vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: {
    recordDeletion,
    recordMutation,
    recordSubrecordTouch,
  },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  isInTransaction: () => false,
  onAfterCommit: (callback: () => void) => callback(),
  runOutsideTransaction: async (callback: () => unknown) => callback(),
}));

vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => undefined,
  isFrameworkWrite: () => false,
}));

vi.mock("../../server/logger", () => ({
  storageLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: storageInfo,
    warn: vi.fn(),
  },
}));

vi.mock("../../server/storage/system/logs", () => ({
  createLogsStorage: () => ({ create: createLog }),
}));

const {
  flushDeferredStorageWork,
  withStorageLogging,
} = await import("../../server/storage/middleware/logging");
const {
  flushPendingLogWrites,
  LogsTransport,
} = await import("../../server/services/logs-transport");

describe("standalone storage side-effect draining", () => {
  beforeEach(() => {
    createLog.mockReset();
    recordDeletion.mockReset();
    recordMutation.mockReset();
    recordSubrecordTouch.mockReset();
    storageInfo.mockReset();
  });

  it("waits for deferred entity metadata and audit work", async () => {
    const storage = withStorageLogging(
      {
        async create() {
          return { id: "record-1" };
        },
      },
      {
        module: "drain-test",
        table: "drain_test_records",
        methods: {
          create: {
            getEntityId: (_args, result) => result?.id,
          },
        },
      },
    );

    await storage.create();
    await flushDeferredStorageWork();

    expect(recordMutation).toHaveBeenCalledWith(expect.objectContaining({
      tableName: "drain_test_records",
      entityId: "record-1",
      created: true,
    }));
    expect(storageInfo).toHaveBeenCalledOnce();
  });

  it("waits for the database-backed Winston transport callback", async () => {
    let releaseWrite: (() => void) | undefined;
    createLog.mockImplementation(() => new Promise<void>((resolve) => {
      releaseWrite = resolve;
    }));

    const transport = new LogsTransport();
    const callback = vi.fn();
    transport.log({ level: "info", message: "test" }, callback);

    const flushing = flushPendingLogWrites();
    await new Promise((resolve) => setImmediate(resolve));
    expect(callback).not.toHaveBeenCalled();

    releaseWrite?.();
    await flushing;

    expect(createLog).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });
});