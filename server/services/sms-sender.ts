import { getTwilioClient, getTwilioFromPhoneNumber } from '../lib/twilio-client';
import { getSystemMode } from './system-mode';
import { createCommStorage, createCommSmsStorage, createCommSmsOptinStorage } from '../storage/comm';
import { phoneValidationService } from './phone-validation';
import type { Comm, CommSms } from '@shared/schema';

export interface SendSmsRequest {
  contactId: string;
  toPhoneNumber: string;
  message: string;
  userId?: string;
}

export interface SendSmsResult {
  success: boolean;
  comm?: Comm;
  commSms?: CommSms;
  error?: string;
  errorCode?: 'NOT_OPTED_IN' | 'NOT_ALLOWLISTED' | 'TWILIO_ERROR' | 'VALIDATION_ERROR' | 'UNKNOWN_ERROR';
  twilioMessageSid?: string;
}

const commStorage = createCommStorage();
const commSmsStorage = createCommSmsStorage();
const smsOptinStorage = createCommSmsOptinStorage();

export async function sendSms(request: SendSmsRequest): Promise<SendSmsResult> {
  const { contactId, toPhoneNumber, message, userId } = request;

  try {
    const validationResult = await phoneValidationService.validateAndFormat(toPhoneNumber);
    if (!validationResult.isValid || !validationResult.e164Format) {
      return {
        success: false,
        error: `Invalid phone number: ${validationResult.error || 'Unknown validation error'}`,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const normalizedPhone = validationResult.e164Format;

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
      const twilioClient = await getTwilioClient();
      const fromNumber = await getTwilioFromPhoneNumber();

      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.REPLIT_DEPLOYMENT_DOMAIN
          ? `https://${process.env.REPLIT_DEPLOYMENT_DOMAIN}`
          : '';

      const statusCallbackUrl = baseUrl ? `${baseUrl}/api/webhooks/twilio/sms-status` : undefined;

      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: fromNumber,
        to: normalizedPhone,
        statusCallback: statusCallbackUrl,
      });

      await commSmsStorage.updateCommSms(commSms.id, {
        data: {
          ...commSms.data as object,
          twilioMessageSid: twilioMessage.sid,
          twilioStatus: twilioMessage.status,
          twilioDateSent: twilioMessage.dateSent,
        },
      });

      await commStorage.updateComm(comm.id, {
        status: 'sending',
        data: {
          ...comm.data as object,
          twilioMessageSid: twilioMessage.sid,
          twilioInitialStatus: twilioMessage.status,
        },
      });

      return {
        success: true,
        comm: { ...comm, status: 'sending' },
        commSms,
        twilioMessageSid: twilioMessage.sid,
      };

    } catch (twilioError: any) {
      const errorMessage = twilioError?.message || 'Failed to send SMS via Twilio';
      
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'TWILIO_ERROR',
          errorMessage,
          twilioErrorCode: twilioError?.code,
          twilioErrorStatus: twilioError?.status,
        },
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commSms,
        error: errorMessage,
        errorCode: 'TWILIO_ERROR',
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

export async function handleTwilioStatusCallback(payload: {
  MessageSid: string;
  MessageStatus: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  To?: string;
  From?: string;
}): Promise<{ success: boolean; commId?: string; error?: string }> {
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = payload;

  try {
    const found = await commSmsStorage.getCommSmsByTwilioSid(MessageSid);
    
    if (!found) {
      console.warn(`No comm record found for Twilio message SID: ${MessageSid}`);
      return { success: false, error: 'Comm record not found' };
    }

    const { comm, commSms } = found;

    const statusMap: Record<string, string> = {
      'queued': 'sending',
      'sending': 'sending',
      'sent': 'sent',
      'delivered': 'delivered',
      'undelivered': 'failed',
      'failed': 'failed',
    };

    const newStatus = statusMap[MessageStatus] || 'unknown';

    const existingData = commSms.data as object || {};
    await commSmsStorage.updateCommSms(commSms.id, {
      data: {
        ...existingData,
        twilioStatus: MessageStatus,
        twilioErrorCode: ErrorCode,
        twilioErrorMessage: ErrorMessage,
        lastWebhookAt: new Date().toISOString(),
      },
    });

    const commData = comm.data as object || {};
    await commStorage.updateComm(comm.id, {
      status: newStatus,
      data: {
        ...commData,
        lastTwilioStatus: MessageStatus,
        lastWebhookAt: new Date().toISOString(),
        ...(ErrorCode && { twilioErrorCode: ErrorCode }),
        ...(ErrorMessage && { twilioErrorMessage: ErrorMessage }),
      },
    });

    return { success: true, commId: comm.id };

  } catch (error: any) {
    console.error('Error handling Twilio status callback:', error);
    return { success: false, error: error?.message || 'Unknown error' };
  }
}
