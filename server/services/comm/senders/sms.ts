import { serviceRegistry } from '../../service-registry';
import { getSystemMode } from '../../system-mode';
import { createCommStorage, createCommSmsStorage, createCommSmsOptinStorage } from '../../../storage/comm';
import { storage } from '../../../storage';
import { runInTransaction } from '../../../storage/transaction-context';
import { buildStatusCallbackUrl } from '../callback-handlers/url-builder';
import type { SmsTransport } from '../providers/sms';
import type { Comm, CommSms } from '@shared/schema';

export interface SendSmsRequest {
  contactId: string;
  toPhoneNumber: string;
  message: string;
  userId?: string;
  tagIds?: string[];
  sendOffline?: boolean;
}

export interface SendSmsResult {
  success: boolean;
  comm?: Comm;
  commSms?: CommSms;
  error?: string;
  errorCode?: 'NOT_OPTED_IN' | 'NOT_ALLOWLISTED' | 'PROVIDER_ERROR' | 'VALIDATION_ERROR' | 'SMS_NOT_SUPPORTED' | 'UNKNOWN_ERROR';
  messageId?: string;
}

const commStorage = createCommStorage();
const commSmsStorage = createCommSmsStorage();
const smsOptinStorage = createCommSmsOptinStorage();

export async function sendSms(request: SendSmsRequest): Promise<SendSmsResult> {
  const { contactId, toPhoneNumber, message, userId, tagIds, sendOffline } = request;

  if (sendOffline) {
    try {
      const { comm, commSms } = await runInTransaction(async () => {
        const comm = await commStorage.createComm({
          medium: 'sms',
          contactId,
          status: 'offline',
          sent: new Date(),
          data: { initiatedBy: userId || 'system', offline: true },
        });

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

    const validationResult = await smsTransport.validatePhone(toPhoneNumber);
    if (!validationResult.valid || !validationResult.formatted) {
      return {
        success: false,
        error: `Invalid phone number: ${validationResult.error || 'Unknown validation error'}`,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const normalizedPhone = validationResult.formatted;

    const { comm, commSms } = await runInTransaction(async () => {
      const comm = await commStorage.createComm({
        medium: 'sms',
        contactId,
        status: 'sending',
        sent: new Date(),
        data: { initiatedBy: userId || 'system' },
      });

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
    console.error('SMS sending error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error occurred while sending SMS',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
