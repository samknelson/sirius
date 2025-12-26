import type { IStorage } from '../storage';
import { sendSms } from './sms-sender';
import { sendEmail } from './email-sender';
import { sendInapp } from './inapp-sender';
import { staffAlertConfigSchema, type StaffAlertConfig, type StaffAlertRecipient } from '@shared/staffAlerts';
import type {
  StaffAlertMessagePayload,
  StaffAlertSendOptions,
  StaffAlertSendResult,
  AlertDeliveryResult,
} from '@shared/staffAlertMessages';
import type { Contact, PhoneNumber, User } from '@shared/schema';

const VARIABLE_PREFIX = 'staff_alert:';

interface ResolvedRecipient {
  user: User;
  contact: Contact;
  phoneNumbers: PhoneNumber[];
  config: StaffAlertRecipient;
}

interface ContactResolutionResult {
  resolved: ResolvedRecipient[];
  failed: Array<{
    userId: string;
    reason: string;
  }>;
}

async function resolveRecipientContacts(
  recipients: StaffAlertRecipient[],
  storage: IStorage
): Promise<ContactResolutionResult> {
  const resolved: ResolvedRecipient[] = [];
  const failed: Array<{ userId: string; reason: string }> = [];

  for (const recipientConfig of recipients) {
    const user = await storage.users.getUser(recipientConfig.userId);
    if (!user) {
      failed.push({ userId: recipientConfig.userId, reason: 'User not found' });
      continue;
    }

    if (!user.email) {
      failed.push({ userId: recipientConfig.userId, reason: 'User has no email address' });
      continue;
    }

    const contact = await storage.contacts.getContactByEmail(user.email);
    if (!contact) {
      failed.push({
        userId: recipientConfig.userId,
        reason: `No contact found with email: ${user.email}`,
      });
      continue;
    }

    const phoneNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contact.id);

    resolved.push({
      user,
      contact,
      phoneNumbers,
      config: recipientConfig,
    });
  }

  return { resolved, failed };
}

function getPrimaryPhoneNumber(phoneNumbers: PhoneNumber[]): string | undefined {
  const activeNumbers = phoneNumbers.filter(p => p.isActive);
  const primary = activeNumbers.find(p => p.isPrimary);
  if (primary) return primary.phoneNumber;
  if (activeNumbers.length > 0) return activeNumbers[0].phoneNumber;
  return undefined;
}

