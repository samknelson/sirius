import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from '../../../config/env-registry';

registerEnvironmentVariables([
  {
    name: 'LOB_WEBHOOK_SECRET',
    description: 'Signing secret for the account-level Lob status webhook.',
    secret: true,
    category: 'core',
    changeTakesEffect: 'immediate',
  },
]);

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const MAILING_CONFIRMED_EVENTS = new Set([
  'letter.mailed',
  'letter.in_transit',
  'letter.in_local_area',
  'letter.processed_for_delivery',
  'letter.delivered',
  'letter.re-routed',
  'letter.certified.mailed',
  'letter.certified.in_transit',
  'letter.certified.in_local_area',
  'letter.certified.processed_for_delivery',
  'letter.certified.delivered',
  'letter.certified.re-routed',
  'letter.certified.pickup_available',
]);

export function isLobMailingConfirmedEvent(providerStatus: string): boolean {
  return MAILING_CONFIRMED_EVENTS.has(providerStatus);
}

function headerValue(req: Request, name: string): string | undefined {
  const value = typeof req.get === 'function'
    ? req.get(name)
    : (req as Request & { header?: (headerName: string) => string | undefined }).header?.(name);
  return value?.trim() || undefined;
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export class LobStatusHandler implements CommStatusHandler {
  readonly providerId = 'lob';
  readonly medium = 'postal' as const;

  async validateRequest(req: Request): Promise<{ valid: boolean; error?: string }> {
    const secret = getEnvironmentVariable('LOB_WEBHOOK_SECRET');
    if (!secret) return { valid: false, error: 'LOB_WEBHOOK_SECRET is not configured' };

    const signature = headerValue(req, 'Lob-Signature');
    const timestamp = headerValue(req, 'Lob-Signature-Timestamp');
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!signature || !timestamp || !rawBody) {
      return { valid: false, error: 'Missing Lob signature headers or raw request body' };
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) {
      return { valid: false, error: 'Invalid Lob signature timestamp' };
    }
    if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
      return { valid: false, error: 'Lob signature timestamp is outside the allowed window' };
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const receivedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      receivedBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return { valid: false, error: 'Invalid Lob webhook signature' };
    }

    return { valid: true };
  }

  parseStatusUpdate(req: Request): CommStatusUpdate {
    const body = req.body || {};
    
    const { 
      id,
      event_type,
      date_created,
      date_modified,
      body: eventBody,
    } = body;

    const eventData = eventBody || {};
    const { 
      id: letterId,
      tracking_events,
      expected_delivery_date,
      carrier,
      tracking_number,
      mail_type,
      send_date,
    } = eventData;

    const latestTrackingEvent = tracking_events?.[tracking_events.length - 1];

    const statusMap: Record<string, CommStatusUpdate['status']> = {
      'letter.created': 'queued',
      'letter.rendered': 'queued',
      'letter.rendered_pdf': 'queued',
      'letter.rendered_thumbnails': 'queued',
      'letter.deleted': 'failed',
      'letter.mailed': 'sent',
      'letter.in_transit': 'sent',
      'letter.in_local_area': 'sent',
      'letter.processed_for_delivery': 'sent',
      'letter.delivered': 'delivered',
      'letter.re-routed': 'sent',
      'letter.returned_to_sender': 'undelivered',
      'letter.certified.mailed': 'sent',
      'letter.certified.in_transit': 'sent',
      'letter.certified.in_local_area': 'sent',
      'letter.certified.processed_for_delivery': 'sent',
      'letter.certified.delivered': 'delivered',
      'letter.certified.re-routed': 'sent',
      'letter.certified.returned_to_sender': 'undelivered',
      'letter.certified.pickup_available': 'sent',
      'letter.certified.issue': 'failed',
    };

    const eventTypeId = event_type?.id || event_type?.name || (typeof event_type === 'string' ? event_type : undefined);
    const normalizedStatus = statusMap[eventTypeId] || 'unknown';

    const eventTypeName = eventTypeId;
    let errorMessage: string | undefined;
    if (eventTypeName === 'letter.deleted' || 
        eventTypeName === 'letter.returned_to_sender' || 
        eventTypeName === 'letter.certified.returned_to_sender' ||
        eventTypeName === 'letter.certified.issue') {
      errorMessage = `Letter ${eventTypeName?.replace('letter.', '')}`;
    }

    return {
      status: normalizedStatus,
      providerStatus: eventTypeId || 'unknown',
      errorCode: undefined,
      errorMessage,
      timestamp: validDate(date_created) ?? validDate(date_modified) ?? new Date(),
      rawPayload: body,
    };
  }

  getProviderMessageId(req: Request): string | undefined {
    const body = req.body || {};
    return body.body?.id || body.reference_id;
  }
}

const LOB_STATUS_STAGE: Record<string, number> = {
  sending: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  failed: 3,
};

/**
 * Lob callbacks can be duplicated or arrive out of order. Earlier lifecycle
 * events may enrich provider details, but must not move the displayed status
 * backward. Terminal outcomes are only replaced by a newer terminal event.
 */
export function resolveLobCallbackStatus(
  currentStatus: string,
  incomingStatus: CommStatusUpdate['status'],
  currentTimestamp?: string,
  incomingTimestamp?: Date,
): string {
  if (incomingStatus === 'unknown') return currentStatus;

  const currentStage = LOB_STATUS_STAGE[currentStatus] ?? -1;
  const incomingStage = LOB_STATUS_STAGE[incomingStatus] ?? -1;
  if (incomingStage < currentStage) return currentStatus;
  if (incomingStage > currentStage) return incomingStatus;
  if (incomingStatus === currentStatus) return currentStatus;

  const previousTime = currentTimestamp ? new Date(currentTimestamp).getTime() : Number.NEGATIVE_INFINITY;
  const nextTime = incomingTimestamp?.getTime() ?? Number.POSITIVE_INFINITY;
  return nextTime >= previousTime ? incomingStatus : currentStatus;
}
