import type { ConnectionTestResult } from "../base";
import type {
  SmsTransport,
  PhoneValidationResult,
  SmsSendResult,
} from "./index";
import { assertExternalServiceAllowed } from "../../../maintenance-flag";

/**
 * Compatibility type for old imports. SMS delivery and lookup are no longer
 * implemented here; callers must use the wc-vendor Twilio plugin. Keeping a
 * non-runnable shell avoids breaking third-party imports while ensuring this
 * legacy module cannot register or bypass the webclient framework.
 */
export class TwilioSmsProvider implements SmsTransport {
  readonly id = "twilio";
  readonly displayName = "Twilio";
  readonly category = "sms" as const;
  readonly supportedFeatures = [
    "sms",
    "phone-validation",
    "phone-lookup",
    "delivery-status",
  ];
  supportsSms(): boolean {
    return false;
  }

  async configure(_config: unknown): Promise<void> {}

  async testConnection(): Promise<ConnectionTestResult> {
    assertExternalServiceAllowed("Twilio", "test connection");
    return {
      success: false,
      error: "Legacy Twilio transport is disabled; use the wc-vendor plugin.",
    };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    assertExternalServiceAllowed("Twilio", "read account configuration");
    return {
      connected: false,
      error: "Legacy Twilio transport is disabled; use the wc-vendor plugin.",
    };
  }

  async validatePhone(_phoneNumber: string): Promise<PhoneValidationResult> {
    assertExternalServiceAllowed("Twilio", "look up phone number");
    return {
      valid: false,
      error: "Legacy Twilio transport is disabled; use the wc-vendor plugin.",
    };
  }

  async sendSms(_params: {
    to: string;
    body: string;
    from?: string;
    statusCallbackUrl?: string;
  }): Promise<SmsSendResult> {
    assertExternalServiceAllowed("Twilio", "send SMS");
    return {
      success: false,
      error: "Legacy Twilio transport is disabled; use the wc-vendor plugin.",
    };
  }

  async getDefaultFromNumber(): Promise<string | undefined> {
    assertExternalServiceAllowed("Twilio", "read default phone number");
    return undefined;
  }

  async getAvailablePhoneNumbers(): Promise<Array<{
    sid: string;
    phoneNumber: string;
    friendlyName: string;
    capabilities: { sms: boolean; voice: boolean; mms: boolean };
  }>> {
    assertExternalServiceAllowed("Twilio", "list phone numbers");
    return [];
  }
}