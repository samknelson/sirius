import type { IStorage } from "../../storage";
import { sendSms, type SendSmsResult } from "../../services/sms-sender";
import type { DeliverContactResult } from "./deliver";
import { resolveAndReplace } from "../../services/bulk-tokenization";

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

  let body = smsContent.body || "";
  try {
    body = await resolveAndReplace(storage, contactId, body);
  } catch (_e) {}

  const result: SendSmsResult = await sendSms({
    contactId,
    toPhoneNumber: phone,
    message: body,
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
