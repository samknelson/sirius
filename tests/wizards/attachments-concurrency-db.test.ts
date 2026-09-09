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
  createWizardAttachment,
  deleteWizardWithAttachments,
} from "../../server/plugins/wizards/attachments";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.sequential("wizard attachment deletion concurrency (database)", () => {
  let wizardId: string;
  let originalDeleteWithFile: typeof storage.entityFiles.deleteWithFile;

  beforeEach(async () => {
    provider.upload.mockReset();
    provider.remove.mockReset().mockResolvedValue(undefined);
    originalDeleteWithFile = storage.entityFiles.deleteWithFile;

    const wizard = await storage.wizards.create({
      type: "attachment-concurrency-test",
      status: "draft",
      data: {},
    });
    wizardId = wizard.id;
    await storage.entityFiles.createWithFile(
      "wizard",
      wizardId,
      {
        fileName: "existing.txt",
        storagePath: `wizards/${wizardId}/existing.txt`,
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
      return { storagePath: `wizards/${wizardId}/racing.txt`, size: 6 };
    });

    const upload = createWizardAttachment({
      wizardId,
      fileName: "racing.txt",
      bytes: Buffer.from("racing"),
      mimeType: "text/plain",
      uploadedBy: "wizard-concurrency-test",
    });
    await bytesPersisted.promise;

    let failOnce = true;
    storage.entityFiles.deleteWithFile = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("simulated cleanup failure");
      }
      return originalDeleteWithFile.apply(storage.entityFiles, args);
    };

    const firstDeletion = deleteWizardWithAttachments(wizardId);
    await expect(firstDeletion).resolves.toMatchObject({
      deleted: false,
      failedFileIds: expect.any(Array),
    });
    expect((await storage.wizards.getById(wizardId))?.status).toBe("deleting");

    releaseUpload.resolve();
    await expect(upload).rejects.toThrow(
      "Wizard no longer exists and cannot accept attachments",
    );

    storage.entityFiles.deleteWithFile = originalDeleteWithFile;
    await expect(deleteWizardWithAttachments(wizardId)).resolves.toEqual({
      deleted: true,
      failedFileIds: [],
    });

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