import { parsePhoneNumber, CountryCode, PhoneNumber } from 'libphonenumber-js';
import { serviceRegistry } from '../../service-registry';
import { phoneValidationCache } from '../../../storage/phone-validation-cache';
import { runOutsideTransaction } from '../../../storage/transaction-context';
import type { SmsTransport } from '../providers/sms';

/**
 * How hard a caller wants a number re-checked against the provider.
 *
 * - `never` — pure local parse. No network call AND no cache read. This is the
 *   mode for normalization: turning a number into E.164 to build a `WHERE`
 *   clause is not a question about whether the number is real. It is also what
 *   keeps the validator and the opt-in read from calling each other, since the
 *   cache lives on the opt-in row.
 * - `default` — return the stored answer unless it is older than the
 *   configured age (180 days by default).
 * - `always` — ask the provider regardless of how recent the stored answer is.
 */
export type PhoneRevalidateMode = 'never' | 'always' | 'default';

export interface PhoneValidationOptions {
  country?: CountryCode;
  revalidate?: PhoneRevalidateMode;
}

/** Fallback when the setting is unset. A number does not change hands twice a year. */
export const DEFAULT_REVALIDATE_AFTER_DAYS = 180;

/**
 * How long to leave a number alone after the provider failed to answer for it.
 *
 * A failure must not stamp the number as freshly validated — an outage would
 * otherwise buy six months of silence — but without a pause every read during
 * that outage becomes another attempt. Short and in-memory: this is a
 * back-off, not a record, and it must not itself become a write.
 */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

/** How long settings stay memoized. See {@link PhoneValidationService.settingsMemo}. */
const SETTINGS_MEMO_MS = 60 * 1000;

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

interface PhoneValidationSettings {
  defaultCountry?: string;
  strictValidation?: boolean;
  useLocalOnTwilioFailure?: boolean;
  logValidationAttempts?: boolean;
  revalidateAfterDays?: number;
}

export class PhoneValidationService {
  private defaultCountry: CountryCode = 'US';

  /** e164 → time the back-off expires. Deliberately in memory; see FAILURE_BACKOFF_MS. */
  private failureBackoff = new Map<string, number>();

  /**
   * Settings, briefly memoized.
   *
   * `defaultCountry` decides how a bare national number parses, so it has to
   * apply in every mode — a `never` normalization that skipped it would key
   * the cache on a different E.164 than the lookup that filled it. Since a
   * normalization can happen per row in a loop, reading settings from the
   * database each time is what the memo avoids. The window is short because
   * nothing here is worth serving stale for long.
   */
  private settingsMemo?: { value: PhoneValidationSettings; expires: number };

  constructor(defaultCountry: CountryCode = 'US') {
    this.defaultCountry = defaultCountry;
  }

  private async getValidationSettings(): Promise<PhoneValidationSettings> {
    const memo = this.settingsMemo;
    if (memo && memo.expires > Date.now()) return memo.value;
    const value = await this.loadValidationSettings();
    this.settingsMemo = { value, expires: Date.now() + SETTINGS_MEMO_MS };
    return value;
  }

