import type { ConnectionTestResult } from '../base';
import type { SmsTransport, PhoneValidationResult, SmsSendResult, SmsProviderSettings } from './index';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

export class LocalSmsProvider implements SmsTransport {
  readonly id = 'local';
  readonly displayName = 'Local (Validation Only)';
  readonly category = 'sms' as const;
  readonly supportedFeatures = ['phone-validation'];

  private settings: SmsProviderSettings = {};

  async configure(config: unknown): Promise<void> {
    if (config && typeof config === 'object') {
      this.settings = config as SmsProviderSettings;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'Local provider is always available (no external connection required)',
    };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    return {
      connected: true,
      provider: 'local',
      capabilities: this.supportedFeatures,
    };
  }

  async validatePhone(phoneNumber: string): Promise<PhoneValidationResult> {
    try {
      const parsed = parsePhoneNumber(phoneNumber, 'US');
      
      if (!parsed) {
        return {
          valid: false,
          error: 'Could not parse phone number. Please check the format.',
        };
      }

      if (!parsed.isValid()) {
        // Provide detailed error message
        const errorDetails = this.getValidationErrorDetails(parsed);
        return {
          valid: false,
          error: errorDetails,
        };
      }

      return {
        valid: true,
        formatted: parsed.format('E.164'),
        countryCode: parsed.country,
        nationalNumber: parsed.nationalNumber,
        type: parsed.getType() || 'unknown',
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error?.message || 'Validation failed',
      };
    }
  }

  private getValidationErrorDetails(phoneNumber: ReturnType<typeof parsePhoneNumber>): string {
    if (!phoneNumber) {
      return 'Invalid phone number format';
    }

    const nationalNumber = phoneNumber.nationalNumber;
    const isPossible = phoneNumber.isPossible();
    const detectedCountry = phoneNumber.country;
    
    // For US/NANP numbers, check specific issues
    if (detectedCountry === 'US' || (!detectedCountry && nationalNumber?.length === 10)) {
      // NANP format: NPA-NXX-XXXX where N=2-9, X=0-9
      if (nationalNumber && nationalNumber.length === 10) {
        const areaCode = nationalNumber.substring(0, 3);
        const exchange = nationalNumber.substring(3, 6);
        
        // Check if exchange starts with 0 or 1 (invalid in NANP)
        if (exchange.startsWith('0') || exchange.startsWith('1')) {
          return `Invalid exchange code "${exchange}". US phone numbers cannot have an exchange (middle 3 digits) starting with 0 or 1.`;
        }
        
        // Check if area code starts with 0 or 1 (invalid in NANP)
        if (areaCode.startsWith('0') || areaCode.startsWith('1')) {
          return `Invalid area code "${areaCode}". US area codes cannot start with 0 or 1.`;
        }
        
        // The number format is correct but doesn't match allocated patterns
        return `Phone number (${areaCode}) ${exchange}-${nationalNumber.substring(6)} is not a valid US phone number. The number pattern is not allocated or does not exist.`;
      }
    }
    
    // Check if it's a length issue
    if (!isPossible) {
      return 'Phone number has incorrect length for US format.';
    }
    
    return 'Phone number is not valid for US. The number pattern may not be allocated or does not exist.';
  }

  supportsSms(): boolean {
    return false;
  }

  async sendSms(params: {
    to: string;
    body: string;
    from?: string;
    statusCallbackUrl?: string;
  }): Promise<SmsSendResult> {
    return {
      success: false,
      error: 'SMS sending is not supported by the local provider. Configure Twilio or another SMS provider to enable SMS functionality.',
    };
  }

  async getDefaultFromNumber(): Promise<string | undefined> {
    return undefined;
  }
}
