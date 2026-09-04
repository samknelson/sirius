import { serviceRegistry } from '../../service-registry';

/** Fallback when the setting is unset. A number does not change hands twice a year. */
export const DEFAULT_REVALIDATE_AFTER_DAYS = 180;

/** How long settings stay memoized. */
const SETTINGS_MEMO_MS = 60 * 1000;

export interface PhoneValidationSettings {
  defaultCountry?: string;
  strictValidation?: boolean;
  useLocalOnTwilioFailure?: boolean;
  logValidationAttempts?: boolean;
  revalidateAfterDays?: number;
}

/**
 * Settings, briefly memoized.
 *
 * Module-level rather than per-service-instance because two things now read
 * them: the validator, and the freshness window the web client framework
 * resolves for the Lookup request. Those must be the same answer — a
 * validator that thinks an entry is stale while the framework thinks it is
 * fresh would ask for a call the framework then refuses to make.
 *
 * `defaultCountry` decides how a bare national number parses, so it has to
 * apply in every mode — a local-only normalization that skipped it would key
 * the cache on a different E.164 than the lookup that filled it. Since a
 * normalization can happen per row in a loop, reading settings from the
 * database each time is what the memo avoids. The window is short because
 * nothing here is worth serving stale for long.
 */
let settingsMemo: { value: PhoneValidationSettings; expires: number } | undefined;

export async function getPhoneValidationSettings(): Promise<PhoneValidationSettings> {
  const memo = settingsMemo;
  if (memo && memo.expires > Date.now()) return memo.value;
  const value = await loadPhoneValidationSettings();
  settingsMemo = { value, expires: Date.now() + SETTINGS_MEMO_MS };
  return value;
}

/** Forget the memo. For tests, and for anything that changes the settings. */
export function resetPhoneValidationSettings(): void {
  settingsMemo = undefined;
}

/**
 * How old a stored validation may be before it is asked again, in days.
 * Configurable on the Twilio provider.
 */
export function revalidateAfterDays(settings: PhoneValidationSettings): number {
  const configured = Number(settings.revalidateAfterDays);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_REVALIDATE_AFTER_DAYS;
}

async function loadPhoneValidationSettings(): Promise<PhoneValidationSettings> {
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
      revalidateAfterDays: twilioValidation.revalidateAfterDays,
    };
  } catch {
    return {};
  }
}
