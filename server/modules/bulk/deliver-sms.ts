import type { IStorage } from "../../storage";
import { sendSms, type SendSmsResult } from "../../services/comm/senders/sms";
import type { DeliverContactResult } from "./deliver";
import { renderTokens, createTokenEvalContext } from "../../plugins/tokens";
import type { TokenRootSeed } from "../../plugins/tokens/types";
import {
  mediumField,
  shapeRenderedValue,
  tokenCleanerFor,
} from "../../delivery/shape";
import { recordBulkUndeliverable } from "./undeliverable";

// By key, never by position — see `deliver-email.ts`.
const BODY_SPEC = mediumField("sms", "body");

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
  const renderedBody = shapeRenderedValue(
    BODY_SPEC,
    (
      await renderTokens(smsContent.body || "", ctx, {
        strictUnknown: true,
        clean: tokenCleanerFor(BODY_SPEC) ?? undefined,
      })
    ).output,
  );
  if (!renderedBody) {
    // An SMS with nothing in it is not a message. Recorded as a failed
    // communication against this recipient rather than handed to the
    // provider as an empty send.
    return recordBulkUndeliverable("sms", messageId, contactId, ["body"], tagIds);
  }
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
