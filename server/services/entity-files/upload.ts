import { randomUUID } from "node:crypto";
import { insertFileSchema } from "@shared/schema";
import { storage } from "../../storage";
import { fileSystemService } from "../files";
import { getEnvironmentVariable } from "../../config/env-registry";
import { MAX_LETTER_IMAGE_BYTES, rasterImageType } from "../comm/letter-images";
import { expandDirectoryTemplate, isExtensionAllowed, resolveUsableContextConfig } from "./config";
import type { EntityFileContext } from "./registry";
import { AttachmentError, TEMPLATE_ASSET_CONTEXT, isRecipientReachablePublicOrigin } from "./template-assets";
import { logger } from "../../logger";

/** The shared attachment implementation. All checks precede object or row writes. */
export async function uploadEntityAttachment(input: {
  context: EntityFileContext;
  entityId: string;
  file: { originalname: string; buffer: Buffer; mimetype: string };
  uploadedBy: string;
  name?: string;
  typeId?: string | null;
  createAssetOwner?: boolean;
}) {
  const { context, entityId, file, uploadedBy, typeId } = input;
  let publicOrigin: string | undefined;
  const usable = await resolveUsableContextConfig(context.id);
  if (!usable.config) throw new AttachmentError(503, usable.reason);
  if (!isExtensionAllowed(file.originalname, usable.config.allowed)) {
    throw new AttachmentError(400, `File type not allowed. Allowed extensions: ${usable.config.allowed?.join(", ")}`);
  }
  if (context.id === TEMPLATE_ASSET_CONTEXT) {
    if (file.buffer.length > MAX_LETTER_IMAGE_BYTES) throw new AttachmentError(413, "Template images may not exceed 1 MB.");
    if (!["image/png", "image/jpeg"].includes(file.mimetype.toLowerCase())) {
      throw new AttachmentError(415, "Template images must be PNG or JPEG.");
    }
    let detected: string;
    try { detected = rasterImageType(file.buffer); }
    catch (error) { throw new AttachmentError(400, (error as Error).message); }
    if (detected !== file.mimetype.toLowerCase()) throw new AttachmentError(415, "Image content does not match its PNG/JPEG MIME type.");
    const extension = file.originalname.split(".").pop()?.toLowerCase();
    if (!(detected === "image/png" ? extension === "png" : ["jpg", "jpeg"].includes(extension ?? ""))) {
      throw new AttachmentError(415, "Image extension does not match its content.");
    }
    if (typeId) throw new AttachmentError(400, "Template images do not take a file type.");
    publicOrigin = getEnvironmentVariable("PUBLIC_URL");
    if (!isRecipientReachablePublicOrigin(publicOrigin)) {
      throw new AttachmentError(503, "Template image upload requires PUBLIC_URL to be a recipient-reachable HTTPS origin.");
    }
  }
  const displayName = (input.name?.trim() || file.originalname).slice(0, 255);
  if (context.id === "wizard") {
    const { createWizardAttachmentRecord } = await import("../../plugins/wizards/attachments");
    return createWizardAttachmentRecord({
      wizardId: entityId, fileName: file.originalname, bytes: file.buffer,
      mimeType: file.mimetype, uploadedBy, displayName,
    });
  }
  let directory: string;
  try {
    directory = expandDirectoryTemplate(usable.config.directory, entityId,
      context.resolveTokens ? await context.resolveTokens(entityId) : {});
  } catch (error) {
    throw new AttachmentError(503, `${(error as Error).message} Fix Config → Entity Files.`);
  }
  const safeName = (file.originalname.split(/[/\\]/).pop() || "file").replace(/[^\w.\-]+/g, "_").slice(0, 200);
  const uploaded = await fileSystemService.upload({
    fileSystemId: usable.config.file_system, fileName: file.originalname,
    fileContent: file.buffer, mimeType: file.mimetype,
    customPath: `${directory ? directory + "/" : ""}${randomUUID()}-${safeName}`,
  });
  try {
    if (uploaded.size !== file.buffer.length) throw new Error("Provider reported incomplete upload.");
    const fileData = insertFileSchema.parse({
      fileName: file.originalname, storagePath: uploaded.storagePath,
      mimeType: file.mimetype.toLowerCase(), size: uploaded.size, uploadedBy,
      entityType: `entity-files:${context.id}`, entityId,
      fileSystemId: usable.config.file_system, metadata: null,
    });
    const record = context.adapter
      ? await context.adapter.attach(entityId, fileData, displayName)
      : await storage.entityFiles.createWithFile(context.id, entityId, fileData, displayName, typeId, input.createAssetOwner);
    return {
      ...record,
      publicUrl: publicOrigin
        ? `${publicOrigin.replace(/\/$/, "")}/public-files/${encodeURIComponent(record.file.fileSystemId)}/${record.file.storagePath.split("/").map(encodeURIComponent).join("/")}`
        : undefined,
    };
  } catch (error) {
    try { await fileSystemService.remove(usable.config.file_system, uploaded.storagePath); }
    catch { logger.warn("Failed attachment object left for the shared filesystem sweep", { service: "entityFiles" }); }
    throw error;
  }
}
