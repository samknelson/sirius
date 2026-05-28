import type { Request } from 'express';
import type { CommStatusHandler, CommStatusUpdate } from './index';

export class SendGridStatusHandler implements CommStatusHandler {
  readonly providerId = 'sendgrid';
  readonly medium = 'email' as const;

  async validateRequest(req: Request): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }

  parseStatusUpdate(req: Request): CommStatusUpdate {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const event = events[0] || {};

    const { 
      event: eventType,
      sg_event_id,
      sg_message_id,
      timestamp,
      email,
      reason,
      status,
      type,
      bounce_classification,
    } = event;

    const statusMap: Record<string, CommStatusUpdate['status']> = {
      'processed': 'queued',
      'deferred': 'sending',
      'delivered': 'delivered',
      'open': 'delivered',
      'click': 'delivered',
      'bounce': 'failed',
      'dropped': 'failed',
      'spamreport': 'failed',
      'unsubscribe': 'delivered',
      'group_unsubscribe': 'delivered',
      'group_resubscribe': 'delivered',
    };

    const normalizedStatus = statusMap[eventType] || 'unknown';

    let errorMessage: string | undefined;
    if (eventType === 'bounce' || eventType === 'dropped') {
      errorMessage = reason || bounce_classification || `Email ${eventType}`;
    }

    return {
      status: normalizedStatus,
      providerStatus: eventType || 'unknown',
      errorCode: type,
      errorMessage,
      timestamp: timestamp ? new Date(timestamp * 1000) : new Date(),
      rawPayload: event,
    };
  }

  getProviderMessageId(req: Request): string | undefined {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const event = events[0] || {};
    return event.sg_message_id;
  }
}
