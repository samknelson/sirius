import { parsePhoneNumber, CountryCode, PhoneNumber } from 'libphonenumber-js';
import { phoneOptinValidation } from '../../../storage/phone-optin-validation';
import { runOutsideTransaction } from '../../../storage/transaction-context';
import { wcRequest, type WcRequestMode, type WcResult } from '../../webclient';
import { isMaintenanceModeError } from '../../maintenance-flag';
import {
  DEFAULT_REVALIDATE_AFTER_DAYS,
  getPhoneValidationSettings,
  type PhoneValidationSettings,
} from './phone-validation-settings';
import type { SmsValidatePhoneResult } from "../../../plugins/wc-vendors/sms-types";

export { DEFAULT_REVALIDATE_AFTER_DAYS };

/**
 * How hard a caller wants a number re-checked against the provider.
 *
 * - `never` — pure local parse. No network call AND no cache read. This is the
 *   mode for normalization: turning a number into E.164 to build a `WHERE`
 *   clause is not a question about whether the number is real, and every row
 *   of a list view takes this path.
 * - `default` — return the stored answer unless it is older than the
 *   configured age (180 days by default).
 * - `always` — ask the provider regardless of how recent the stored answer is.
 */
export type PhoneRevalidateMode = 'never' | 'always' | 'default';

export interface PhoneValidationOptions {
  country?: CountryCode;
  revalidate?: PhoneRevalidateMode;
}

/** The caller's intent, in the web client framework's own vocabulary. */
const WC_MODE_BY_REVALIDATE: Record<PhoneRevalidateMode, WcRequestMode> = {
  never: 'local',
  default: 'default',
  always: 'force',
};

/** Cap on numbers waiting for an out-of-band refresh, so a big list cannot pile up unboundedly. */
const MAX_QUEUED_REVALIDATIONS = 500;

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

export class PhoneValidationService {
  private defaultCountry: CountryCode = 'US';

  constructor(defaultCountry: CountryCode = 'US') {
    this.defaultCountry = defaultCountry;
  }

  /**
   * The single entry point for validating and formatting a phone number, and
   * the only route to E.164 anywhere in the app.
   *
   * Because it is the only route to E.164 it is called constantly by paths
   * with no interest in whether the number is real, so by default it answers
   * from the stored validation and only reaches the provider when that answer
   * is missing or stale. See {@link PhoneRevalidateMode} for the three modes.
   *
   * The overriding rule: **it never calls the provider unless the result can
   * be stored.** An unstored lookup is money spent to learn something that is
   * immediately forgotten and would be spent again on the next call. That
   * rule, the freshness window, and the pause after a failure are all applied
   * by the web client framework; this method's job is to say what a Twilio
   * Lookup means once one has been made.
   */
  async validateAndFormat(
    phoneNumberInput: string,
    options?: PhoneValidationOptions,
  ): Promise<PhoneValidationResult> {
    const mode = options?.revalidate ?? 'default';

    let settings: PhoneValidationSettings = {};
    try {
      settings = await getPhoneValidationSettings();
    } catch {
      // Settings are advisory; their absence must not stop validation.
    }
    const country =
      options?.country || (settings.defaultCountry as CountryCode) || this.defaultCountry;

    const local = this.validateLocally(phoneNumberInput, country);
    const wcMode = WC_MODE_BY_REVALIDATE[mode];

    // `never` is a pure local parse, and the framework's local mode is what
    // makes it one: no network, and no cache read either.
    if (wcMode === 'local') return local;

    // A number that fails the local parse never reaches the provider, so it
    // never has a cached answer either. Retrying it costs nothing.
    if (!local.isValid || !local.e164Format) return local;

    const { hasWcVendorOperation } = await import("../../webclient/wc-vendor-context");
    if (!(await hasWcVendorOperation("communications.phone.validate"))) return local;

    const e164 = local.e164Format;
    // `always` asks the provider regardless of how recent the stored answer
    // is, and regardless of a failure pause. It exists for the one caller that
    // is a person pressing "revalidate" because they believe the stored answer
    // is wrong; honouring the pause there would hand them the same stale
    // answer while reporting a fresh check. A caller that is not a person
    // asking on purpose wants `default`.
    let result: WcResult<SmsValidatePhoneResult>;
    try {
      result = await wcRequest({
        vendor: { any: true },
        operation: "communications.phone.validate",
        args: { phoneNumber: e164 },
        mode: wcMode,
      });
    } catch (error) {
      if (!isMaintenanceModeError(error)) throw error;
      // The vendor is off limits, but what we already know still stands.
      result = await wcRequest({
        vendor: { any: true },
        operation: "communications.phone.validate",
        args: { phoneNumber: e164 },
        mode: 'cached-only',
      });
    }

    if (result.outcome === 'success' && result.value) {
      const answer = this.mergeVendor(local, result.value);
      // The derived possibility flags live on the opt-in row, and are written
      // as the cache fills — not on every read of an answer already stored.
      if (result.source === 'network' && answer.isValid) {
        await this.writeOptinValidation(e164, answer);
      }
      return answer;
    }

    // No answer: either the provider did not give one, or nothing was asked.
    if (result.outcome === 'failure' && !(settings.useLocalOnTwilioFailure ?? true)) {
      return { isValid: false, error: result.error || 'Provider validation failed' };
    }
    return local;
  }

