import { parsePhoneNumber, CountryCode, PhoneNumber } from 'libphonenumber-js';
import { getTwilioClient } from '../lib/twilio-client';
import { storage } from '../storage';

export interface PhoneValidationConfig {
  mode: "local" | "twilio";
  local: {
    enabled: boolean;
    defaultCountry: string;
    strictValidation: boolean;
  };
  twilio: {
    enabled: boolean;
    lookupType: string[];
  };
  fallback: {
    useLocalOnTwilioFailure: boolean;
    logValidationAttempts: boolean;
  };
}

export interface PhoneValidationResult {
  isValid: boolean;
  e164Format?: string;
  nationalFormat?: string;
  internationalFormat?: string;
  country?: string;
  type?: string;
  error?: string;
  twilioData?: any;
}

export class PhoneValidationService {
  private defaultCountry: CountryCode = 'US';

  constructor(defaultCountry: CountryCode = 'US') {
    this.defaultCountry = defaultCountry;
  }

  async loadConfig(): Promise<PhoneValidationConfig> {
    const configVar = await storage.variables.getByName('phone_validation_config');
    if (configVar && configVar.value) {
      return configVar.value as PhoneValidationConfig;
    }

    return {
      mode: 'local',
      local: {
        enabled: true,
        defaultCountry: 'US',
        strictValidation: true
      },
      twilio: {
        enabled: false,
        lookupType: ['line_type_intelligence', 'caller_name']
      },
      fallback: {
        useLocalOnTwilioFailure: true,
        logValidationAttempts: true
      }
    };
  }

  async validateAndFormat(phoneNumberInput: string, country?: CountryCode): Promise<PhoneValidationResult> {
    const config = await this.loadConfig();

    if (config.mode === 'twilio' && config.twilio.enabled) {
      try {
        return await this.validateWithTwilio(phoneNumberInput, config);
      } catch (error) {
        console.error('Twilio validation failed:', error);
        if (config.fallback.useLocalOnTwilioFailure) {
          console.log('Falling back to local validation');
          return this.validateLocally(phoneNumberInput, country);
        }
        return {
          isValid: false,
          error: error instanceof Error ? error.message : 'Twilio validation failed'
        };
      }
    }

    return this.validateLocally(phoneNumberInput, country);
  }

  private async validateWithTwilio(phoneNumberInput: string, config: PhoneValidationConfig): Promise<PhoneValidationResult> {
    const twilioClient = await getTwilioClient();
    
    const parsed = parsePhoneNumber(phoneNumberInput, this.defaultCountry);
    if (!parsed || !parsed.isValid()) {
      return {
        isValid: false,
        error: 'Invalid phone number format'
      };
    }

    const e164Number = parsed.format('E.164');

    const fields = config.twilio.lookupType.join(',');
    const phoneNumberLookup = await twilioClient.lookups.v2
      .phoneNumbers(e164Number)
      .fetch({ fields });

    return {
      isValid: true,
      e164Format: phoneNumberLookup.phoneNumber,
      nationalFormat: parsed.formatNational(),
      internationalFormat: parsed.formatInternational(),
      country: phoneNumberLookup.countryCode,
      type: phoneNumberLookup.lineTypeIntelligence?.type || parsed.getType(),
      twilioData: phoneNumberLookup
    };
  }

  private validateLocally(phoneNumberInput: string, country?: CountryCode): PhoneValidationResult {
    try {
      const countryCode = country || this.defaultCountry;
      
      const phoneNumber: PhoneNumber = parsePhoneNumber(phoneNumberInput, countryCode);
      
      if (!phoneNumber) {
        return {
          isValid: false,
          error: 'Invalid phone number format'
        };
      }

      if (!phoneNumber.isValid()) {
        return {
          isValid: false,
          error: 'Phone number is not valid for the given country'
        };
      }

      return {
        isValid: true,
        e164Format: phoneNumber.format('E.164'),
        nationalFormat: phoneNumber.formatNational(),
        internationalFormat: phoneNumber.formatInternational(),
        country: phoneNumber.country,
        type: phoneNumber.getType()
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Failed to parse phone number'
      };
    }
  }

  formatForDisplay(e164PhoneNumber: string): string {
    try {
      const phoneNumber = parsePhoneNumber(e164PhoneNumber);
      
      if (!phoneNumber) {
        return e164PhoneNumber;
      }

      if (phoneNumber.country === 'US') {
        return phoneNumber.formatNational();
      }

      return phoneNumber.formatInternational();
    } catch (error) {
      return e164PhoneNumber;
    }
  }
}

export const phoneValidationService = new PhoneValidationService('US');
