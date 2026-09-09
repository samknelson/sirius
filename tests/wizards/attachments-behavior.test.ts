import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storage = {
    advisoryLock: { withTransactionLock: vi.fn() },
    wizards: { getById: vi.fn() },
    entityFiles: {
      createWithFile: vi.fn(),
      getByFileId: vi.fn(),
      list: vi.fn(),
      deleteWithFile: vi.fn(),
      transferFileOwnership: vi.fn(),
    },
    files: {
      getById: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    storage,
    upload: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
    resolveConfig: vi.fn(),
    expandDirectory: vi.fn(),
    extensionAllowed: vi.fn(),
    pluginGet: vi.fn(),
  };
});

vi.mock("../../server/storage", () => ({ storage: mocks.storage }));
vi.mock("../../server/services/files", () => ({
  fileSystemService: {
    upload: mocks.upload,
    download: mocks.download,
    remove: mocks.remove,
  },
}));
vi.mock("../../server/services/entity-files/config", () => ({
  resolveUsableContextConfig: mocks.resolveConfig,
  expandDirectoryTemplate: mocks.expandDirectory,
  isExtensionAllowed: mocks.extensionAllowed,
}));
vi.mock("../../server/plugins/wizards/registry", () => ({
  wizardPluginRegistry: { get: mocks.pluginGet },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: vi.fn(),
}));

import {
  WizardAttachmentConfigurationError,
  cleanupWizardAttachments,
  createWizardAttachment,
  downloadWizardAttachment,
  getWizardAttachment,
  listWizardAttachments,
  removeWizardAttachment,
  transferWizardAttachment,
} from "../../server/plugins/wizards/attachments";
import { checkWizardRecordAccess } from "../../server/plugins/wizards/entity-access";
import { FeedWizard } from "../../server/plugins/wizards/engine/feed";
import { getPolicy, type PolicyContext } from "../../shared/access-policies";
import {
  setEntityFilesReadAccessResolver,
} from "../../shared/access-policies/file/read";

const wizard = { id: "wiz-1", type: "employer_feed", entityId: "emp-1", status: "draft" };
const newFile = {
  id: "file-new",
  fileName: "input.csv",
  storagePath: "configured/wiz-1/input.csv",
  fileSystemId: "configured-fs",
  entityType: "entity-files:wizard",
  entityId: "wiz-1",
  uploadedBy: "user-1",
  mimeType: "text/csv",
  size: 3,
};
const legacyFile = {
  ...newFile,
  id: "file-old",
  entityType: "wizard",
  storagePath: "legacy/input.csv",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.wizards.getById.mockResolvedValue(wizard);
  mocks.storage.advisoryLock.withTransactionLock.mockImplementation(
    async (_key: string, fn: () => Promise<unknown>) => fn(),
  );
  mocks.resolveConfig.mockResolvedValue({
    config: { file_system: "configured-fs", directory: "wizards/:entity-id", allowed: ["csv"] },
  });
  mocks.expandDirectory.mockReturnValue("wizards/wiz-1");
  mocks.extensionAllowed.mockReturnValue(true);
  mocks.upload.mockResolvedValue({ storagePath: newFile.storagePath, size: 3 });
  mocks.storage.entityFiles.createWithFile.mockImplementation(
    async (_context: string, entityId: string, file: any, name: string) => ({
      id: "attachment-1", contextId: "wizard", entityId, fileId: "file-new",
      name, file: { ...file, id: "file-new" }, typeName: null,
    }),
  );
  mocks.storage.entityFiles.list.mockResolvedValue([]);
  mocks.storage.files.list.mockResolvedValue([]);
});

