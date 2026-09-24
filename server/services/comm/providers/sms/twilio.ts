import type { ConnectionTestResult } from '../base';
import type { SmsTransport, PhoneValidationResult, SmsSendResult, SmsProviderSettings } from './index';
import { getTwilioClient, getTwilioFromPhoneNumber, clearTwilioCredentialsCache } from '../../../../lib/twilio-client';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { assertExternalServiceAllowed } from '../../../maintenance-flag';
import { registerUncachedWcRequest, wcUncachedRequest } from '../../../webclient';

/**
 * Twilio's uncached operations.
 *
 * The carrier lookup is not here: its answer IS worth keeping, so it is a
 * cached entry registered by the phone validator, and this provider's
 * `validatePhone` is the call that entry makes.
 *
 * A send needs a writable database and the read-only operations do not: a
 * message that goes out while nothing can be written down is a message the
 * comm record will never show, whereas refusing an operator a connection test
 * or a number list on a read-only connection takes away the diagnosis and
 * spends nothing.
 */
const SEND_SMS = 'send-sms';
const TEST_CONNECTION = 'test-connection';
const READ_CONFIGURATION = 'read-configuration';
const LIST_PHONE_NUMBERS = 'list-phone-numbers';

registerUncachedWcRequest({
  service: 'Twilio',
  requestType: SEND_SMS,
  operation: 'send SMS',
  needsWritableDatabase: true,
});
registerUncachedWcRequest({
  service: 'Twilio',
  requestType: TEST_CONNECTION,
  operation: 'test connection',
  needsWritableDatabase: false,
});
registerUncachedWcRequest({
  service: 'Twilio',
  requestType: READ_CONFIGURATION,
  operation: 'read account configuration',
  needsWritableDatabase: false,
});
registerUncachedWcRequest({
  service: 'Twilio',
  requestType: LIST_PHONE_NUMBERS,
  operation: 'list phone numbers',
  needsWritableDatabase: false,
});

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
    // The framework's refusal comes back out of here rather than becoming a
    // connection result: a maintenance refusal is not a failed connection.
    const { value, error } = await wcUncachedRequest<ConnectionTestResult>({
      service: 'Twilio',
      requestType: TEST_CONNECTION,
      fetch: async () => {
        try {
          clearTwilioCredentialsCache();
          const client = await getTwilioClient();
          const accounts = await client.api.accounts.list({ limit: 1 });
          const account = accounts[0];

          if (!account) {
            return { answered: true, value: { success: false, error: 'No Twilio account found' } };
          }

          return {
            answered: true,
            value: {
              success: true,
              message: `Connected to ${account.friendlyName}`,
              details: {
                accountSid: account.sid,
                accountName: account.friendlyName,
                status: account.status,
              },
            },
          };
        } catch (error: any) {
          return { answered: false, error: error?.message || 'Failed to connect to Twilio' };
        }
      },
    });

    return value ?? { success: false, error: error || 'Failed to connect to Twilio' };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    const { value, error } = await wcUncachedRequest<Record<string, unknown>>({
      service: 'Twilio',
      requestType: READ_CONFIGURATION,
      fetch: async () => {
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
            answered: true,
            value: {
              connected: !!account,
              accountSid: account?.sid,
              accountName: account?.friendlyName,
              configuredPhoneNumber,
              defaultFromNumber: this.settings.defaultFromNumber || configuredPhoneNumber,
            },
          };
        } catch (error: any) {
          return { answered: false, error: error?.message || 'Failed to get Twilio configuration' };
        }
      },
    });

    return value ?? { connected: false, error: error || 'Failed to get Twilio configuration' };
  }

  async validatePhone(phoneNumber: string): Promise<PhoneValidationResult> {
    // The carrier lookup below treats a Twilio error as "trust the local
    // parse" and returns valid:true. A maintenance refusal must not be read
    // that way, so it is raised before any of that runs.
    assertExternalServiceAllowed('Twilio', 'look up phone number');
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
    // Twilio's own error carries a code and a help link the send screen shows.
    // The framework hands back only the message, so the full shape is kept
    // here, where it is built.
    let failure: SmsSendResult | undefined;

    const { value, error } = await wcUncachedRequest<SmsSendResult>({
      service: 'Twilio',
      requestType: SEND_SMS,
      fetch: async () => {
        try {
          const client = await getTwilioClient();
          const fromNumber = params.from || await this.getDefaultFromNumber();

          if (!fromNumber) {
            // Our own refusal, not Twilio's: nothing was sent, so nothing
            // answered.
            return { answered: false, error: 'No from phone number configured' };
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
            answered: true,
            value: {
              success: true,
              messageId: message.sid,
              status: message.status,
              details: {
                dateSent: message.dateSent,
                direction: message.direction,
              },
            },
          };
        } catch (error: any) {
          failure = {
            success: false,
            error: error?.message || 'Failed to send SMS',
            details: {
              code: error?.code,
              moreInfo: error?.moreInfo,
            },
          };
          return { answered: false, error: failure.error };
        }
      },
    });

    return value ?? failure ?? { success: false, error: error || 'Failed to send SMS' };
  }

  async getAvailablePhoneNumbers(): Promise<Array<{
    sid: string;
    phoneNumber: string;
    friendlyName: string;
    capabilities: { sms: boolean; voice: boolean; mms: boolean };
  }>> {
    type AvailableNumber = {
      sid: string;
      phoneNumber: string;
      friendlyName: string;
      capabilities: { sms: boolean; voice: boolean; mms: boolean };
    };

    // This one has always thrown rather than answering with an empty list — an
    // empty list is a real answer ("this account has no numbers") and the
    // screen that asks shows it as one — so Twilio's own error is carried back
    // out as itself.
    let thrown: unknown;

    const { value, error } = await wcUncachedRequest<AvailableNumber[]>({
      service: 'Twilio',
      requestType: LIST_PHONE_NUMBERS,
      fetch: async () => {
        let numbers;
        try {
          const client = await getTwilioClient();
          numbers = await client.incomingPhoneNumbers.list({ limit: 50 });
        } catch (error: any) {
          thrown = error;
          return { answered: false, error: error?.message || 'Failed to list Twilio phone numbers' };
        }

        return {
          answered: true,
          value: numbers.map((num) => ({
            sid: num.sid,
            phoneNumber: num.phoneNumber,
            friendlyName: num.friendlyName,
            capabilities: {
              sms: num.capabilities?.sms || false,
              voice: num.capabilities?.voice || false,
              mms: num.capabilities?.mms || false,
            },
          })),
        };
      },
    });

    if (value) return value;
    if (thrown !== undefined) throw thrown;
    throw new Error(error || 'Failed to list Twilio phone numbers');
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
