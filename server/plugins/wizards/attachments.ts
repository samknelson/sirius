import { insertFileSchema, type File } from "@shared/schema";
import { storage } from "../../storage";
import { fileSystemService } from "../../services/files";
import { logger } from "../../logger";
import {
  expandDirectoryTemplate,
  isExtensionAllowed,
  resolveUsableContextConfig,
} from "../../services/entity-files/config";

const CONTEXT = "wizard";

export class WizardAttachmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WizardAttachmentConfigurationError";
  }
}

/**
 * Persist wizard-owned bytes through the configured Entity Files area. Bytes
 * are deliberately written before the transaction so an interrupted insert
 * leaves only a sweepable provider orphan.
 */
export async function createWizardAttachment(input: {
  wizardId: string;
  fileName: string;
  bytes: Buffer | Uint8Array;
  mimeType?: string | null;
  uploadedBy: string;
  metadata?: unknown;
}): Promise<File> {
  return (await createWizardAttachmentRecord(input)).file;
}

export async function createWizardAttachmentRecord(input: {
  wizardId: string;
  fileName: string;
  bytes: Buffer | Uint8Array;
  mimeType?: string | null;
  uploadedBy: string;
  metadata?: unknown;
  displayName?: string;
}) {
  const usable = await resolveUsableContextConfig(CONTEXT);
  if (!usable.config) throw new WizardAttachmentConfigurationError(usable.reason);
  if (!isExtensionAllowed(input.fileName, usable.config.allowed)) {
    throw new Error(
      `File type not allowed. Allowed extensions: ${usable.config.allowed?.join(", ") || "(all)"}`,
    );
  }
  const directory = expandDirectoryTemplate(usable.config.directory, input.wizardId);
  const safeName = (input.fileName.split(/[/\\]/).pop() || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 200);
  const uploaded = await fileSystemService.upload({
    fileSystemId: usable.config.file_system,
    fileName: input.fileName,
    fileContent: Buffer.from(input.bytes),
    mimeType: input.mimeType ?? undefined,
    customPath: `${directory}/${Date.now()}-${safeName}`,
  });
  const fileData = insertFileSchema.parse({
      fileName: input.fileName,
      storagePath: uploaded.storagePath,
      mimeType: input.mimeType ?? null,
      size: uploaded.size,
      uploadedBy: input.uploadedBy,
      entityType: "entity-files:wizard",
      entityId: input.wizardId,
      fileSystemId: usable.config.file_system,
      metadata: input.metadata ?? null,
    });
  const attachment = await storage.advisoryLock.withTransactionLock(
    `wizard-attachments:${input.wizardId}`,
    async () => {
      // This read and both row inserts share the lock transaction. Bytes have
      // already been uploaded; refusal leaves a provider orphan for sweeping.
      const wizard = await storage.wizards.getById(input.wizardId);
      if (!wizard || wizard.status === "deleting") {
        throw new Error("Wizard no longer exists and cannot accept attachments");
      }
      return storage.entityFiles.createWithFile(
        CONTEXT, input.wizardId, fileData, input.displayName ?? input.fileName,
      );
    },
  );
  return attachment;
}

export async function listWizardAttachments(wizardId: string): Promise<File[]> {
  const [attached, legacy] = await Promise.all([
    storage.entityFiles.list(CONTEXT, wizardId),
    storage.files.list({ entityType: "wizard", entityId: wizardId }),
  ]);
  const files = new Map(attached.map((item) => [item.file.id, item.file]));
  for (const file of legacy) if (!files.has(file.id)) files.set(file.id, file);
  return [...files.values()];
}

