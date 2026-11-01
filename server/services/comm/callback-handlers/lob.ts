import type { Request } from 'express';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import { createHmac, timingSafeEqual } from "node:crypto";
import { freshTimestamp, verificationConfig, webhookSecret, type CallbackRequest } from "./verification";

export class LobStatusHandler implements CommStatusHandler {
  readonly providerId = 'lob';
  readonly medium = 'postal' as const;

  async validateRequest(req: Request, vendorConfigId?: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const signature = req.headers["lob-signature"];
      const timestamp = req.headers["lob-signature-timestamp"];
      const raw = (req as CallbackRequest).rawCallbackBody;
      if (typeof signature !== "string" || !/^[a-fA-F0-9]{64}$/.test(signature) ||
          !freshTimestamp(timestamp) || !Buffer.isBuffer(raw)) {
        return { valid: false, error: "Missing or invalid Lob signature, timestamp, or raw body" };
      }
      const config = await verificationConfig("lob", vendorConfigId);
      const secret = webhookSecret(config.webhookSecretName);
      // Protocol reference: Lob's "Using webhooks / Webhook signatures".
      const expected = createHmac("sha256", secret).update(timestamp).update(".").update(raw).digest();
      const valid = timingSafeEqual(expected, Buffer.from(signature, "hex"));
      return valid ? { valid: true } : { valid: false, error: "Invalid Lob signature" };
    } catch {
      return { valid: false, error: "Lob callback verification unavailable or invalid" };
    }
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
      timestamp: date_modified ? new Date(date_modified) : new Date(),
      rawPayload: body,
    };
  }

  getProviderMessageId(req: Request): string | undefined {
    const body = req.body || {};
    return body.body?.id || body.reference_id;
  }
}
