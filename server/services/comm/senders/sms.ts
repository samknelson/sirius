import { serviceRegistry } from '../../service-registry';
import { getSystemMode } from '../../system-mode';
import { createCommStorage, createCommSmsStorage, createCommSmsOptinStorage } from '../../../storage/comm';
import { storage } from '../../../storage';
import { runInTransaction } from '../../../storage/transaction-context';
import { buildStatusCallbackUrl } from '../callback-handlers/url-builder';
import { phoneValidationService } from '../validators/phone';
import type { SmsTransport } from '../providers/sms';
import type { Comm, CommSms } from '@shared/schema';
import { isMaintenanceModeError } from "../../maintenance-flag";
import { ALREADY_SENT, findSentWithKey, type AlreadySentCode } from '../send-key';

export interface SendSmsRequest {
  contactId: string;
  toPhoneNumber: string;
  message: string;
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

export interface SendSmsResult {
  success: boolean;
  comm?: Comm;
  commSms?: CommSms;
  error?: string;
  errorCode?: 'NOT_OPTED_IN' | 'NOT_ALLOWLISTED' | 'PROVIDER_ERROR' | 'VALIDATION_ERROR' | 'SMS_NOT_SUPPORTED' | 'UNKNOWN_ERROR' | AlreadySentCode;
  /**
   * The send was refused because its key was already spent. This is NOT a
   * failure — nothing was attempted and nothing broke. `comm` carries the
   * message that did go out, when it can still be read.
   */
  alreadySent?: boolean;
  messageId?: string;
}

const commStorage = createCommStorage();
const commSmsStorage = createCommSmsStorage();
const smsOptinStorage = createCommSmsOptinStorage();

/**
 * The answer when the claim insert came back empty: this key is spent, so the
 * message already went out and nothing may be handed to the provider again.
 */
async function alreadySent(contactId: string, sendKey: string): Promise<SendSmsResult> {
  const existing = await findSentWithKey({ medium: 'sms', contactId, sendKey });
  return {
    success: false,
    alreadySent: true,
    comm: existing,
    error: 'An SMS with this send key has already been sent to this contact',
    errorCode: ALREADY_SENT,
  };
}

export async function sendSms(request: SendSmsRequest): Promise<SendSmsResult> {
  const { contactId, toPhoneNumber, message, userId, tagIds, sendOffline, sendKey } = request;

  if (sendOffline) {
    try {
      const claimed = await runInTransaction(async () => {
        const comm = await commStorage.createComm({
          medium: 'sms',
          contactId,
          status: 'offline',
          sent: new Date(),
          data: { initiatedBy: userId || 'system', offline: true },
          sendKey: sendKey ?? null,
        });
        if (!comm) return null;

        const commSms = await commSmsStorage.createCommSms({
          commId: comm.id,
          to: toPhoneNumber,
          body: message,
          data: {},
        });

        if (tagIds && tagIds.length > 0) {
          await storage.commTags.setTags(comm.id, tagIds);
        }

        return { comm, commSms };
      });

      if (!claimed) return await alreadySent(contactId, sendKey!);
      const { comm, commSms } = claimed;

      return { success: true, comm, commSms };
    } catch (error: any) {
      console.error('SMS offline record error:', error);
      return {
        success: false,
        error: error?.message || 'Unknown error occurred while recording offline SMS',
        errorCode: 'UNKNOWN_ERROR',
      };
    }
  }

  try {
    const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');

    if (!smsTransport.supportsSms()) {
      return {
        success: false,
        error: 'SMS sending is not supported by the current provider. Configure a provider with SMS capability (e.g., Twilio).',
        errorCode: 'SMS_NOT_SUPPORTED',
      };
    }

    // Normalize locally first. Deciding whether this number can be texted at
    // all is a question for the provider, but it is not worth asking before
    // we know the recipient has opted in — a message that is about to be
    // rejected as not-opted-in should cost nothing.
    const localResult = await phoneValidationService.validateAndFormat(toPhoneNumber, {
      revalidate: 'never',
    });
    if (!localResult.isValid || !localResult.e164Format) {
      return {
        success: false,
        error: `Invalid phone number: ${localResult.error || 'Unknown validation error'}`,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const normalizedPhone = localResult.e164Format;

    // This insert is the send-once claim: if a key was supplied and it is
    // already spent, nothing is written and nothing is sent.
    const claimed = await runInTransaction(async () => {
      const comm = await commStorage.createComm({
        medium: 'sms',
        contactId,
        status: 'sending',
        sent: new Date(),
        data: { initiatedBy: userId || 'system' },
        sendKey: sendKey ?? null,
      });
      if (!comm) return null;

      const commSms = await commSmsStorage.createCommSms({
        commId: comm.id,
        to: normalizedPhone,
        body: message,
        data: {},
      });

      if (tagIds && tagIds.length > 0) {
        await storage.commTags.setTags(comm.id, tagIds);
      }

      return { comm, commSms };
    });

    if (!claimed) return await alreadySent(contactId, sendKey!);
    const { comm, commSms } = claimed;

    const optinRecord = await smsOptinStorage.getSmsOptinByPhoneNumber(normalizedPhone);
    
    if (!optinRecord || !optinRecord.optin) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'NOT_OPTED_IN',
          errorMessage: 'Phone number has not opted in to receive SMS messages',
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commSms,
        error: 'Phone number has not opted in to receive SMS messages',
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
          errorMessage: `Phone number is not allowlisted. System mode is "${systemMode}" - only allowlisted numbers can receive SMS in non-live modes.`,
          systemMode,
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commSms,
        error: `Phone number is not allowlisted. System mode is "${systemMode}" - only allowlisted numbers can receive SMS in non-live modes.`,
        errorCode: 'NOT_ALLOWLISTED',
      };
    }

    // The recipient is real and has opted in, so the number is now worth
    // confirming with the provider — at most one lookup, and none at all if it
    // was confirmed within the revalidation window.
    const validationResult = await phoneValidationService.validateAndFormat(normalizedPhone, {
      revalidate: 'default',
    });
    if (!validationResult.isValid) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'VALIDATION_ERROR',
          errorMessage: validationResult.error || 'Unknown validation error',
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commSms,
        error: `Invalid phone number: ${validationResult.error || 'Unknown validation error'}`,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    try {
      const fromNumber = await smsTransport.getDefaultFromNumber();

      const statusCallbackUrl = buildStatusCallbackUrl(comm.id);

      const sendResult = await smsTransport.sendSms({
        to: normalizedPhone,
        body: message,
        from: fromNumber,
        statusCallbackUrl,
      });

      if (!sendResult.success) {
        await commStorage.updateComm(comm.id, {
          status: 'failed',
          data: {
            ...comm.data as object,
            errorCode: 'PROVIDER_ERROR',
            errorMessage: sendResult.error,
            providerDetails: sendResult.details,
          },
        });

        return {
          success: false,
          comm: { ...comm, status: 'failed' },
          commSms,
          error: sendResult.error || 'Failed to send SMS',
          errorCode: 'PROVIDER_ERROR',
        };
      }

      await commSmsStorage.updateCommSms(commSms.id, {
        data: {
          ...commSms.data as object,
          messageId: sendResult.messageId,
          providerStatus: sendResult.status,
          providerDetails: sendResult.details,
        },
      });

      await commStorage.updateComm(comm.id, {
        status: 'sending',
        data: {
          ...comm.data as object,
          messageId: sendResult.messageId,
          initialStatus: sendResult.status,
        },
      });

      return {
        success: true,
        comm: { ...comm, status: 'sending' },
        commSms,
        messageId: sendResult.messageId,
      };

    } catch (providerError: any) {
      // A maintenance refusal is not a provider failure. Let it out so the
      // route answers 503 with the maintenance message instead of burying it
      // in a PROVIDER_ERROR/UNKNOWN_ERROR result.
      if (isMaintenanceModeError(providerError)) throw providerError;
      const errorMessage = providerError?.message || 'Failed to send SMS';
      
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'PROVIDER_ERROR',
          errorMessage,
          providerErrorCode: providerError?.code,
          providerErrorStatus: providerError?.status,
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commSms,
        error: errorMessage,
        errorCode: 'PROVIDER_ERROR',
      };
    }

  } catch (error: any) {
    // See above: the refusal is the answer, not a failed send.
    if (isMaintenanceModeError(error)) throw error;
    console.error('SMS sending error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error occurred while sending SMS',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