export async function sendStaffAlerts(
  context: string,
  payload: StaffAlertMessagePayload,
  storage: IStorage,
  options?: StaffAlertSendOptions
): Promise<StaffAlertSendResult> {
  const deliveryResults: AlertDeliveryResult[] = [];
  const summary = {
    sms: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
    email: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
    inapp: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
  };

  const variableName = `${VARIABLE_PREFIX}${context}`;
  const variable = await storage.variables.getByName(variableName);

  if (!variable) {
    return {
      context,
      totalRecipients: 0,
      deliveryResults: [],
      summary,
    };
  }

  const parseResult = staffAlertConfigSchema.safeParse(variable.value);
  if (!parseResult.success) {
    console.error(`Invalid staff alert config for context ${context}:`, parseResult.error);
    return {
      context,
      totalRecipients: 0,
      deliveryResults: [],
      summary,
    };
  }

  const config: StaffAlertConfig = parseResult.data;

  if (config.recipients.length === 0) {
    return {
      context,
      totalRecipients: 0,
      deliveryResults: [],
      summary,
    };
  }

  const { resolved, failed: resolutionFailures } = await resolveRecipientContacts(
    config.recipients,
    storage
  );

  for (const failure of resolutionFailures) {
    const recipientConfig = config.recipients.find(r => r.userId === failure.userId);
    if (recipientConfig) {
      for (const medium of recipientConfig.media) {
        deliveryResults.push({
          userId: failure.userId,
          medium,
          status: 'failed',
          error: failure.reason,
          errorCode: 'CONTACT_RESOLUTION_FAILED',
        });
        summary[medium].attempted++;
        summary[medium].failed++;
      }
    }
  }

  for (const recipient of resolved) {
    const { user, contact, phoneNumbers, config: recipientConfig } = recipient;

    for (const medium of recipientConfig.media) {
      if (medium === 'sms') {
        summary.sms.attempted++;

        if (!payload.sms) {
          deliveryResults.push({
            userId: user.id,
            medium: 'sms',
            status: 'skipped',
            error: 'No SMS message content provided',
            errorCode: 'NO_CONTENT',
          });
          summary.sms.skipped++;
          continue;
        }

        const phoneNumber = getPrimaryPhoneNumber(phoneNumbers);
        if (!phoneNumber) {
          deliveryResults.push({
            userId: user.id,
            medium: 'sms',
            status: 'failed',
            error: 'No active phone number for contact',
            errorCode: 'NO_PHONE_NUMBER',
          });
          summary.sms.failed++;
          continue;
        }

        const result = await sendSms({
          contactId: contact.id,
          toPhoneNumber: phoneNumber,
          message: payload.sms.text,
          userId: options?.triggeredByUserId,
        });

        if (result.success) {
          deliveryResults.push({
            userId: user.id,
            medium: 'sms',
            status: 'success',
          });
          summary.sms.succeeded++;
        } else {
          deliveryResults.push({
            userId: user.id,
            medium: 'sms',
            status: 'failed',
            error: result.error,
            errorCode: result.errorCode,
          });
          summary.sms.failed++;
        }
      } else if (medium === 'email') {
        summary.email.attempted++;

        if (!payload.email) {
          deliveryResults.push({
            userId: user.id,
            medium: 'email',
            status: 'skipped',
            error: 'No email message content provided',
            errorCode: 'NO_CONTENT',
          });
          summary.email.skipped++;
          continue;
        }

        if (!contact.email) {
          deliveryResults.push({
            userId: user.id,
            medium: 'email',
            status: 'failed',
            error: 'Contact has no email address',
            errorCode: 'NO_EMAIL',
          });
          summary.email.failed++;
          continue;
        }

        const result = await sendEmail({
          contactId: contact.id,
          toEmail: contact.email,
          toName: contact.displayName,
          subject: payload.email.subject,
          bodyText: payload.email.bodyText,
          bodyHtml: payload.email.bodyHtml,
          userId: options?.triggeredByUserId,
        });

        if (result.success) {
          deliveryResults.push({
            userId: user.id,
            medium: 'email',
            status: 'success',
          });
          summary.email.succeeded++;
        } else {
          deliveryResults.push({
            userId: user.id,
            medium: 'email',
            status: 'failed',
            error: result.error,
            errorCode: result.errorCode,
          });
          summary.email.failed++;
        }
      } else if (medium === 'inapp') {
        summary.inapp.attempted++;

        if (!payload.inapp) {
          deliveryResults.push({
            userId: user.id,
            medium: 'inapp',
            status: 'skipped',
            error: 'No in-app message content provided',
            errorCode: 'NO_CONTENT',
          });
          summary.inapp.skipped++;
          continue;
        }

        const result = await sendInapp({
          contactId: contact.id,
          userId: user.id,
          title: payload.inapp.title,
          body: payload.inapp.body,
          linkUrl: payload.inapp.linkUrl,
          linkLabel: payload.inapp.linkLabel,
          initiatedBy: options?.triggeredByUserId,
        });

        if (result.success) {
          deliveryResults.push({
            userId: user.id,
            medium: 'inapp',
            status: 'success',
          });
          summary.inapp.succeeded++;
        } else {
          deliveryResults.push({
            userId: user.id,
            medium: 'inapp',
            status: 'failed',
            error: result.error,
            errorCode: result.errorCode,
          });
          summary.inapp.failed++;
        }
      }
    }
  }

  return {
    context,
    totalRecipients: config.recipients.length,
    deliveryResults,
    summary,
  };
}
