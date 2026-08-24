import type { IStorage } from "../../storage";
import { sendSms, type SendSmsResult } from "../../services/comm/senders/sms";
import type { DeliverContactResult } from "./deliver";
import { renderTokens, createTokenEvalContext } from "../../plugins/tokens";
import type { TokenRootSeed } from "../../plugins/tokens/types";
import { BULK_CHANNEL_FIELDS, tokenCleanerFor } from "../../delivery/shape";

const [BODY_SPEC] = BULK_CHANNEL_FIELDS.sms;

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
  seeds: TokenRootSeed[],
  userId?: string,
  tagIds?: string[],
  offline?: boolean,
): Promise<DeliverContactResult> {
  const smsContent = await storage.bulkMessagesSms.getByBulkId(messageId);
  if (!smsContent) {
    return { success: false, error: "No SMS content configured for this message", errorCode: "NO_CONTENT" };
  }
  const phone = await resolvePhoneNumber(storage, contactId);
  if (!phone) {
    return { success: false, error: "Contact has no phone number", errorCode: "NO_ADDRESS" };
  }
  const ctx = createTokenEvalContext(storage, contactId, { seeds });
  const renderedBody = (
    await renderTokens(smsContent.body || "", ctx, {
      strictUnknown: true,
      clean: tokenCleanerFor(BODY_SPEC) ?? undefined,
    })
  ).output;
  const result: SendSmsResult = await sendSms({
    contactId,
    toPhoneNumber: phone,
    message: renderedBody,
    userId,
    tagIds,
    sendOffline: offline,
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
