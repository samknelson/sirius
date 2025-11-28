import { parsePhoneNumber, CountryCode, PhoneNumber } from 'libphonenumber-js';
import { serviceRegistry } from './service-registry';
import type { SmsTransport } from './providers/sms';

export interface PhoneValidationResult {
  isValid: boolean;
  e164Format?: string;
  nationalFormat?: string;
  internationalFormat?: string;
  country?: string;
  type?: string;
  error?: string;
  twilioData?: any;
  smsPossible?: boolean;
  voicePossible?: boolean;
}

interface PhoneValidationSettings {
  defaultCountry?: string;
  strictValidation?: boolean;
  useLocalOnTwilioFailure?: boolean;
  logValidationAttempts?: boolean;
}

export class PhoneValidationService {
  private defaultCountry: CountryCode = 'US';

  constructor(defaultCountry: CountryCode = 'US') {
    this.defaultCountry = defaultCountry;
  }

  private async getValidationSettings(): Promise<PhoneValidationSettings> {
    try {
      // Always read local settings (defaultCountry, strictValidation) from local provider
      // These are provider-agnostic and apply regardless of which SMS provider is active
      const localSettings = await serviceRegistry.getProviderSettings('sms', 'local');
      const localValidation = (localSettings as any)?.phoneValidation || {};
      
      // Read fallback settings from twilio provider (since they control Twilio failure behavior)
      const twilioSettings = await serviceRegistry.getProviderSettings('sms', 'twilio');
      const twilioValidation = (twilioSettings as any)?.phoneValidation || {};
      
      return {
        defaultCountry: localValidation.defaultCountry || 'US',
        strictValidation: localValidation.strictValidation ?? true,
        useLocalOnTwilioFailure: twilioValidation.useLocalOnTwilioFailure ?? true,
        logValidationAttempts: twilioValidation.logValidationAttempts ?? true
      };
    } catch {
      return {};
    }
  }

  async validateAndFormat(phoneNumberInput: string, country?: CountryCode): Promise<PhoneValidationResult> {
    try {
      const settings = await this.getValidationSettings();
      const defaultCountry = (settings.defaultCountry as CountryCode) || this.defaultCountry;
      const useLocalOnFailure = settings.useLocalOnTwilioFailure ?? true;
      
      const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
      
      if (smsTransport.id === 'twilio') {
        try {
          return await this.validateWithProvider(phoneNumberInput, defaultCountry);
        } catch (error) {
          console.error('Provider validation failed, falling back to local:', error);
          if (useLocalOnFailure) {
            return this.validateLocally(phoneNumberInput, country || defaultCountry);
          }
          return {
            isValid: false,
            error: error instanceof Error ? error.message : 'Provider validation failed'
          };
        }
      }
      
      return this.validateLocally(phoneNumberInput, country || defaultCountry);
    } catch (error) {
      console.error('Failed to resolve SMS provider, using local validation:', error);
      return this.validateLocally(phoneNumberInput, country);
    }
  }

  private async validateWithProvider(phoneNumberInput: string, country: CountryCode = 'US'): Promise<PhoneValidationResult> {
    const parsed = parsePhoneNumber(phoneNumberInput, country);
    if (!parsed || !parsed.isValid()) {
      return {
        isValid: false,
        error: 'Invalid phone number format'
      };
    }

    try {
      const smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
      const result = await smsTransport.validatePhone(phoneNumberInput);
      
      return {
        isValid: result.valid,
        e164Format: result.formatted,
        nationalFormat: parsed.formatNational(),
        internationalFormat: parsed.formatInternational(),
        country: result.countryCode,
        type: result.type || parsed.getType(),
        smsPossible: result.smsPossible,
        voicePossible: result.voicePossible,
        twilioData: {
          carrier: result.carrier,
        }
      };
    } catch (error) {
      return {
        isValid: true,
        e164Format: parsed.format('E.164'),
        nationalFormat: parsed.formatNational(),
        internationalFormat: parsed.formatInternational(),
        country: parsed.country,
        type: parsed.getType(),
      };
    }
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
        // Provide more detailed error messages based on what we can determine
        const errorDetails = this.getValidationErrorDetails(phoneNumber, countryCode);
        return {
          isValid: false,
          error: errorDetails
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

  private getValidationErrorDetails(phoneNumber: PhoneNumber, countryCode: CountryCode): string {
    const nationalNumber = phoneNumber.nationalNumber;
    const isPossible = phoneNumber.isPossible();
    const detectedCountry = phoneNumber.country;
    
    // For US/NANP numbers, check specific issues
    if (countryCode === 'US' || detectedCountry === 'US') {
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
        return `Phone number ${phoneNumber.formatNational()} is not a valid US phone number. The number pattern is not allocated or does not exist.`;
      }
    }
    
    // Check if it's a length issue
    if (!isPossible) {
      return `Phone number has incorrect length for ${countryCode} format.`;
    }
    
    // Generic message for other cases
    if (detectedCountry && detectedCountry !== countryCode) {
      return `Phone number appears to be from ${detectedCountry}, not ${countryCode}. Please verify the country code.`;
    }
    
    return `Phone number is not valid for ${countryCode}. The number pattern may not be allocated or does not exist.`;
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
