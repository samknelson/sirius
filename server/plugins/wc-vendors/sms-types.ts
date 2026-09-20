/**
 * SMS vendor vocabulary lives beside the SMS plugins rather than in the
 * shared wc-vendor contract.  This keeps the generic vendor framework unaware
 * of one particular domain while still giving SMS callers typed operations.
 */
import type { WcVendorOperations } from "./types";

export interface SmsValidatePhoneArgs {
  phoneNumber: string;
}

export interface SmsValidatePhoneResult {
  valid: boolean;
  formatted?: string;
  countryCode?: string;
  nationalNumber?: string;
  type?: string;
  carrier?: string;
  error?: string;
  smsPossible?: boolean;
  voicePossible?: boolean;
}

export interface SmsSendArgs {
  to: string;
  body: string;
  from?: string;
  statusCallbackUrl?: string;
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface SmsPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: { sms: boolean; voice: boolean; mms: boolean };
}

declare module "./types" {
  interface WcVendorOperations {
    "communications.phone.validate": {
      args: SmsValidatePhoneArgs;
      result: SmsValidatePhoneResult;
    };
    "communications.sms.send": {
      args: SmsSendArgs;
      result: SmsSendResult;
    };
    "communications.phone.list": {
      args: void;
      result: SmsPhoneNumber[];
    };
    "communications.sms.configuration.read": {
      args: void;
      result: Record<string, unknown>;
    };
  }
}

// Keep this import type in the file: it makes accidental removal of the
// augmentation visible to TypeScript's noUnusedLocals check.
type _SmsOperationsAreAugmented = WcVendorOperations;