import type { IStorage } from "../../storage";
import { sendEmail } from "../../services/email-sender";
import { sendSms } from "../../services/sms-sender";
import { sendPostal } from "../../services/postal-sender";
import { sendInapp } from "../../services/inapp-sender";

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

async function resolvePostalAddress(storage: IStorage, contactId: string) {
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
      const result = await sendEmail({
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
      const result = await sendSms({
        contactId,
        toPhoneNumber: phone,
        message: smsContent.body || "",
        userId,
      });
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
      const fromAddress = postalContent.fromAddressLine1 ? {
        name: postalContent.fromName || undefined,
        company: postalContent.fromCompany || undefined,
        addressLine1: postalContent.fromAddressLine1,
        addressLine2: postalContent.fromAddressLine2 || undefined,
        city: postalContent.fromCity || "",
        state: postalContent.fromState || "",
        zip: postalContent.fromZip || "",
        country: postalContent.fromCountry || "US",
      } : undefined;
      const result = await sendPostal({
        contactId,
        toAddress: addr,
        fromAddress,
        description: postalContent.description || undefined,
        file: postalContent.fileUrl || undefined,
        templateId: postalContent.templateId || undefined,
        mergeVariables: (postalContent.mergeVariables as Record<string, string>) || undefined,
        mailType: (postalContent.mailType as any) || undefined,
        color: postalContent.color || undefined,
        doubleSided: postalContent.doubleSided || undefined,
        userId,
      } as any);
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
