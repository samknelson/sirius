import { z } from "zod";
import type { IStorage } from "../storage";
import type { BulkMessage } from "@shared/schema/bulk/schema";
import { MEDIUM_FIELDS, type MediumName } from "@shared/delivery-fields";
import { BULK_MESSAGE_TOKEN_CONTEXT } from "@shared/token-contexts";

export class BulkEnqueueError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const selectionsSchema = z.record(z.enum(["email", "sms", "postal", "inapp"]), z.string().trim().min(1)).optional();
export type EnqueueTemplate = { medium: MediumName; id: string; fields: Record<string, string> };

/** Resolve IDs server-side. Never trust supplied template content or another context. */
export async function resolveEnqueueTemplates(storage: IStorage, input: unknown, media: string[]): Promise<EnqueueTemplate[]> {
  const parsed = selectionsSchema.safeParse(input);
  if (!parsed.success) throw new BulkEnqueueError("Invalid template selections");
  const result: EnqueueTemplate[] = [];
  for (const [medium, id] of Object.entries(parsed.data ?? {}) as [MediumName, string][]) {
    if (!media.includes(medium)) throw new BulkEnqueueError(`The message does not use the ${medium} channel`);
    const template = await storage.letterTemplates.get(id);
    if (!template) throw new BulkEnqueueError("A selected template no longer exists", 404);
    if (template.medium !== medium || !template.contextIds.includes(BULK_MESSAGE_TOKEN_CONTEXT)) {
      throw new BulkEnqueueError("Choose a template for this channel and the bulk-message context");
    }
    const content = template.content as Record<string, unknown>;
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      throw new BulkEnqueueError("The selected template has invalid content");
    }
    const allowed = MEDIUM_FIELDS[medium].map(field => field.key);
    if (Object.entries(content).some(([key, value]) => !allowed.includes(key) || typeof value !== "string")) {
      throw new BulkEnqueueError("The selected template contains invalid message fields");
    }
    result.push({ medium, id, fields: Object.fromEntries(allowed.map(key => [key, (content[key] as string | undefined) ?? ""])) });
  }
  return result;
}

/** Caller locks the message and owns the transaction covering content + recipients. */
export async function applyEnqueueTemplates(storage: IStorage, message: BulkMessage, templates: EnqueueTemplate[]) {
  if (!templates.length) return;
  if (message.status !== "draft" || await storage.bulkParticipants.hasNonPendingForMessage(message.id)) {
    throw new BulkEnqueueError("Templates can only be applied to drafts whose delivery has not started", 409);
  }
  for (const template of templates) {
    const channel = {
      email: storage.bulkMessagesEmail, sms: storage.bulkMessagesSms,
      postal: storage.bulkMessagesPostal, inapp: storage.bulkMessagesInapp,
    }[template.medium];
    const existing = await channel.getByBulkId(message.id);
    const fields = { ...template.fields };
    const data = { ...(existing?.data as Record<string, unknown> | null), letterTemplateId: template.id };
    if (template.medium === "postal") {
      Object.assign(data, { body: fields.body });
      delete fields.body;
    }
    if (existing) await channel.update(existing.id, { ...fields, data });
    else await channel.create({ bulkId: message.id, ...fields, data });
  }
}
