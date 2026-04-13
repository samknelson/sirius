import type { IStorage } from "../../storage";
import { sendEmail, type SendEmailResult } from "../../services/email-sender";
import type { DeliverContactResult } from "./deliver";
import { resolveAndReplace } from "../../services/bulk-tokenization";

export async function resolveEmailAddress(storage: IStorage, contactId: string): Promise<{ address: string; name?: string } | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  return { address: contact.email, name: contact.displayName || undefined };
}

export async function deliverEmail(
  storage: IStorage,
  messageId: string,
  contactId: string,
  userId?: string,
): Promise<DeliverContactResult> {
  const emailContent = await storage.bulkMessagesEmail.getByBulkId(messageId);
  if (!emailContent) {
    return { success: false, error: "No email content configured for this message", errorCode: "NO_CONTENT" };
  }
  const resolved = await resolveEmailAddress(storage, contactId);
  if (!resolved) {
    return { success: false, error: "Contact has no email address", errorCode: "NO_ADDRESS" };
  }

  let subject = emailContent.subject || "(no subject)";
  let bodyText = emailContent.bodyText || undefined;
  let bodyHtml = emailContent.bodyHtml || undefined;

  try {
    subject = await resolveAndReplace(storage, contactId, subject);
    if (bodyText) bodyText = await resolveAndReplace(storage, contactId, bodyText);
    if (bodyHtml) bodyHtml = await resolveAndReplace(storage, contactId, bodyHtml);
  } catch (_e) {}

  const result: SendEmailResult = await sendEmail({
    contactId,
    toEmail: resolved.address,
    toName: resolved.name,
    subject,
    bodyText,
    bodyHtml,
    fromEmail: emailContent.fromAddress || undefined,
    fromName: emailContent.fromName || undefined,
    replyTo: emailContent.replyTo || undefined,
    userId,
  });
  return {
    success: result.success,
    commId: result.comm?.id,
    comm: result.comm,
    error: result.error,
    errorCode: result.errorCode,
    resolvedAddress: resolved.address,
  };
}
