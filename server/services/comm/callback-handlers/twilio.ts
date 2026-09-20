import type { Request } from 'express';
import type { CommStatusHandler, CommStatusUpdate } from './index';
import twilio from 'twilio';
import {
  getEnvironmentVariable,
  registerEnvironmentVariable,
} from "../../../config/env-registry";

export class TwilioStatusHandler implements CommStatusHandler {
  readonly providerId = 'twilio';
  readonly medium = 'sms' as const;

  async validateRequest(req: Request): Promise<{ valid: boolean; error?: string }> {
    try {
      const { storage } = await import("../../../storage");
      const accountSid =
        typeof req.body?.AccountSid === "string" ? req.body.AccountSid.trim() : "";
      if (!accountSid) {
        return { valid: false, error: "Twilio callback account does not match configuration" };
      }

      // A callback may arrive while a provider switch is in flight. Match by
      // account SID across both enabled and disabled rows so the old Twilio
      // credentials remain usable for callbacks already sent by Twilio. A
      // disabled row is never accepted merely because it is the only row.
      const configs = await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", "twilio");
      const matchingConfigs = configs.filter((config) => {
        if (!config.data || typeof config.data !== "object") return false;
        const values = config.data as Record<string, unknown>;
        return typeof values.accountSid === "string" &&
          values.accountSid.trim() === accountSid;
      });
      if (matchingConfigs.length !== 1) {
        return {
          valid: false,
          error: matchingConfigs.length === 0
            ? "No Twilio SMS configuration matches callback account"
            : "Ambiguous Twilio SMS configuration for callback account",
        };
      }

      const matchingConfig = matchingConfigs[0];
      const values = matchingConfig.data as Record<string, unknown>;
      const secretName =
        typeof values.secretName === "string" ? values.secretName.trim() : "";
      if (!secretName) {
        return { valid: false, error: "Twilio callback secret is not configured" };
      }
      registerEnvironmentVariable({
        name: secretName,
        description: `Twilio SMS auth token named by vendor configuration '${matchingConfig.siriusId ?? matchingConfig.id}'.`,
        secret: true,
        category: "webclient",
        changeTakesEffect: "immediate",
      });
      const authToken = getEnvironmentVariable(secretName);
      if (!authToken) {
        return { valid: false, error: "Twilio callback secret is unavailable" };
      }

      const twilioSignature = req.headers["x-twilio-signature"];
      if (typeof twilioSignature !== "string" || !twilioSignature) {
        return { valid: false, error: "Missing X-Twilio-Signature header" };
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers.host;
      if (typeof protocol !== "string" || typeof host !== "string" || !host) {
        return { valid: false, error: "Twilio callback URL is incomplete" };
      }
      const url = `${protocol}://${host}${req.originalUrl}`;
      const isValid = twilio.validateRequest(
        authToken,
        twilioSignature,
        url,
        req.body || {},
      );
      return isValid
        ? { valid: true }
        : { valid: false, error: "Invalid Twilio signature" };
    } catch (error) {
      return {
        valid: false,
        error: `Twilio callback validation failed: ${
          error instanceof Error ? error.message : "configuration or secret error"
        }`,
      };
    }
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
