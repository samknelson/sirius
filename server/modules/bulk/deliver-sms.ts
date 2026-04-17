import type { IStorage } from "../../storage";
import { sendSms, type SendSmsResult } from "../../services/sms-sender";
import type { DeliverContactResult } from "./deliver";
import { renderTemplate } from "../../../shared/bulk-tokens";
import { buildRecipientContext } from "./token-context";

export async function resolvePhoneNumber(storage: IStorage, contactId: string): Promise<string | null> {
  const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
  const primary = phones.find(p => p.isPrimary && p.isActive);
  const active = phones.find(p => p.isActive);
  const phone = primary || active;
  return phone?.phoneNumber || null;
}

export async function deliverSms(
  storage: IStorage,
  messageId: string,
  contactId: string,
  userId?: string,
): Promise<DeliverContactResult> {
  const smsContent = await storage.bulkMessagesSms.getByBulkId(messageId);
  if (!smsContent) {
    return { success: false, error: "No SMS content configured for this message", errorCode: "NO_CONTENT" };
  }
  const phone = await resolvePhoneNumber(storage, contactId);
  if (!phone) {
    return { success: false, error: "Contact has no phone number", errorCode: "NO_ADDRESS" };
  }
  const ctx = await buildRecipientContext(storage, contactId);
  const renderedBody = renderTemplate(smsContent.body || "", ctx, { strictUnknown: true }).output;
  const result: SendSmsResult = await sendSms({
    contactId,
    toPhoneNumber: phone,
    message: renderedBody,
    userId,
  });
  return {
    success: result.success,
    commId: result.comm?.id,
    comm: result.comm,
    error: result.error,
    errorCode: result.errorCode,
    resolvedAddress: phone,
  };
}
