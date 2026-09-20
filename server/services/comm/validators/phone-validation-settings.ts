
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
    const { storage } = await import("../../../storage");
    const [local, twilio] = await Promise.all([
      storage.pluginConfigs.getByKindAndPlugin("wc-vendors", "sms-local"),
      storage.pluginConfigs.getByKindAndPlugin("wc-vendors", "twilio"),
    ]);
    // Settings are not a provider selection. When more than one row exists,
    // prefer the row assigned to phone validation, then use stable config
    // ordering rather than whichever row the database happened to return.
    const selectSettingsRow = <T extends {
      id: string;
      enabled: boolean;
      ordering: number;
      data?: unknown;
    }>(rows: T[]): T | undefined => {
      const assigned = rows.filter((row) => {
        const data =
          row.data && typeof row.data === "object"
            ? (row.data as Record<string, unknown>)
            : {};
        return Array.isArray(data.operations) &&
          data.operations.includes("communications.phone.validate");
      });
      const candidates = assigned.length > 0 ? assigned : rows;
      return [...candidates].sort(
        (a, b) =>
          Number(b.enabled) - Number(a.enabled) ||
          a.ordering - b.ordering ||
          a.id.localeCompare(b.id),
      )[0];
    };
    const localRow = selectSettingsRow(local);
    const twilioRow = selectSettingsRow(twilio);
    // Keep both sets of settings available even when the other vendor is
    // assigned. The local parser still owns default-country behavior and the
    // Twilio row still owns revalidation/fallback policy after a provider
    // switch.
    const localData = localRow?.data;
    const twilioData = twilioRow?.data;
    const localValidation =
      localData && typeof localData === "object"
        ? ((localData as Record<string, unknown>).phoneValidation as Record<string, unknown> | undefined) ?? {}
        : {};
    const twilioValidation =
      twilioData && typeof twilioData === "object"
        ? ((twilioData as Record<string, unknown>).phoneValidation as Record<string, unknown> | undefined) ?? {}
        : {};

    return {
      defaultCountry:
        typeof localValidation.defaultCountry === "string"
          ? localValidation.defaultCountry
          : "US",
      strictValidation:
        typeof localValidation.strictValidation === "boolean"
          ? localValidation.strictValidation
          : true,
      useLocalOnTwilioFailure:
        typeof twilioValidation.useLocalOnTwilioFailure === "boolean"
          ? twilioValidation.useLocalOnTwilioFailure
          : true,
      logValidationAttempts:
        typeof twilioValidation.logValidationAttempts === "boolean"
          ? twilioValidation.logValidationAttempts
          : true,
      revalidateAfterDays:
        typeof twilioValidation.revalidateAfterDays === "number"
          ? twilioValidation.revalidateAfterDays
          : undefined,
    };
  } catch {
    return {};
  }
}
