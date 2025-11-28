import type { ConnectionTestResult } from '../base';
import type { SmsTransport, PhoneValidationResult, SmsSendResult, SmsProviderSettings } from './index';
import { getTwilioClient, getTwilioFromPhoneNumber, clearTwilioCredentialsCache } from '../../../lib/twilio-client';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

export class TwilioSmsProvider implements SmsTransport {
  readonly id = 'twilio';
  readonly displayName = 'Twilio';
  readonly category = 'sms' as const;
  readonly supportedFeatures = ['sms', 'phone-validation', 'phone-lookup', 'delivery-status'];

  private settings: SmsProviderSettings = {};

  async configure(config: unknown): Promise<void> {
    if (config && typeof config === 'object') {
      this.settings = config as SmsProviderSettings;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      clearTwilioCredentialsCache();
      const client = await getTwilioClient();
      const accounts = await client.api.accounts.list({ limit: 1 });
      const account = accounts[0];

      if (!account) {
        return {
          success: false,
          error: 'No Twilio account found',
        };
      }

      return {
        success: true,
        message: `Connected to ${account.friendlyName}`,
        details: {
          accountSid: account.sid,
          accountName: account.friendlyName,
          status: account.status,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to connect to Twilio',
      };
    }
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    try {
      const client = await getTwilioClient();
      const accounts = await client.api.accounts.list({ limit: 1 });
      const account = accounts[0];

      let configuredPhoneNumber: string | undefined;
      try {
        configuredPhoneNumber = await getTwilioFromPhoneNumber();
      } catch {
        // Phone number not configured in env
      }

      return {
        connected: !!account,
        accountSid: account?.sid,
        accountName: account?.friendlyName,
        configuredPhoneNumber,
        defaultFromNumber: this.settings.defaultFromNumber || configuredPhoneNumber,
      };
    } catch (error: any) {
      return {
        connected: false,
        error: error?.message || 'Failed to get Twilio configuration',
      };
    }
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
        // Provide detailed error message before even calling Twilio
        const errorDetails = this.getValidationErrorDetails(parsed);
        return {
          valid: false,
          error: errorDetails,
        };
      }

      const e164 = parsed.format('E.164');

      try {
        const client = await getTwilioClient();
        const lookupResult = await client.lookups.v2.phoneNumbers(e164).fetch({
          fields: 'line_type_intelligence',
        });

        // Derive SMS and voice capabilities from line type
        const lineType = lookupResult.lineTypeIntelligence?.type?.toLowerCase();
        const smsPossible = lineType !== 'landline' && lineType !== 'unknown';
        const voicePossible = lineType !== 'unknown';

        return {
          valid: lookupResult.valid,
          formatted: lookupResult.phoneNumber,
          countryCode: lookupResult.countryCode,
          nationalNumber: parsed.formatNational(),
          type: lookupResult.lineTypeIntelligence?.type,
          carrier: lookupResult.lineTypeIntelligence?.carrierName,
          smsPossible,
          voicePossible,
        };
      } catch (twilioError: any) {
        if (twilioError?.code === 20404) {
          return {
            valid: false,
            error: 'Phone number not found in carrier database. The number may not exist or be disconnected.',
          };
        }
        // Fallback to local validation result on other Twilio errors
        return {
          valid: true,
          formatted: e164,
          countryCode: parsed.country,
          nationalNumber: parsed.nationalNumber,
        };
      }
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
    return true;
  }

  async sendSms(params: {
    to: string;
    body: string;
    from?: string;
    statusCallbackUrl?: string;
  }): Promise<SmsSendResult> {
    try {
      const client = await getTwilioClient();
      const fromNumber = params.from || await this.getDefaultFromNumber();

      if (!fromNumber) {
        return {
          success: false,
          error: 'No from phone number configured',
        };
      }

      const messageParams: any = {
        to: params.to,
        from: fromNumber,
        body: params.body,
      };

      if (params.statusCallbackUrl) {
        messageParams.statusCallback = params.statusCallbackUrl;
      }

      const message = await client.messages.create(messageParams);

      return {
        success: true,
        messageId: message.sid,
        status: message.status,
        details: {
          dateSent: message.dateSent,
          direction: message.direction,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to send SMS',
        details: {
          code: error?.code,
          moreInfo: error?.moreInfo,
        },
      };
    }
  }

  async getAvailablePhoneNumbers(): Promise<Array<{
    sid: string;
    phoneNumber: string;
    friendlyName: string;
    capabilities: { sms: boolean; voice: boolean; mms: boolean };
  }>> {
    const client = await getTwilioClient();
    const numbers = await client.incomingPhoneNumbers.list({ limit: 50 });

    return numbers.map((num) => ({
      sid: num.sid,
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName,
      capabilities: {
        sms: num.capabilities?.sms || false,
        voice: num.capabilities?.voice || false,
        mms: num.capabilities?.mms || false,
      },
    }));
  }

  async getDefaultFromNumber(): Promise<string | undefined> {
    if (this.settings.defaultFromNumber) {
      return this.settings.defaultFromNumber;
    }
    try {
      return await getTwilioFromPhoneNumber();
    } catch {
      return undefined;
    }
  }

  async setDefaultFromNumber(phoneNumber: string): Promise<void> {
    this.settings.defaultFromNumber = phoneNumber;
  }
}
