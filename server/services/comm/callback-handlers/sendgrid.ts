import type { Request } from 'express';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import { createPublicKey, verify } from "node:crypto";
import { freshTimestamp, verificationConfig, type CallbackRequest } from "./verification";

export class SendGridStatusHandler implements CommStatusHandler {
  readonly providerId = 'sendgrid';
  readonly medium = 'email' as const;

  async validateRequest(req: Request, vendorConfigId?: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const signature = req.headers["x-twilio-email-event-webhook-signature"];
      const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"];
      const raw = (req as CallbackRequest).rawCallbackBody;
      if (typeof signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) ||
          !freshTimestamp(timestamp) || !Buffer.isBuffer(raw)) {
        return { valid: false, error: "Missing or invalid SendGrid signature, timestamp, or raw body" };
      }
      const config = await verificationConfig("sendgrid", vendorConfigId);
      const publicKey = config.webhookPublicKey;
      if (typeof publicKey !== "string" || !publicKey.trim()) {
        return { valid: false, error: "SendGrid webhook public key is not configured" };
      }
      // SendGrid supplies a base64 DER SubjectPublicKeyInfo EC key and ASN.1
      // ECDSA signature over SHA256(timestamp + original payload bytes).
      // Protocol reference: SendGrid's "Event Webhook Security Features".
      const key = createPublicKey({
        key: Buffer.from(publicKey.trim(), "base64"), format: "der", type: "spki",
      });
      const valid = key.asymmetricKeyType === "ec" && verify(
        "sha256", Buffer.concat([Buffer.from(timestamp), raw]), key,
        Buffer.from(signature, "base64"),
      );
      return valid ? { valid: true } : { valid: false, error: "Invalid SendGrid signature" };
    } catch {
      // Crypto/configuration errors can contain key material; do not relay them.
      return { valid: false, error: "SendGrid callback verification unavailable or invalid" };
    }
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