  private async loadValidationSettings(): Promise<PhoneValidationSettings> {
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
        logValidationAttempts: twilioValidation.logValidationAttempts ?? true,
        revalidateAfterDays: twilioValidation.revalidateAfterDays
      };
    } catch {
      return {};
    }
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
   * immediately forgotten and would be spent again on the next call.
   */
  async validateAndFormat(
    phoneNumberInput: string,
    options?: PhoneValidationOptions,
  ): Promise<PhoneValidationResult> {
    const mode = options?.revalidate ?? 'default';

    let settings: PhoneValidationSettings = {};
    try {
      settings = await this.getValidationSettings();
    } catch {
      // Settings are advisory; their absence must not stop validation.
    }
    const country =
      options?.country || (settings.defaultCountry as CountryCode) || this.defaultCountry;

    const local = this.validateLocally(phoneNumberInput, country);

    // `never` is a pure local parse: no network, and no cache read either.
    // Reading the cache here would mean the opt-in read (which normalizes
    // through this function) and this function each waiting on the other.
    if (mode === 'never') return local;

    // A number that fails the local parse never reaches the provider, so it
    // never has a cached answer either. Retrying it costs nothing.
    if (!local.isValid || !local.e164Format) return local;

    let smsTransport: SmsTransport;
    try {
      smsTransport = await serviceRegistry.resolve<SmsTransport>('sms');
    } catch (error) {
      console.error('Failed to resolve SMS provider, using local validation:', error);
      return local;
    }

    // Only the Twilio provider makes a billable external call; the local
    // provider's validatePhone is the same libphonenumber parse we just did.
    if (smsTransport.id !== 'twilio') return local;

    const e164 = local.e164Format;
    const cached = await this.readCache(e164);

    if (mode === 'default') {
      if (this.isFresh(cached, settings)) return this.merge(local, cached);
      // Mid-outage: serve what we have rather than re-attempt on every read.
      if (this.inFailureBackoff(e164)) return this.merge(local, cached);
    }
    // `always` deliberately ignores the back-off as well as the age. It exists
    // for the one caller that is a person pressing "revalidate" because they
    // believe the stored answer is wrong; honouring the back-off there would
    // hand them the same stale answer while reporting a fresh check. A caller
    // that is not a person asking on purpose wants `default`.

    if (!(await phoneValidationCache.canStore())) {
      return this.merge(local, cached);
    }

    return this.validateWithProvider(smsTransport, local, e164, cached, settings);
  }

  private async validateWithProvider(
    smsTransport: SmsTransport,
    local: PhoneValidationResult,
    e164: string,
    cached: PhoneValidationResult | undefined,
    settings: PhoneValidationSettings,
  ): Promise<PhoneValidationResult> {
    let result: Awaited<ReturnType<SmsTransport['validatePhone']>>;
    try {
      result = await smsTransport.validatePhone(e164);
    } catch (error) {
      console.error('Provider validation failed:', error);
      return this.handleProviderFailure(local, e164, cached, settings, error);
    }

    // The provider swallows its own transport errors and answers with a
    // locally-derived result instead, which is indistinguishable from a real
    // Lookup except that it carries no line-type intelligence. Treating that
    // as an answer would stamp the number as freshly validated on the
    // strength of a call that never reached the carrier.
    if (result.valid && result.smsPossible === undefined) {
      return this.handleProviderFailure(local, e164, cached, settings, undefined);
    }

    const answer: PhoneValidationResult = {
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

    this.failureBackoff.delete(e164);

    // A "not in the carrier database" answer is not cached: the number is
    // rejected at the surface the caller is standing on, and caching it would
    // keep rejecting a number the carrier may activate tomorrow.
    if (answer.isValid) {
      try {
        await phoneValidationCache.write(e164, {
          validationResponse: answer,
          smsPossible: answer.smsPossible ?? null,
          voicePossible: answer.voicePossible ?? null,
        });
      } catch (error) {
        // The gate passed and the write still failed — the connection turned
        // read-only during the lookup, most likely because maintenance mode
        // was switched on mid-call. We have already paid for this answer and
        // cannot keep it, so back the number off rather than pay again on the
        // very next call for as long as the condition lasts.
        console.error('Paid for a phone lookup that could not be stored:', error);
        this.failureBackoff.set(e164, Date.now() + FAILURE_BACKOFF_MS);
      }
    }

    return answer;
  }

  private handleProviderFailure(
    local: PhoneValidationResult,
    e164: string,
    cached: PhoneValidationResult | undefined,
    settings: PhoneValidationSettings,
    error: unknown,
  ): PhoneValidationResult {
    this.failureBackoff.set(e164, Date.now() + FAILURE_BACKOFF_MS);

    if (cached) return this.merge(local, cached);
    if (settings.useLocalOnTwilioFailure ?? true) return local;
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Provider validation failed',
    };
  }

  private async readCache(e164: string): Promise<PhoneValidationResult | undefined> {
    try {
      const entry = await phoneValidationCache.read(e164);
      if (!entry?.validatedAt || !entry.validationResponse) return undefined;
      const stored = entry.validationResponse as PhoneValidationResult;
      if (typeof stored !== 'object' || stored === null) return undefined;
      return { ...stored, validatedAt: entry.validatedAt } as PhoneValidationResult & {
        validatedAt: Date;
      };
    } catch (error) {
      console.error('Failed to read stored phone validation:', error);
      return undefined;
    }
  }

  private isFresh(
    cached: PhoneValidationResult | undefined,
    settings: PhoneValidationSettings,
  ): boolean {
    const validatedAt = (cached as { validatedAt?: Date } | undefined)?.validatedAt;
    if (!validatedAt) return false;
    const days = this.revalidateAfterDays(settings);
    return Date.now() - new Date(validatedAt).getTime() < days * 24 * 60 * 60 * 1000;
  }

  private revalidateAfterDays(settings: PhoneValidationSettings): number {
    const configured = Number(settings.revalidateAfterDays);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_REVALIDATE_AFTER_DAYS;
  }

  private inFailureBackoff(e164: string): boolean {
    const until = this.failureBackoff.get(e164);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.failureBackoff.delete(e164);
    return false;
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
