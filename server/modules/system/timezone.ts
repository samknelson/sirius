/**
 * Server-side reads of the time-zone settings.
 *
 * Thin on purpose: the decision itself lives in `shared/utils/timezone.ts` so
 * that the server and the browser cannot drift apart about which zone a person
 * should be shown. This module only fetches the stored policy and assembles
 * the answer the API publishes.
 */
import { storage } from "../../storage";
import {
  DEFAULT_TIMEZONE_POLICY,
  TIMEZONE_POLICY_VARIABLE_NAME,
  parseTimeZonePolicy,
  type TimeZonePolicy,
} from "@shared/utils/timezone";
import { getSystemTimeZone } from "../../config/system-timezone";

/**
 * The site's personal-zone policy. Falls back to the default when the row is
 * absent or malformed — a missing settings row must not break every date on
 * the site.
 */
export async function getTimeZonePolicy(): Promise<TimeZonePolicy> {
  try {
    const variable = await storage.variables.getByName(TIMEZONE_POLICY_VARIABLE_NAME);
    if (!variable) return DEFAULT_TIMEZONE_POLICY;
    return parseTimeZonePolicy(variable.value);
  } catch {
    return DEFAULT_TIMEZONE_POLICY;
  }
}

/** What the API publishes so a client can resolve which zone to display in. */
export interface TimeZoneContext {
  /** The zone the server runs in — what every stored timestamp means. */
  systemTimeZone: string;
  /** This person's own recorded zone, or null when they have not chosen one. */
  userTimeZone: string | null;
  /** Whether site policy honours a personal zone at all. */
  allowUserTimezones: boolean;
}

export async function buildTimeZoneContext(
  userTimeZone: string | null | undefined,
): Promise<TimeZoneContext> {
  const policy = await getTimeZonePolicy();
  return {
    systemTimeZone: getSystemTimeZone(),
    userTimeZone: userTimeZone ?? null,
    allowUserTimezones: policy.allowUserTimezones,
  };
}
