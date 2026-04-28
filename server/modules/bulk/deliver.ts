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
  medium: string;
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

export async function resolveAddressForMedium(
  storage: IStorage,
  medium: string,
  contactId: string
): Promise<ResolvedAddress> {
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

export async function resolveAddress(
  storage: IStorage,
  messageId: string,
  contactId: string
): Promise<ResolvedAddress> {
  const bulkMessage = await storage.bulkMessages.getById(messageId);
  if (!bulkMessage) {
    return { medium: "unknown", address: null, error: "Bulk message not found" };
  }
  return resolveAddressForMedium(storage, bulkMessage.medium[0], contactId);
}

export async function deliverToContact(
  storage: IStorage,
  request: DeliverContactRequest
): Promise<DeliverContactResult> {
  const { messageId, contactId, medium, userId } = request;

  const bulkMessage = await storage.bulkMessages.getById(messageId);
  if (!bulkMessage) {
    return { success: false, error: "Bulk message not found", errorCode: "NOT_FOUND" };
  }

  switch (medium) {
    case "email":
      return deliverEmail(storage, messageId, contactId, userId);
    case "sms":
      return deliverSms(storage, messageId, contactId, userId);
    case "postal":
      return deliverPostal(storage, messageId, contactId, userId);
    case "inapp":
      return deliverInapp(storage, messageId, contactId, userId);
    default:
      return { success: false, error: `Unsupported medium: ${medium}`, errorCode: "UNSUPPORTED_MEDIUM" };
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

  if (participant.status !== "pending") {
    return { participantId, alreadySent: true, success: false, error: "Participant already processed", errorCode: "ALREADY_SENT" };
  }

  const result = await deliverToContact(storage, {
    messageId,
    contactId: participant.contactId,
    medium: participant.medium,
    userId,
  });

  if (result.commId) {
    await rawParticipantStorage.update(participantId, {
      commId: result.commId,
      status: "see_comm",
    });
  } else if (!result.success) {
    await rawParticipantStorage.update(participantId, {
      status: "send_failed",
      message: result.error || "Unknown delivery error",
    });
  }

  // Activity log so the contact's Logs tab reflects each bulk-message
  // send attempt — independent of the comm record (which only exists
  // when a provider hand-off was attempted).
  try {
    const { logger } = await import("../../logger");
    const logMeta = {
      module: "bulk_message",
      operation: `send_${participant.medium}`,
      entity_id: messageId,
      host_entity_id: participant.contactId,
      user_id: userId,
      description: result.success
        ? `Sent ${participant.medium} via bulk message`
        : `Failed to send ${participant.medium} via bulk message: ${result.error || "unknown error"}`,
      bulk_message_id: messageId,
      participant_id: participantId,
      medium: participant.medium,
      comm_id: result.commId,
      error_code: result.errorCode,
    };
    if (result.success) {
      logger.info(logMeta.description!, logMeta);
    } else {
      logger.warn(logMeta.description!, logMeta);
    }
  } catch (logError) {
    console.error("Failed to record bulk-message activity log:", logError);
  }

  return {
    ...result,
    participantId,
    alreadySent: false,
  };
}