  private mergeVendor(
    local: PhoneValidationResult,
    result: SmsValidatePhoneResult,
  ): PhoneValidationResult {
    return {
      isValid: result.valid,
      // Always our own normalization, never the provider's: the opt-in row is
      // keyed by this string, so any drift splits one number across two rows.
      e164Format: local.e164Format,
      nationalFormat: local.nationalFormat,
      internationalFormat: local.internationalFormat,
      country: result.countryCode || local.country,
      type: result.type || local.type,
      smsPossible: result.smsPossible,
      voicePossible: result.voicePossible,
      error: result.valid ? undefined : result.error,
      twilioData: {
        carrier: result.carrier,
      },
    };
  }

  private async writeOptinValidation(
    e164: string,
    answer: PhoneValidationResult,
  ): Promise<void> {
    try {
      await phoneOptinValidation.write(e164, {
        validationResponse: answer,
        smsPossible: answer.smsPossible ?? null,
        voicePossible: answer.voicePossible ?? null,
      });
    } catch (error) {
      // The answer itself is already in the cache, so nothing will be bought
      // again; only the derived flags are missing.
      console.error('Failed to record phone validation on the opt-in row:', error);
    }
  }

  /**
   * The stored answer, re-formatted locally. The provider decided whether the
   * number is real and what it can receive; the formats always come from the
   * parse we just did, so a stored value can never drift the key.
   */
  private merge(
    local: PhoneValidationResult,
    cached: PhoneValidationResult | undefined,
  ): PhoneValidationResult {
    if (!cached) return local;
    return {
      ...cached,
      isValid: local.isValid && cached.isValid,
      e164Format: local.e164Format,
      nationalFormat: local.nationalFormat,
      internationalFormat: local.internationalFormat,
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

/**
 * Numbers waiting to be validated out of band, and the drain that works
 * through them one at a time.
 */
const revalidationQueue: string[] = [];
const revalidationQueued = new Set<string>();
let revalidationDraining = false;

/**
 * Validate these numbers soon, off the request's critical path.
 *
 * A read that finds a stale entry must not make the request wait on the
 * provider: after a bulk import, opening a list view would otherwise mean
 * hundreds of sequential external calls inside one page load. The read serves
 * what is stored and leaves the number here instead.
 *
 * The refresh is a separate operation on its own connection, so it faces the
 * "can the result be stored" gate on its own merits. It is not a way to
 * perform, on a read-only caller's behalf, the write that caller was
 * forbidden — such callers ask for `never` and queue nothing.
 */
export function schedulePhoneRevalidation(phoneNumbers: string | string[]): void {
  const numbers = Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers];
  for (const phoneNumber of numbers) {
    if (!phoneNumber) continue;
    if (revalidationQueued.has(phoneNumber)) continue;
    if (revalidationQueue.length >= MAX_QUEUED_REVALIDATIONS) break;
    revalidationQueued.add(phoneNumber);
    revalidationQueue.push(phoneNumber);
  }

  if (revalidationDraining || revalidationQueue.length === 0) return;
  revalidationDraining = true;
  // The async context of whoever scheduled this propagates into the callback,
  // so the drain must step out of it explicitly — otherwise it would reach for
  // a transaction that has already committed, or one that is read-only.
  setImmediate(() => runOutsideTransaction(() => void drainRevalidationQueue()));
}

async function drainRevalidationQueue(): Promise<void> {
  try {
    while (revalidationQueue.length > 0) {
      const phoneNumber = revalidationQueue.shift()!;
      revalidationQueued.delete(phoneNumber);
      try {
        await phoneValidationService.validateAndFormat(phoneNumber, { revalidate: 'default' });
      } catch (error) {
        console.error('Background phone revalidation failed:', error);
      }
    }
  } finally {
    revalidationDraining = false;
  }
}
