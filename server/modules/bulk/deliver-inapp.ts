import type { IStorage } from "../../storage";
import { sendInapp, type SendInappResult } from "../../services/inapp-sender";
import type { DeliverContactResult } from "./deliver";
import { renderTemplate } from "../../../shared/bulk-tokens";
import { buildRecipientContext } from "./token-context";

export async function resolveUserId(storage: IStorage, contactId: string): Promise<string | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  const user = await storage.users.getUserByEmail(contact.email);
  return user?.id || null;
}

export async function deliverInapp(
  storage: IStorage,
  messageId: string,
  contactId: string,
  userId?: string,
): Promise<DeliverContactResult> {
  const inappContent = await storage.bulkMessagesInapp.getByBulkId(messageId);
  if (!inappContent) {
    return { success: false, error: "No in-app content configured for this message", errorCode: "NO_CONTENT" };
  }
  const targetUserId = await resolveUserId(storage, contactId);
  if (!targetUserId) {
    return { success: false, error: "Contact does not have a linked user account (required for in-app messages)", errorCode: "NO_USER" };
  }
  const ctx = await buildRecipientContext(storage, contactId);
  const renderedTitle = renderTemplate(inappContent.title || "", ctx).output;
  const renderedBody = renderTemplate(inappContent.body || "", ctx).output;
  const renderedLinkLabel = inappContent.linkLabel
    ? renderTemplate(inappContent.linkLabel, ctx).output
    : undefined;
  const result: SendInappResult = await sendInapp({
    contactId,
    userId: targetUserId,
    title: renderedTitle,
    body: renderedBody,
    linkUrl: inappContent.linkUrl || undefined,
    linkLabel: renderedLinkLabel,
    initiatedBy: userId || "bulk-test",
  });
  return {
    success: result.success,
    commId: result.comm?.id,
    comm: result.comm,
    error: result.error,
    errorCode: result.errorCode,
    resolvedAddress: `user:${targetUserId}`,
  };
}
