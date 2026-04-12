import type { IStorage } from "../../storage";
import { sendEmail, type SendEmailResult } from "../../services/email-sender";
import { sendSms, type SendSmsResult } from "../../services/sms-sender";
import { sendPostal, type SendPostalResult } from "../../services/postal-sender";
import { sendInapp, type SendInappResult } from "../../services/inapp-sender";
import type { PostalAddress } from "../../services/providers/postal";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";

export interface DeliverContactRequest {
  messageId: string;
  contactId: string;
  userId?: string;
}

export interface DeliverContactResult {
  success: boolean;
  commId?: string;
  error?: string;
  errorCode?: string;
  resolvedAddress?: string;
}

export interface DeliverParticipantResult extends DeliverContactResult {
  participantId: string;
  alreadySent: boolean;
}

async function resolveEmailAddress(storage: IStorage, contactId: string): Promise<{ address: string; name?: string } | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  return { address: contact.email, name: contact.displayName || undefined };
}

async function resolvePhoneNumber(storage: IStorage, contactId: string): Promise<string | null> {
  const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
  const primary = phones.find(p => p.isPrimary && p.isActive);
  const active = phones.find(p => p.isActive);
  const phone = primary || active || phones[0];
  return phone?.number || null;
}

async function resolvePostalAddress(storage: IStorage, contactId: string): Promise<PostalAddress | null> {
  const addresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
  const primary = addresses.find(a => a.isPrimary && a.isActive);
  const active = addresses.find(a => a.isActive);
  const addr = primary || active || addresses[0];
  if (!addr) return null;
  return {
    name: addr.friendlyName || undefined,
    addressLine1: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.postalCode,
    country: addr.country || "US",
  };
}

async function resolveUserId(storage: IStorage, contactId: string): Promise<string | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  const user = await storage.users.getUserByEmail(contact.email);
  return user?.id || null;
}

function deliverEmail(
  contactId: string,
  resolved: { address: string; name?: string },
  emailContent: { subject: string | null; bodyText: string | null; bodyHtml: string | null; fromAddress: string | null; fromName: string | null; replyTo: string | null },
  userId?: string,
): Promise<SendEmailResult> {
  return sendEmail({
    contactId,
    toEmail: resolved.address,
    toName: resolved.name,
    subject: emailContent.subject || "(no subject)",
    bodyText: emailContent.bodyText || undefined,
    bodyHtml: emailContent.bodyHtml || undefined,
    fromEmail: emailContent.fromAddress || undefined,
    fromName: emailContent.fromName || undefined,
    replyTo: emailContent.replyTo || undefined,
    userId,
  });
}

function deliverSms(
  contactId: string,
  phone: string,
  smsContent: { body: string | null },
  userId?: string,
): Promise<SendSmsResult> {
  return sendSms({
    contactId,
    toPhoneNumber: phone,
    message: smsContent.body || "",
    userId,
  });
}

function deliverPostal(
  contactId: string,
  toAddress: PostalAddress,
  postalContent: {
    fromName: string | null; fromCompany: string | null; fromAddressLine1: string | null;
    fromAddressLine2: string | null; fromCity: string | null; fromState: string | null;
    fromZip: string | null; fromCountry: string | null; description: string | null;
    fileUrl: string | null; templateId: string | null; mergeVariables: unknown;
    mailType: string; color: boolean; doubleSided: boolean;
  },
  userId?: string,
): Promise<SendPostalResult> {
  const fromAddress: PostalAddress | undefined = postalContent.fromAddressLine1 ? {
    name: postalContent.fromName || undefined,
    company: postalContent.fromCompany || undefined,
    addressLine1: postalContent.fromAddressLine1,
    addressLine2: postalContent.fromAddressLine2 || undefined,
    city: postalContent.fromCity || "",
    state: postalContent.fromState || "",
    zip: postalContent.fromZip || "",
    country: postalContent.fromCountry || "US",
  } : undefined;
  return sendPostal({
    contactId,
    toAddress,
    fromAddress,
    description: postalContent.description || undefined,
    file: postalContent.fileUrl || undefined,
    templateId: postalContent.templateId || undefined,
    mergeVariables: (postalContent.mergeVariables as Record<string, string>) || undefined,
    mailType: postalContent.mailType === "usps_standard" ? "usps_standard" : "usps_first_class",
    color: postalContent.color || undefined,
    doubleSided: postalContent.doubleSided || undefined,
    userId,
  });
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

  const medium = bulkMessage.medium;

  switch (medium) {
    case "email": {
      const emailContent = await storage.bulkMessagesEmail.getByBulkId(messageId);
      if (!emailContent) {
        return { success: false, error: "No email content configured for this message", errorCode: "NO_CONTENT" };
      }
      const resolved = await resolveEmailAddress(storage, contactId);
      if (!resolved) {
        return { success: false, error: "Contact has no email address", errorCode: "NO_ADDRESS" };
      }
      const result = await deliverEmail(contactId, resolved, emailContent, userId);
      return {
        success: result.success,
        commId: result.comm?.id,
        error: result.error,
        errorCode: result.errorCode,
        resolvedAddress: resolved.address,
      };
    }

    case "sms": {
      const smsContent = await storage.bulkMessagesSms.getByBulkId(messageId);
      if (!smsContent) {
        return { success: false, error: "No SMS content configured for this message", errorCode: "NO_CONTENT" };
      }
      const phone = await resolvePhoneNumber(storage, contactId);
      if (!phone) {
        return { success: false, error: "Contact has no phone number", errorCode: "NO_ADDRESS" };
      }
      const result = await deliverSms(contactId, phone, smsContent, userId);
      return {
        success: result.success,
        commId: result.comm?.id,
        error: result.error,
        errorCode: result.errorCode,
        resolvedAddress: phone,
      };
    }

    case "postal": {
      const postalContent = await storage.bulkMessagesPostal.getByBulkId(messageId);
      if (!postalContent) {
        return { success: false, error: "No postal content configured for this message", errorCode: "NO_CONTENT" };
      }
      const addr = await resolvePostalAddress(storage, contactId);
      if (!addr) {
        return { success: false, error: "Contact has no postal address", errorCode: "NO_ADDRESS" };
      }
      const result = await deliverPostal(contactId, addr, postalContent, userId);
      const addrStr = [addr.addressLine1, addr.city, addr.state, addr.zip].join(", ");
      return {
        success: result.success,
        commId: result.comm?.id,
        error: result.error,
        errorCode: result.errorCode,
        resolvedAddress: addrStr,
      };
    }

    case "inapp": {
      const inappContent = await storage.bulkMessagesInapp.getByBulkId(messageId);
      if (!inappContent) {
        return { success: false, error: "No in-app content configured for this message", errorCode: "NO_CONTENT" };
      }
      const targetUserId = await resolveUserId(storage, contactId);
      if (!targetUserId) {
        return { success: false, error: "Contact does not have a linked user account (required for in-app messages)", errorCode: "NO_USER" };
      }
      const result = await sendInapp({
        contactId,
        userId: targetUserId,
        title: inappContent.title || "",
        body: inappContent.body || "",
        linkUrl: inappContent.linkUrl || undefined,
        linkLabel: inappContent.linkLabel || undefined,
        initiatedBy: userId || "bulk-test",
      });
      return {
        success: result.success,
        commId: result.comm?.id,
        error: result.error,
        errorCode: result.errorCode,
        resolvedAddress: `user:${targetUserId}`,
      };
    }

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
