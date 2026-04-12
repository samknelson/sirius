import type { IStorage } from "../../storage";
import type { Comm } from "../../../shared/schema";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { resolveEmailAddress, deliverEmail } from "./deliver-email";
import { resolvePhoneNumber, deliverSms } from "./deliver-sms";
import { resolvePostalAddress, deliverPostal } from "./deliver-postal";
import { resolveUserId, deliverInapp } from "./deliver-inapp";

export interface DeliverContactRequest {
  messageId: string;
  contactId: string;
  userId?: string;
}

export interface DeliverContactResult {
  success: boolean;
  commId?: string;
  comm?: Comm;
  error?: string;
  errorCode?: string;
  resolvedAddress?: string;
}

export interface DeliverParticipantResult extends DeliverContactResult {
  participantId: string;
  alreadySent: boolean;
}

export interface ResolvedAddress {
  medium: string;
  address: string | null;
  error?: string;
}

export async function resolveAddress(
  storage: IStorage,
  messageId: string,
  contactId: string
): Promise<ResolvedAddress> {
  const bulkMessage = await storage.bulkMessages.getById(messageId);
  if (!bulkMessage) {
    return { medium: "unknown", address: null, error: "Bulk message not found" };
  }

  const medium = bulkMessage.medium;

  switch (medium) {
    case "email": {
      const resolved = await resolveEmailAddress(storage, contactId);
      return { medium, address: resolved?.address || null, error: resolved ? undefined : "Contact has no email address" };
    }
    case "sms": {
      const phone = await resolvePhoneNumber(storage, contactId);
      return { medium, address: phone, error: phone ? undefined : "Contact has no phone number" };
    }
    case "postal": {
      const addr = await resolvePostalAddress(storage, contactId);
      if (!addr) return { medium, address: null, error: "Contact has no postal address" };
      const parts = [addr.name, addr.addressLine1, addr.city, addr.state, addr.zip].filter(Boolean);
      return { medium, address: parts.join(", ") };
    }
    case "inapp": {
      const userId = await resolveUserId(storage, contactId);
      return { medium, address: userId ? `user:${userId}` : null, error: userId ? undefined : "Contact has no linked user account" };
    }
    default:
      return { medium, address: null, error: `Unsupported medium: ${medium}` };
  }
}

export async function deliverToContact(
  storage: IStorage,
  request: DeliverContactRequest
): Promise<DeliverContactResult> {
  const { messageId, contactId, userId } = request;

  const bulkMessage = await storage.bulkMessages.getById(messageId);
  if (!bulkMessage) {
    return { success: false, error: "Bulk message not found", errorCode: "NOT_FOUND" };
  }

  switch (bulkMessage.medium) {
    case "email":
      return deliverEmail(storage, messageId, contactId, userId);
    case "sms":
      return deliverSms(storage, messageId, contactId, userId);
    case "postal":
      return deliverPostal(storage, messageId, contactId, userId);
    case "inapp":
      return deliverInapp(storage, messageId, contactId, userId);
    default:
      return { success: false, error: `Unsupported medium: ${bulkMessage.medium}`, errorCode: "UNSUPPORTED_MEDIUM" };
  }
}

const rawParticipantStorage = createBulkParticipantStorage();

export async function deliverToParticipant(
  storage: IStorage,
  messageId: string,
  participantId: string,
  userId?: string
): Promise<DeliverParticipantResult> {
  const participant = await rawParticipantStorage.getById(participantId);
  if (!participant || participant.messageId !== messageId) {
    return { participantId, alreadySent: false, success: false, error: "Participant not found", errorCode: "NOT_FOUND" };
  }

  if (participant.commId) {
    return { participantId, alreadySent: true, success: false, error: "Message already sent to this participant", errorCode: "ALREADY_SENT" };
  }

  const result = await deliverToContact(storage, {
    messageId,
    contactId: participant.contactId,
    userId,
  });

  if (result.success && result.commId) {
    await rawParticipantStorage.update(participantId, { commId: result.commId });
  }

  return {
    ...result,
    participantId,
    alreadySent: false,
  };
}