export async function removeWizardAttachment(fileId: string, wizardId: string): Promise<boolean> {
  const attached = await storage.entityFiles.getByFileId(CONTEXT, wizardId, fileId);
  if (attached) {
    return Boolean(await storage.entityFiles.deleteWithFile(CONTEXT, wizardId, attached.id));
  }
  const legacy = await getWizardAttachment(fileId, wizardId);
  if (!legacy) return false;
  const deleted = await storage.files.delete(fileId);
  if (deleted) {
    // Row-first matches Entity Files cleanup: an object-delete failure is a
    // recoverable orphan, not a dangling database reference.
    try {
      await fileSystemService.remove(legacy.fileSystemId, legacy.storagePath);
    } catch (error) {
      logger.warn("Legacy wizard file row deleted but byte cleanup failed", {
        service: "wizard-attachments", wizardId, fileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return Boolean(deleted);
}

export async function cleanupWizardAttachments(
  wizardId: string,
): Promise<{ complete: boolean; failedFileIds: string[] }> {
  const failed: string[] = [];
  for (const file of await listWizardAttachments(wizardId)) {
    try {
      if (!(await removeWizardAttachment(file.id, wizardId))) failed.push(file.id);
    } catch (error) {
      failed.push(file.id);
      logger.warn("Wizard attachment row cleanup failed", {
        service: "wizard-attachments", wizardId, fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const remaining = await listWizardAttachments(wizardId);
  const failedFileIds = Array.from(new Set([...failed, ...remaining.map((f) => f.id)]));
  return { complete: failedFileIds.length === 0, failedFileIds };
}

export type DeleteWizardWithAttachmentsResult =
  | { deleted: true; failedFileIds: [] }
  | { deleted: false; failedFileIds: string[] };

/**
 * Delete a wizard through the attachment lifecycle's shared lock.
 *
 * A failed row cleanup deliberately leaves the parent in `deleting`, giving a
 * later request a durable retry anchor. The final locked recheck prevents an
 * attachment from appearing between cleanup and parent deletion.
 */
export async function deleteWizardWithAttachments(
  wizardId: string,
): Promise<DeleteWizardWithAttachmentsResult> {
  await storage.advisoryLock.withTransactionLock(
    `wizard-attachments:${wizardId}`,
    async () => {
      const current = await storage.wizards.getById(wizardId);
      if (current && current.status !== "deleting") {
        await storage.wizards.update(wizardId, { status: "deleting" });
      }
    },
  );

  const cleanup = await cleanupWizardAttachments(wizardId);
  if (!cleanup.complete) {
    return { deleted: false, failedFileIds: cleanup.failedFileIds };
  }

  const deleted = await storage.advisoryLock.withTransactionLock(
    `wizard-attachments:${wizardId}`,
    async () => {
      const current = await storage.wizards.getById(wizardId);
      if (!current || current.status !== "deleting") return false;
      const [newRows, legacyRows] = await Promise.all([
        storage.entityFiles.list(CONTEXT, wizardId),
        storage.files.list({ entityType: "wizard", entityId: wizardId }),
      ]);
      if (newRows.length || legacyRows.length) return false;
      return storage.wizards.delete(wizardId);
    },
  );
  return deleted
    ? { deleted: true, failedFileIds: [] }
    : { deleted: false, failedFileIds: [] };
}

/** New attachments first, with a narrowly scoped legacy-row compatibility read. */
export async function getWizardAttachment(fileId: string, wizardId: string): Promise<File | undefined> {
  const attached = await storage.entityFiles.getByFileId(CONTEXT, wizardId, fileId);
  if (attached) return attached.file;
  const legacy = await storage.files.getById(fileId);
  return legacy?.entityType === "wizard" && legacy.entityId === wizardId ? legacy : undefined;
}

export async function downloadWizardAttachment(fileId: string, wizardId: string): Promise<Buffer> {
  const file = await getWizardAttachment(fileId, wizardId);
  if (!file) throw new Error("Wizard file not found");
  return fileSystemService.download(file.fileSystemId, file.storagePath);
}

/** Promote a wizard-produced attachment into a durable non-wizard document. */
export async function transferWizardAttachment(
  fileId: string,
  wizardId: string,
  owner: { entityType: string; entityId: string },
): Promise<File> {
  const file = await storage.entityFiles.transferFileOwnership(
    CONTEXT, wizardId, fileId, owner,
  );
  if (!file) throw new Error("Wizard attachment not found for ownership transfer");
  return file;
}