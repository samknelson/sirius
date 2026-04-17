import type { IStorage } from "../../storage";
import { sendEmail, type SendEmailResult } from "../../services/email-sender";
import type { DeliverContactResult } from "./deliver";
import { renderTemplate } from "../../../shared/bulk-tokens";
import { buildRecipientContext } from "./token-context";

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
  const ctx = await buildRecipientContext(storage, contactId);
  const renderedSubject = renderTemplate(emailContent.subject || "", ctx).output;
  const renderedText = emailContent.bodyText
    ? renderTemplate(emailContent.bodyText, ctx).output
    : undefined;
  const renderedHtml = emailContent.bodyHtml
    ? renderTemplate(emailContent.bodyHtml, ctx, { escapeHtml: true }).output
    : undefined;
  const result: SendEmailResult = await sendEmail({
    contactId,
    toEmail: resolved.address,
    toName: resolved.name,
    subject: renderedSubject || "(no subject)",
    bodyText: renderedText,
    bodyHtml: renderedHtml,
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