describe("wizard attachment persistence", () => {
  it("executes the feed generated-results producer through configured persistence", async () => {
    class TestFeed extends FeedWizard {
      name = "test";
      displayName = "Test";
      description = "Test feed";
    }
    const feed = new TestFeed();
    const generatedId = await (feed as any).generateResultsCsv(
      "wiz-1",
      { ...newFile, id: "source-file", fileName: "source.csv" },
      [["Name"], ["Alice"]],
      true,
      [{ rowIndex: 0, status: "success", message: "Imported" }],
    );
    expect(generatedId).toBe("file-new");
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({
      fileSystemId: "configured-fs",
      customPath: expect.stringMatching(/^wizards\/wiz-1\/\d+-source-results-\d{4}-\d{2}-\d{2}\.csv$/),
    }));
    expect(mocks.storage.entityFiles.createWithFile).toHaveBeenCalledWith(
      "wizard", "wiz-1",
      expect.objectContaining({
        entityType: "entity-files:wizard",
        fileSystemId: "configured-fs",
        metadata: { purpose: "feed-results" },
      }),
      expect.stringMatching(/^source-results-/),
    );
  });

  it("uses configured provider/path and preserves the returned files.id", async () => {
    const result = await createWizardAttachment({
      wizardId: "wiz-1", fileName: "input.csv", bytes: Buffer.from("abc"),
      mimeType: "text/csv", uploadedBy: "user-1",
    });
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({
      fileSystemId: "configured-fs",
      customPath: expect.stringMatching(/^wizards\/wiz-1\/\d+-input\.csv$/),
    }));
    expect(mocks.storage.entityFiles.createWithFile).toHaveBeenCalledWith(
      "wizard", "wiz-1",
      expect.objectContaining({ entityType: "entity-files:wizard", entityId: "wiz-1" }),
      "input.csv",
    );
    expect(result.id).toBe("file-new");
    expect(mocks.storage.advisoryLock.withTransactionLock).toHaveBeenCalledWith(
      "wizard-attachments:wiz-1", expect.any(Function),
    );
  });

  it("throws a clear configuration error before upload", async () => {
    mocks.resolveConfig.mockResolvedValue({ reason: "Configure Wizards under Config → Entity Files." });
    await expect(createWizardAttachment({
      wizardId: "wiz-1", fileName: "input.csv", bytes: Buffer.alloc(0), uploadedBy: "user-1",
    })).rejects.toBeInstanceOf(WizardAttachmentConfigurationError);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("refuses disallowed extensions before upload", async () => {
    mocks.extensionAllowed.mockReturnValue(false);
    await expect(createWizardAttachment({
      wizardId: "wiz-1", fileName: "input.exe", bytes: Buffer.alloc(0), uploadedBy: "user-1",
    })).rejects.toThrow("File type not allowed");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rechecks parent under the insertion lock after uploading bytes", async () => {
    mocks.storage.wizards.getById.mockResolvedValue(undefined);
    await expect(createWizardAttachment({
      wizardId: "wiz-1", fileName: "input.csv", bytes: Buffer.from("abc"), uploadedBy: "user-1",
    })).rejects.toThrow("no longer exists");
    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.storage.entityFiles.createWithFile).not.toHaveBeenCalled();
  });

  it("reads new attachments and only scoped legacy rows", async () => {
    mocks.storage.entityFiles.getByFileId.mockResolvedValueOnce({ file: newFile });
    expect(await getWizardAttachment("file-new", "wiz-1")).toBe(newFile);
    mocks.storage.entityFiles.getByFileId.mockResolvedValue(undefined);
    mocks.storage.files.getById.mockResolvedValue(legacyFile);
    expect(await getWizardAttachment("file-old", "wiz-1")).toBe(legacyFile);
    expect(await getWizardAttachment("file-old", "other-wizard")).toBeUndefined();
  });

  it("downloads scoped legacy bytes from their recorded provider", async () => {
    mocks.storage.entityFiles.getByFileId.mockResolvedValue(undefined);
    mocks.storage.files.getById.mockResolvedValue(legacyFile);
    mocks.download.mockResolvedValue(Buffer.from("legacy"));
    await expect(downloadWizardAttachment("file-old", "wiz-1")).resolves.toEqual(
      Buffer.from("legacy"),
    );
    expect(mocks.download).toHaveBeenCalledWith("configured-fs", "legacy/input.csv");
  });

  it("deduplicates overlap while listing", async () => {
    mocks.storage.entityFiles.list.mockResolvedValue([{ file: newFile }]);
    mocks.storage.files.list.mockResolvedValue([newFile, legacyFile]);
    expect((await listWizardAttachments("wiz-1")).map((f) => f.id)).toEqual([
      "file-new", "file-old",
    ]);
  });

  it("removes new and legacy files through their scoped paths", async () => {
    mocks.storage.entityFiles.getByFileId.mockResolvedValueOnce({
      id: "attachment-1", file: newFile,
    });
    mocks.storage.entityFiles.deleteWithFile.mockResolvedValue({ file: newFile });
    expect(await removeWizardAttachment("file-new", "wiz-1")).toBe(true);
    expect(mocks.storage.entityFiles.deleteWithFile).toHaveBeenCalledWith(
      "wizard", "wiz-1", "attachment-1",
    );

    mocks.storage.entityFiles.getByFileId.mockResolvedValue(undefined);
    mocks.storage.files.getById.mockResolvedValue(legacyFile);
    mocks.storage.files.delete.mockResolvedValue(true);
    expect(await removeWizardAttachment("file-old", "wiz-1")).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith("configured-fs", "legacy/input.csv");
  });

  it("transfers ownership through the transactional storage operation", async () => {
    mocks.storage.entityFiles.transferFileOwnership.mockResolvedValue({
      ...newFile, entityType: "esig", entityId: "sig-1",
    });
    const result = await transferWizardAttachment(
      "file-new", "wiz-1", { entityType: "esig", entityId: "sig-1" },
    );
    expect(mocks.storage.entityFiles.transferFileOwnership).toHaveBeenCalledWith(
      "wizard", "wiz-1", "file-new", { entityType: "esig", entityId: "sig-1" },
    );
    expect(result.entityId).toBe("sig-1");
  });

  it("continues per-file cleanup and reports rows that require a retry", async () => {
    mocks.storage.entityFiles.list
      .mockResolvedValueOnce([{ file: newFile }, { file: legacyFile }])
      .mockResolvedValueOnce([{ file: newFile }]);
    mocks.storage.files.list.mockResolvedValue([]);
    mocks.storage.entityFiles.getByFileId
      .mockResolvedValueOnce({ id: "attachment-1", file: newFile })
      .mockResolvedValueOnce({ id: "attachment-2", file: legacyFile });
    mocks.storage.entityFiles.deleteWithFile
      .mockRejectedValueOnce(new Error("row locked"))
      .mockResolvedValueOnce({ file: legacyFile });
    const result = await cleanupWizardAttachments("wiz-1");
    expect(mocks.storage.entityFiles.deleteWithFile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ complete: false, failedFileIds: ["file-new"] });

    // A later delete request can resume from the retained parent and remove
    // the row that failed the first attempt.
    mocks.storage.entityFiles.list
      .mockReset()
      .mockResolvedValueOnce([{ file: newFile }])
      .mockResolvedValueOnce([]);
    mocks.storage.files.list.mockReset().mockResolvedValue([]);
    mocks.storage.entityFiles.getByFileId
      .mockReset()
      .mockResolvedValue({ id: "attachment-1", file: newFile });
    mocks.storage.entityFiles.deleteWithFile
      .mockReset()
      .mockResolvedValue({ file: newFile });
    await expect(cleanupWizardAttachments("wiz-1")).resolves.toEqual({
      complete: true, failedFileIds: [],
    });
  });

  it("does not delete a durable file after transferring it out of wizard ownership", async () => {
    const durable = { ...newFile, entityType: "esig", entityId: "sig-1" };
    mocks.storage.entityFiles.transferFileOwnership.mockResolvedValue(durable);
    await transferWizardAttachment(
      "file-new", "wiz-1", { entityType: "esig", entityId: "sig-1" },
    );
    mocks.storage.entityFiles.list.mockResolvedValue([]);
    mocks.storage.files.list.mockResolvedValue([]);
    expect(await cleanupWizardAttachments("wiz-1")).toEqual({
      complete: true, failedFileIds: [],
    });
    expect(mocks.storage.entityFiles.deleteWithFile).not.toHaveBeenCalled();
    expect(mocks.storage.files.delete).not.toHaveBeenCalled();
  });

  it("drives transfer, failed cleanup, and retry from one mutable persistence state", async () => {
    const state = {
      wizard: { ...wizard } as any,
      files: new Map<string, any>(),
      attachments: new Map<string, any>(),
      failDelete: new Set<string>(),
    };
    let nextId = 0;
    mocks.storage.wizards.getById.mockImplementation(async () => state.wizard);
    mocks.upload.mockImplementation(async ({ customPath }: any) => ({
      storagePath: customPath, size: 3,
    }));
    mocks.storage.entityFiles.createWithFile.mockImplementation(
      async (_context: string, entityId: string, file: any, name: string) => {
        const id = `state-file-${++nextId}`;
        const stored = { ...file, id };
        state.files.set(id, stored);
        const attachment = {
          id: `state-attachment-${nextId}`, entityId, fileId: id, name, file: stored,
        };
        state.attachments.set(id, attachment);
        return attachment;
      },
    );
    mocks.storage.entityFiles.list.mockImplementation(async () =>
      [...state.attachments.values()]);
    mocks.storage.files.list.mockImplementation(async () =>
      [...state.files.values()].filter((f) =>
        f.entityType === "wizard" && f.entityId === "wiz-1"));
    mocks.storage.entityFiles.getByFileId.mockImplementation(
      async (_context: string, entityId: string, id: string) => {
        const row = state.attachments.get(id);
        return row?.entityId === entityId ? row : undefined;
      },
    );
    mocks.storage.entityFiles.deleteWithFile.mockImplementation(
      async (_context: string, _entityId: string, attachmentId: string) => {
        const row = [...state.attachments.values()].find((a) => a.id === attachmentId);
        if (!row) return undefined;
        if (state.failDelete.has(row.fileId)) throw new Error("simulated row failure");
        state.attachments.delete(row.fileId);
        state.files.delete(row.fileId);
        return { attachment: row, file: row.file };
      },
    );
    mocks.storage.entityFiles.transferFileOwnership.mockImplementation(
      async (_context: string, entityId: string, id: string, owner: any) => {
        const row = state.attachments.get(id);
        if (!row || row.entityId !== entityId) return undefined;
        state.attachments.delete(id);
        const durable = { ...state.files.get(id), ...owner };
        state.files.set(id, durable);
        return durable;
      },
    );

    const ordinary = await createWizardAttachment({
      wizardId: "wiz-1", fileName: "ordinary.csv",
      bytes: Buffer.from("one"), uploadedBy: "user-1",
    });
    const durable = await createWizardAttachment({
      wizardId: "wiz-1", fileName: "durable.pdf",
      bytes: Buffer.from("two"), uploadedBy: "user-1",
    });
    await transferWizardAttachment(
      durable.id, "wiz-1", { entityType: "esig", entityId: "sig-1" },
    );

    state.wizard.status = "deleting";
    state.failDelete.add(ordinary.id);
    const first = await cleanupWizardAttachments("wiz-1");
    if (first.complete) state.wizard = null;
    expect(first.complete).toBe(false);
    expect(state.wizard?.status).toBe("deleting");
    expect(state.files.get(durable.id)).toMatchObject({
      entityType: "esig", entityId: "sig-1",
    });

    state.failDelete.clear();
    const retry = await cleanupWizardAttachments("wiz-1");
    if (retry.complete) state.wizard = null;
    expect(retry.complete).toBe(true);
    expect(state.wizard).toBeNull();
    expect(state.attachments.size).toBe(0);
    expect(state.files.has(ordinary.id)).toBe(false);
    expect(state.files.get(durable.id)).toMatchObject({ entityType: "esig" });
  });
});

