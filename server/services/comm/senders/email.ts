import { serviceRegistry } from '../../service-registry';
import { getSystemMode } from '../../system-mode';
import { createCommStorage, createCommEmailStorage, createCommEmailOptinStorage } from '../../../storage/comm';
import { storage } from '../../../storage';
import { runInTransaction } from '../../../storage/transaction-context';
import type { EmailTransport, EmailRecipient } from '../providers/email';
import type { Comm, CommEmail } from '@shared/schema';
import { logger } from '../../../logger';
import { buildStatusCallbackUrl } from '../callback-handlers/url-builder';
import { isMaintenanceModeError } from "../../maintenance-flag";
import { ALREADY_SENT, findSentWithKey, type AlreadySentCode } from '../send-key';

export interface SendEmailRequest {
  contactId: string;
  toEmail: string;
  toName?: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  userId?: string;
  tagIds?: string[];
  sendOffline?: boolean;
  /**
   * Optional send-once key. See `comm.sendKey` in `shared/schema.ts`: the
   * first send with this key to this contact goes out, every later one is
   * refused with {@link ALREADY_SENT} and nothing reaches the provider.
   */
  sendKey?: string;
}

export interface SendEmailResult {
  success: boolean;
  comm?: Comm;
  commEmail?: CommEmail;
  error?: string;
  errorCode?: 'EMAIL_NOT_SUPPORTED' | 'VALIDATION_ERROR' | 'NOT_OPTED_IN' | 'NOT_ALLOWLISTED' | 'PROVIDER_ERROR' | 'UNKNOWN_ERROR' | AlreadySentCode;
  /**
   * The send was refused because its key was already spent. This is NOT a
   * failure — nothing was attempted and nothing broke. `comm` carries the
   * message that did go out, when it can still be read.
   */
  alreadySent?: boolean;
  messageId?: string;
}

const commStorage = createCommStorage();
const commEmailStorage = createCommEmailStorage();
const emailOptinStorage = createCommEmailOptinStorage();

/**
 * The answer when the claim insert came back empty: this key is spent, so the
 * message already went out and nothing may be handed to the provider again.
 */
async function alreadySent(contactId: string, sendKey: string): Promise<SendEmailResult> {
  const existing = await findSentWithKey({ medium: 'email', contactId, sendKey });
  return {
    success: false,
    alreadySent: true,
    comm: existing,
    error: 'An email with this send key has already been sent to this contact',
    errorCode: ALREADY_SENT,
  };
}

