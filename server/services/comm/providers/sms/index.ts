import type { ServiceProvider, ConnectionTestResult } from '../base';

export interface PhoneValidationResult {
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

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface SmsTransport extends ServiceProvider {
  readonly category: 'sms';
  
  validatePhone(phoneNumber: string): Promise<PhoneValidationResult>;
  
  sendSms(params: {
    to: string;
    body: string;
    from?: string;
    statusCallbackUrl?: string;
  }): Promise<SmsSendResult>;
  
  supportsSms(): boolean;
  
  getAvailablePhoneNumbers?(): Promise<Array<{
    sid: string;
    phoneNumber: string;
    friendlyName: string;
    capabilities: { sms: boolean; voice: boolean; mms: boolean };
  }>>;
  
  getDefaultFromNumber(): Promise<string | undefined>;
  setDefaultFromNumber?(phoneNumber: string): Promise<void>;
}

export interface SmsProviderSettings {
  defaultFromNumber?: string;
  [key: string]: unknown;
}
