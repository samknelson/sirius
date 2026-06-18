import type { Request } from 'express';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import twilio from 'twilio';

export class TwilioStatusHandler implements CommStatusHandler {
  readonly providerId = 'twilio';
  readonly medium = 'sms' as const;

  async validateRequest(req: Request): Promise<{ valid: boolean; error?: string }> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!authToken) {
      console.warn('TWILIO_AUTH_TOKEN not set - skipping signature validation');
      return { valid: true };
    }

    const twilioSignature = req.headers['x-twilio-signature'] as string;
    
    if (!twilioSignature) {
      return { valid: false, error: 'Missing X-Twilio-Signature header' };
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['host'];
    const url = `${protocol}://${host}${req.originalUrl}`;

    const params = req.body || {};

    const isValid = twilio.validateRequest(authToken, twilioSignature, url, params);

    if (!isValid) {
      return { valid: false, error: 'Invalid Twilio signature' };
    }

    return { valid: true };
  }

  parseStatusUpdate(req: Request): CommStatusUpdate {
    const { 
      MessageStatus, 
      ErrorCode, 
      ErrorMessage,
      MessageSid,
      To,
      From,
      AccountSid,
      ApiVersion,
      SmsSid,
      SmsStatus,
    } = req.body;

    const statusMap: Record<string, CommStatusUpdate['status']> = {
      'queued': 'queued',
      'sending': 'sending',
      'sent': 'sent',
      'delivered': 'delivered',
      'undelivered': 'undelivered',
      'failed': 'failed',
    };

    const normalizedStatus = statusMap[MessageStatus] || 'unknown';

    return {
      status: normalizedStatus,
      providerStatus: MessageStatus,
      errorCode: ErrorCode,
      errorMessage: ErrorMessage,
      timestamp: new Date(),
      rawPayload: {
        MessageSid,
        MessageStatus,
        ErrorCode,
        ErrorMessage,
        To,
        From,
        AccountSid,
        ApiVersion,
        SmsSid,
        SmsStatus,
      },
    };
  }

  getProviderMessageId(req: Request): string | undefined {
    return req.body?.MessageSid;
  }
}
