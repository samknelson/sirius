import type { IStorage } from "../../storage";
import { sendInapp, type SendInappResult } from "../../services/inapp-sender";
import type { DeliverContactResult } from "./deliver";
import { resolveAndReplace } from "../../services/bulk-tokenization";

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
  let resolvedTitle = inappContent.title || "";
  let resolvedBody = inappContent.body || "";
  if (resolvedTitle) {
    resolvedTitle = await resolveAndReplace(storage, contactId, resolvedTitle);
  }
  if (resolvedBody) {
    resolvedBody = await resolveAndReplace(storage, contactId, resolvedBody);
  }

  const result: SendInappResult = await sendInapp({
    contactId,
    userId: targetUserId,
    title: resolvedTitle,
    body: resolvedBody,
    linkUrl: inappContent.linkUrl || undefined,
    linkLabel: inappContent.linkLabel || undefined,
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
