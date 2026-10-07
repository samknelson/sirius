/** Published assets are reusable, not children of templates or communications. */
export const TEMPLATE_ASSET_CONTEXT = "template_asset";

export function isTemplateAsset(file: { entityType: string | null }): boolean {
  return file.entityType === "template-asset" ||
    file.entityType === `entity-files:${TEMPLATE_ASSET_CONTEXT}`;
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
