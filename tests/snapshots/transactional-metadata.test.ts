import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordMutation, recordSubrecordTouch, recordDeletion, afterCommit } = vi.hoisted(() => ({
  recordMutation: vi.fn(),
  recordSubrecordTouch: vi.fn(),
  recordDeletion: vi.fn(),
  afterCommit: vi.fn(),
}));

vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: {
    recordMutation,
    recordSubrecordTouch,
    recordDeletion,
  },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  isInTransaction: () => true,
  onAfterCommit: afterCommit,
  runOutsideTransaction: async (fn: () => unknown) => fn(),
}));

vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => ({ userId: "actor-1" }),
  isFrameworkWrite: () => false,
}));

vi.mock("../../server/logger", () => ({
  storageLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { setStorageLogSampling, withStorageLogging } = await import("../../server/storage/middleware/logging");

describe("transactional entity metadata logging", () => {
  beforeEach(() => {
    recordMutation.mockReset();
    recordSubrecordTouch.mockReset();
    recordDeletion.mockReset();
    afterCommit.mockReset();
    setStorageLogSampling(null);
  });

  it("writes metadata before the save returns instead of queuing it after commit", async () => {
    const storage = withStorageLogging(
      {
        async save() {
          return { id: "record-1" };
        },
      },
      {
        module: "snapshot-test",
        table: "snapshot_test_records",
        metadataTiming: "transactional",
        methods: {
          save: {
            getEntityId: (_args, result) => result?.id,
            getDescription: async () => "Saved record",
          },
        },
      },
    );

    await storage.save();

    expect(recordMutation).toHaveBeenCalledWith({
      tableName: "snapshot_test_records",
      entityId: "record-1",
      at: expect.any(Date),
      actorId: "actor-1",
      created: false,
    });
    expect(recordSubrecordTouch).not.toHaveBeenCalled();
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("lets a bulk child operation advance only its host history", async () => {
    const storage = withStorageLogging(
      {
        async createMany() {
          return [{ sheetId: "sheet-1" }];
        },
      },
      {
        module: "snapshot-test",
        table: "snapshot_test_children",
        hostTable: "snapshot_test_sheets",
        metadataTiming: "transactional",
        methods: {
          createMany: {
            metadataHostTouch: true,
            getEntityId: () => "bulk create",
            getHostEntityId: (_args, result) => result?.[0]?.sheetId,
            getDescription: async () => "Created children",
          },
        },
      },
    );

    await storage.createMany();

    expect(recordMutation).not.toHaveBeenCalled();
    expect(recordSubrecordTouch).toHaveBeenCalledWith({
      tableName: "snapshot_test_sheets",
      entityId: "sheet-1",
      at: expect.any(Date),
      actorId: "actor-1",
    });
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("keeps direct deletes removing the record's metadata", async () => {
    const storage = withStorageLogging(
      {
        async delete(id: string) {
          return id === "record-1";
        },
      },
      {
        module: "snapshot-test",
        table: "snapshot_test_records",
        metadataTiming: "transactional",
        methods: {
          delete: {
            getEntityId: (args) => args[0],
            getDescription: async () => "Deleted record",
          },
        },
      },
    );

    await storage.delete("record-1");

    expect(recordDeletion).toHaveBeenCalledWith({
      tableName: "snapshot_test_records",
      entityId: "record-1",
    });
    expect(recordMutation).not.toHaveBeenCalled();
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("keeps child and parent metadata when a create audit row is sampled out", async () => {
    setStorageLogSampling(0);
    const storage = withStorageLogging(
      {
        async create() {
          return { id: "child-1", parentId: "parent-1" };
        },
      },
      {
        module: "sampled-create-test",
        table: "sampled_children",
        hostTable: "sampled_parents",
        metadataTiming: "transactional",
        methods: {
          create: {
            getEntityId: (_args, result) => result?.parentId,
            metadataEntityId: (_args, result) => result?.id,
            getHostEntityId: (_args, result) => result?.parentId,
          },
        },
      },
    );

    await storage.create();

    expect(recordMutation).toHaveBeenCalledWith(expect.objectContaining({
      tableName: "sampled_children",
      entityId: "child-1",
      created: true,
    }));
    expect(recordSubrecordTouch).toHaveBeenCalledWith(expect.objectContaining({
      tableName: "sampled_parents",
      entityId: "parent-1",
    }));
  });

  it("keeps the parent touch when a delete audit row is sampled out", async () => {
    setStorageLogSampling(0);
    const storage = withStorageLogging(
      {
        async get(id: string) {
          return { id, parentId: "parent-1" };
        },
        async delete(_id: string) {
          return true;
        },
      },
      {
        module: "sampled-delete-test",
        table: "sampled_children",
        hostTable: "sampled_parents",
        metadataTiming: "transactional",
        methods: {
          delete: {
            before: async (args, rawStorage) => rawStorage.get(args[0]),
            getEntityId: (args) => args[0],
            getHostEntityId: (_args, _result, beforeState) => beforeState?.parentId,
          },
        },
      },
    );

    await storage.delete("child-1");

    expect(recordDeletion).toHaveBeenCalledWith({
      tableName: "sampled_children",
      entityId: "child-1",
    });
    expect(recordSubrecordTouch).toHaveBeenCalledWith(expect.objectContaining({
      tableName: "sampled_parents",
      entityId: "parent-1",
    }));
  });
});