export async function sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
  const { contactId, toEmail, toName, subject, bodyText, bodyHtml, fromEmail, fromName, replyTo, userId, tagIds, sendOffline, sendKey } = request;

  if (sendOffline) {
    try {
      const claimed = await runInTransaction(async () => {
        const comm = await commStorage.createComm({
          medium: 'email',
          contactId,
          status: 'offline',
          sent: new Date(),
          data: { initiatedBy: userId || 'system', offline: true },
          sendKey: sendKey ?? null,
        });
        if (!comm) return null;

        const commEmail = await commEmailStorage.createCommEmail({
          commId: comm.id,
          to: toEmail,
          toName: toName || null,
          from: fromEmail || null,
          fromName: fromName || null,
          replyTo: replyTo || null,
          subject,
          bodyText: bodyText || null,
          bodyHtml: bodyHtml || null,
          data: {},
        });

        if (tagIds && tagIds.length > 0) {
          await storage.commTags.setTags(comm.id, tagIds);
        }

        return { comm, commEmail };
      });

      if (!claimed) return await alreadySent(contactId, sendKey!);
      const { comm, commEmail } = claimed;

      return { success: true, comm, commEmail };
    } catch (error: any) {
      logger.error('Email offline record failed', {
        service: 'email-sender',
        error: error?.message || String(error),
      });
      return {
        success: false,
        error: error?.message || 'Unknown error occurred while recording offline email',
        errorCode: 'UNKNOWN_ERROR',
      };
    }
  }

  try {
    const emailTransport = await serviceRegistry.resolve<EmailTransport>('email');

    if (!emailTransport.supportsEmail()) {
      return {
        success: false,
        error: 'Email sending is not supported by the current provider. Configure a provider with email capability (e.g., SendGrid).',
        errorCode: 'EMAIL_NOT_SUPPORTED',
      };
    }

    const validationResult = await emailTransport.validateEmail(toEmail);
    if (!validationResult.valid || !validationResult.formatted) {
      return {
        success: false,
        error: `Invalid email address: ${validationResult.error || 'Unknown validation error'}`,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const normalizedEmail = validationResult.formatted;

    const toRecipient: EmailRecipient = {
      email: normalizedEmail,
      name: toName,
    };

    let fromRecipient: EmailRecipient | undefined;
    if (fromEmail) {
      fromRecipient = { email: fromEmail, name: fromName };
    } else {
      fromRecipient = await emailTransport.getDefaultFromAddress();
    }

    // This insert is the send-once claim: if a key was supplied and it is
    // already spent, nothing is written and nothing is sent.
    const claimed = await runInTransaction(async () => {
      const comm = await commStorage.createComm({
        medium: 'email',
        contactId,
        status: 'sending',
        sent: new Date(),
        data: { initiatedBy: userId || 'system' },
        sendKey: sendKey ?? null,
      });
      if (!comm) return null;

      const commEmail = await commEmailStorage.createCommEmail({
        commId: comm.id,
        to: normalizedEmail,
        toName: toName || null,
        from: fromRecipient?.email || null,
        fromName: fromRecipient?.name || null,
        replyTo: replyTo || null,
        subject,
        bodyText: bodyText || null,
        bodyHtml: bodyHtml || null,
        data: {},
      });

      if (tagIds && tagIds.length > 0) {
        await storage.commTags.setTags(comm.id, tagIds);
      }

      return { comm, commEmail };
    });

    if (!claimed) return await alreadySent(contactId, sendKey!);
    const { comm, commEmail } = claimed;

    const optinRecord = await emailOptinStorage.getEmailOptinByEmail(normalizedEmail);

    if (!optinRecord || !optinRecord.optin) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'NOT_OPTED_IN',
          errorMessage: 'Email address has not opted in to receive emails',
        },
      });

      // PII triage: commId identifies the message; the address stays out of logs.
      logger.warn('Email not sent - not opted in', {
        service: 'email-sender',
        commId: comm.id,
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commEmail,
        error: 'Email address has not opted in to receive emails',
        errorCode: 'NOT_OPTED_IN',
      };
    }

    const systemMode = await getSystemMode();

    if (systemMode !== 'live' && !optinRecord.allowlist) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'NOT_ALLOWLISTED',
          errorMessage: `Email address is not allowlisted. System mode is "${systemMode}" - only allowlisted emails can receive messages in non-live modes.`,
          systemMode,
        },
      });

      // PII triage: commId identifies the message; the address stays out of logs.
      logger.warn('Email not sent - not allowlisted', {
        service: 'email-sender',
        commId: comm.id,
        systemMode,
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commEmail,
        error: `Email address is not allowlisted. System mode is "${systemMode}" - only allowlisted emails can receive messages in non-live modes.`,
        errorCode: 'NOT_ALLOWLISTED',
      };
    }
    
    // PII triage: commId identifies the message; addresses and staff-entered
    // subject text stay out of logs.
    logger.info('Sending email', {
      service: 'email-sender',
      commId: comm.id,
      systemMode,
    });

    const statusCallbackUrl = buildStatusCallbackUrl(comm.id);

    try {
      const sendResult = await emailTransport.sendEmail({
        to: toRecipient,
        from: fromRecipient,
        replyTo: replyTo ? { email: replyTo } : undefined,
        subject,
        text: bodyText,
        html: bodyHtml,
        statusCallbackUrl,
      });

      if (!sendResult.success) {
        await commStorage.updateComm(comm.id, {
          status: 'failed',
          data: {
            ...comm.data as object,
            errorCode: 'PROVIDER_ERROR',
            errorMessage: sendResult.error,
          },
        });

        logger.error('Email send failed', {
          service: 'email-sender',
          commId: comm.id,
          error: sendResult.error,
        });

        return {
          success: false,
          comm: { ...comm, status: 'failed' },
          commEmail,
          error: sendResult.error,
          errorCode: 'PROVIDER_ERROR',
        };
      }

      await commStorage.updateComm(comm.id, {
        status: 'sent',
        data: {
          ...comm.data as object,
          messageId: sendResult.messageId,
        },
      });

      await commEmailStorage.updateCommEmail(commEmail.id, {
        data: {
          ...commEmail.data as object,
          messageId: sendResult.messageId,
        },
      });

      logger.info('Email sent successfully', {
        service: 'email-sender',
        commId: comm.id,
        messageId: sendResult.messageId,
      });

      return {
        success: true,
        comm: { ...comm, status: 'sent' },
        commEmail,
        messageId: sendResult.messageId,
      };

    } catch (error: any) {
      // A maintenance refusal is not a provider failure. Let it out so the
      // route answers 503 with the maintenance message instead of burying it
      // in a PROVIDER_ERROR/UNKNOWN_ERROR result.
      if (isMaintenanceModeError(error)) throw error;
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'PROVIDER_ERROR',
          errorMessage: error?.message || 'Provider error',
        },
      });

      logger.error('Email provider error', {
        service: 'email-sender',
        commId: comm.id,
        error: error?.message,
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commEmail,
        error: error?.message || 'Email provider error',
        errorCode: 'PROVIDER_ERROR',
      };
    }

  } catch (error: any) {
    // See above: the refusal is the answer, not a failed send.
    if (isMaintenanceModeError(error)) throw error;
    logger.error('Email sending failed', {
      service: 'email-sender',
      error: error?.message || String(error),
    });

    return {
      success: false,
      error: error?.message || 'Unknown error occurred while sending email',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
