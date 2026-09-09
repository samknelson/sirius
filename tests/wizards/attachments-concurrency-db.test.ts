import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../server/services/files", () => ({
  fileSystemService: {
    upload: provider.upload,
    remove: provider.remove,
  },
}));

vi.mock("../../server/services/entity-files/config", () => ({
  resolveUsableContextConfig: vi.fn(async () => ({
    config: {
      file_system: "wizard-concurrency-test",
      directory: "wizards/:entity-id",
      allowed: ["txt"],
    },
  })),
  expandDirectoryTemplate: vi.fn((_template: string, id: string) => `wizards/${id}`),
  isExtensionAllowed: vi.fn(() => true),
}));

import { storage } from "../../server/storage";
import {
  cleanupWizardAttachments,
  createWizardAttachment,
} from "../../server/plugins/wizards/attachments";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function markDeleting(wizardId: string): Promise<void> {
  await storage.advisoryLock.withTransactionLock(
    `wizard-attachments:${wizardId}`,
    async () => {
      const current = await storage.wizards.getById(wizardId);
      if (current && current.status !== "deleting") {
        await storage.wizards.update(wizardId, { status: "deleting" });
      }
    },
  );
}

async function finishDeleting(wizardId: string): Promise<boolean> {
  return storage.advisoryLock.withTransactionLock(
    `wizard-attachments:${wizardId}`,
    async () => {
      const current = await storage.wizards.getById(wizardId);
      if (!current || current.status !== "deleting") return false;
      const [attachments, legacyFiles] = await Promise.all([
        storage.entityFiles.list("wizard", wizardId),
        storage.files.list({ entityType: "wizard", entityId: wizardId }),
      ]);
      if (attachments.length || legacyFiles.length) return false;
      return storage.wizards.delete(wizardId);
    },
  );
}

describe.sequential("wizard attachment deletion concurrency (database)", () => {
  const wizardId = `wizard-attachment-race-${process.pid}`;
  const existingPath = `wizards/${wizardId}/existing.txt`;
  const uploadedPath = `wizards/${wizardId}/racing.txt`;
  let originalDeleteWithFile: typeof storage.entityFiles.deleteWithFile;

  beforeEach(async () => {
    provider.upload.mockReset();
    provider.remove.mockReset().mockResolvedValue(undefined);
    originalDeleteWithFile = storage.entityFiles.deleteWithFile;

    await storage.wizards.delete(wizardId);
    await storage.wizards.create({
      id: wizardId,
      type: "attachment-concurrency-test",
      status: "draft",
      data: {},
    });
    await storage.entityFiles.createWithFile(
      "wizard",
      wizardId,
      {
        fileName: "existing.txt",
        storagePath: existingPath,
        mimeType: "text/plain",
        size: 8,
        uploadedBy: "wizard-concurrency-test",
        entityType: "entity-files:wizard",
        entityId: wizardId,
        fileSystemId: "wizard-concurrency-test",
      },
      "existing.txt",
    );
  });

  afterEach(async () => {
    storage.entityFiles.deleteWithFile = originalDeleteWithFile;
    for (const attachment of await storage.entityFiles.list("wizard", wizardId)) {
      await originalDeleteWithFile.call(
        storage.entityFiles,
        "wizard",
        wizardId,
        attachment.id,
      );
    }
    for (const file of await storage.files.list({
      entityType: "wizard",
      entityId: wizardId,
    })) {
      await storage.files.delete(file.id);
    }
    await storage.wizards.delete(wizardId);
  });

  it("refuses a post-byte upload once deletion starts, then retries failed cleanup", async () => {
    const bytesPersisted = deferred();
    const releaseUpload = deferred();
    provider.upload.mockImplementation(async () => {
      bytesPersisted.resolve();
      await releaseUpload.promise;
      return { storagePath: uploadedPath, size: 6 };
    });

    const upload = createWizardAttachment({
      wizardId,
      fileName: "racing.txt",
      bytes: Buffer.from("racing"),
      mimeType: "text/plain",
      uploadedBy: "wizard-concurrency-test",
    });
    await bytesPersisted.promise;

    await markDeleting(wizardId);
    expect((await storage.wizards.getById(wizardId))?.status).toBe("deleting");

    releaseUpload.resolve();
    await expect(upload).rejects.toThrow(
      "Wizard no longer exists and cannot accept attachments",
    );

    let failOnce = true;
    storage.entityFiles.deleteWithFile = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("simulated cleanup failure");
      }
      return originalDeleteWithFile.apply(storage.entityFiles, args);
    };

    const failedCleanup = await cleanupWizardAttachments(wizardId);
    expect(failedCleanup).toMatchObject({ complete: false });
    expect(failedCleanup.failedFileIds).toHaveLength(1);
    expect((await storage.wizards.getById(wizardId))?.status).toBe("deleting");

    storage.entityFiles.deleteWithFile = originalDeleteWithFile;
    await expect(cleanupWizardAttachments(wizardId)).resolves.toEqual({
      complete: true,
      failedFileIds: [],
    });
    await expect(finishDeleting(wizardId)).resolves.toBe(true);

    expect(await storage.wizards.getById(wizardId)).toBeUndefined();
    expect(await storage.entityFiles.list("wizard", wizardId)).toEqual([]);
    expect(
      await storage.files.list({ entityType: "wizard", entityId: wizardId }),
    ).toEqual([]);
    expect(
      await storage.files.list({
        entityType: "entity-files:wizard",
        entityId: wizardId,
      }),
    ).toEqual([]);
  });
});