describe("persisted wizard authorization", () => {
  it("allows admin only after validating a registered scoped record", async () => {
    mocks.pluginGet.mockReturnValue({ entityType: "employer" });
    const check = vi.fn(async (policy: string) => policy === "admin");
    expect((await checkWizardRecordAccess("wiz-1", check, async () => true)).ok).toBe(true);
    expect(mocks.storage.wizards.getById).toHaveBeenCalled();
  });

  it("denies a missing record even to an admin", async () => {
    mocks.storage.wizards.getById.mockResolvedValue(undefined);
    const result = await checkWizardRecordAccess("missing", async () => true, async () => true);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 404 });
  });

  it("allows an admin to access a registered unscoped plugin", async () => {
    mocks.pluginGet.mockReturnValue({ requiredPolicy: "admin" });
    const result = await checkWizardRecordAccess(
      "wiz-1", async (policy) => policy === "admin", async () => true,
    );
    expect(result.ok).toBe(true);
  });

  it("uses the plugin's exact entity policy and owning entity id", async () => {
    mocks.pluginGet.mockReturnValue({
      entityType: "worker", entityAccessPolicy: "worker.cobra",
    });
    const check = vi.fn(async (policy: string, entityId?: string) =>
      policy === "worker.cobra" && entityId === "emp-1");
    expect((await checkWizardRecordAccess("wiz-1", check, async () => true)).ok).toBe(true);
    expect(check).toHaveBeenLastCalledWith("worker.cobra", "emp-1");
  });

  it("allows a real-shaped unscoped staff wizard and enforces its component", async () => {
    mocks.storage.wizards.getById.mockResolvedValue({
      ...wizard, type: "worker_ratings_import", entityId: null,
    });
    mocks.pluginGet.mockReturnValue({
      id: "worker_ratings_import",
      requiredComponent: "worker.ratings",
      requiredPolicy: "staff",
    });
    const staff = (policy: string) => Promise.resolve(policy === "staff");
    expect((await checkWizardRecordAccess(
      "wiz-1", staff, async (id) => id === "worker.ratings",
    )).ok).toBe(true);
    expect((await checkWizardRecordAccess(
      "wiz-1", staff, async () => false,
    )).ok).toBe(false);
  });

  it("requires both plugin policy and exact ownership for scoped plugins", async () => {
    mocks.pluginGet.mockReturnValue({
      entityType: "employer",
      requiredPolicy: "staff",
      entityAccessPolicy: "employer.mine",
    });
    const enabled = async () => true;
    expect((await checkWizardRecordAccess(
      "wiz-1", async (p, id) => p === "staff" || (p === "employer.mine" && id === "emp-1"),
      enabled,
    )).ok).toBe(true);
    expect((await checkWizardRecordAccess(
      "wiz-1", async (p) => p === "employer.mine",
      enabled,
    )).ok).toBe(false);
    expect((await checkWizardRecordAccess(
      "wiz-1", async (p) => p === "staff",
      enabled,
    )).ok).toBe(false);
  });

  it.each([
    ["missing", undefined, { entityType: "employer" }],
    ["unregistered", wizard, undefined],
    ["unscoped", { ...wizard, entityId: null }, { entityType: "employer" }],
  ])("denies %s records", async (_label, record, plugin) => {
    mocks.storage.wizards.getById.mockResolvedValue(record);
    mocks.pluginGet.mockReturnValue(plugin);
    expect((await checkWizardRecordAccess(
      "wiz-1", async () => false, async () => true,
    )).ok).toBe(false);
  });
});

