import { getEntityFileContext } from "./registry";

export function isTemplateAsset(file: { entityType: string | null }): boolean {
  // Legacy discriminator remains readable without an owner table. New uploads
  // inherit publication from the registered area, never filesystem privacy alone.
  return file.entityType === "published-image" || file.entityType === "template-asset" ||
    (file.entityType?.startsWith("entity-files:") === true &&
      getEntityFileContext(file.entityType.slice("entity-files:".length))?.publishedAsset === true);
}

export class AttachmentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function refuseTemplateAssetMutation(): never {
  throw new AttachmentError(409, "Published template images are retained and immutable.");
}

export function isRecipientReachablePublicOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash &&
      host.includes(".") && !host.endsWith(".localhost") &&
      !host.endsWith(".local") && !host.endsWith(".internal") &&
      !host.includes(":") && !/^[\d.]+$/.test(host);
  } catch {
    return false;
  }
}