describe("file.read wizard delegation", () => {
  const evaluate = async (
    discriminator: "wizard" | "entity-files:wizard",
    permissions: Set<string>,
    record: any = wizard,
    plugin: any = { entityType: "employer" },
    componentEnabled = true,
  ) => {
    mocks.storage.wizards.getById.mockResolvedValue(record);
    mocks.pluginGet.mockReturnValue(plugin);
    setEntityFilesReadAccessResolver(async (contextId, wizardId, ctx) => {
      if (contextId !== "wizard") return false;
      return (await checkWizardRecordAccess(
        wizardId,
        (policy, entityId) => ctx.checkPolicy(policy, entityId),
        (componentId) => ctx.isComponentEnabled(componentId),
      )).ok;
    });
    const ctx = {
      user: { id: "user-1", email: "user@example.test" },
      entityId: "download-file",
      loadEntity: vi.fn(async () => ({
        id: "download-file", entityType: discriminator, entityId: "wiz-1",
      })),
      checkPolicy: vi.fn(async (policy: string, entityId?: string) =>
        permissions.has(policy) &&
        (entityId === undefined || entityId === "emp-1")),
      hasPermission: vi.fn(async () => false),
      hasAnyPermission: vi.fn(async () => false),
      hasAllPermissions: vi.fn(async () => false),
      isComponentEnabled: vi.fn(async () => componentEnabled),
      getUserContact: vi.fn(async () => null),
      getUserWorker: vi.fn(async () => null),
      storage: mocks.storage,
    } as unknown as PolicyContext;
    return getPolicy("file.read")!.evaluate!(ctx);
  };

  it.each(["wizard", "entity-files:wizard"] as const)(
    "delegates %s for admin, exact owner, unrelated, and missing",
    async (discriminator) => {
      await expect(evaluate(discriminator, new Set(["admin"])))
        .resolves.toMatchObject({ granted: true });
      await expect(evaluate(discriminator, new Set(["employer.mine"])))
        .resolves.toMatchObject({ granted: true });
      await expect(evaluate(discriminator, new Set()))
        .resolves.toMatchObject({ granted: false });
      await expect(evaluate(discriminator, new Set(["admin"]), null))
        .resolves.toMatchObject({ granted: false });
    },
  );

  it.each(["wizard", "entity-files:wizard"] as const)(
    "allows staff to read unscoped enrollment/import %s results but denies unrelated/disabled",
    async (discriminator) => {
      const unscoped = {
        ...wizard, type: "worker_ratings_import", entityId: null,
      };
      const plugin = {
        requiredComponent: "worker.ratings",
        requiredPolicy: "staff",
      };
      await expect(evaluate(
        discriminator, new Set(["staff"]), unscoped, plugin,
      )).resolves.toMatchObject({ granted: true });
      await expect(evaluate(
        discriminator, new Set(), unscoped, plugin,
      )).resolves.toMatchObject({ granted: false });
      await expect(evaluate(
        discriminator, new Set(["staff"]), unscoped, plugin, false,
      )).resolves.toMatchObject({ granted: false });
    },
  );
});