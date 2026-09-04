/**
 * Time zones — the one shared vocabulary for both halves of the app.
 *
 * There are exactly two zones in this system:
 *
 *  - the SYSTEM zone: the zone the server process runs in (the TZ variable).
 *    Every naive `timestamp` column stores a wall clock reading in this zone,
 *    cron schedules are interpreted in it, and "today" ends at midnight in it.
 *  - the USER zone: the zone a given person is shown dates in. Purely a
 *    display concern — it never affects what is stored.
 *
 * This module is a PURE LEAF: the browser imports it, so it must not reach the
 * database, the environment registry, or any server module. It holds zone
 * validation, the selectable list, the single resolver that decides which zone
 * a person sees, and zone-aware formatting.
 *
 * Everything here is built on `Intl`, which carries the full IANA database in
 * both Node and the browser, so the two sides cannot disagree about what a
 * zone name means.
 */

import { z } from "zod";

/** Site-wide policy for personal time zones, stored as one settings row. */
export interface TimeZonePolicy {
  /**
   * When false, everyone sees site time and a personal zone is ignored
   * (not merely hidden — the resolver below refuses to honour it).
   *
   * Defaults to FALSE when the settings row is absent. A site that has not
   * been configured shows ONE clock to everyone: two people reading the same
   * screen read the same times, and a date quoted between them means the same
   * thing without either having to say where they are. Personal zones are a
   * deliberate per-site choice, not something a site acquires by default.
   *
   * It is also the direction every unknown should fail in. An absent row, a
   * malformed one, a client that has not loaded its auth payload yet — all of
   * them land on site time, which is the answer that is at worst unhelpful
   * rather than the one that is silently personal to whoever is looking.
   *
   * The cost, accepted knowingly: on an installation that has not set `TZ`
   * either, site time is whatever zone the server process happened to start
   * in. The time-zone settings screen shows that zone and links to where it is
   * edited, which is how an administrator finds out.
   */
  allowUserTimezones: boolean;
}

export const DEFAULT_TIMEZONE_POLICY: TimeZonePolicy = {
  allowUserTimezones: false,
};

/** The settings row that stores {@link TimeZonePolicy}. */
export const TIMEZONE_POLICY_VARIABLE_NAME = "timezone_settings";

export const timeZonePolicySchema = z.object({
  allowUserTimezones: z.boolean(),
});

/**
 * Read a stored policy value, falling back to the default for anything
 * unusable. A missing or malformed settings row must not break every date on
 * the site, and the default is the restrictive answer, so a corrupted row
 * cannot hand out personal zones nobody configured.
 */
export function parseTimeZonePolicy(value: unknown): TimeZonePolicy {
  const parsed = timeZonePolicySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TIMEZONE_POLICY;
}

/**
 * A person's own zone as submitted: an IANA name, or null to clear it.
 *
 * Blank strings become null rather than being stored, so "no choice" has ONE
 * representation in the column and the resolver never has to treat "" as a
 * third state.
 */
export const userTimeZoneInputSchema = z
  .union([z.string(), z.null()])
  .transform((v) => {
    const trimmed = typeof v === "string" ? v.trim() : "";
    return trimmed === "" ? null : trimmed;
  })
  .refine((v) => v === null || isValidTimeZone(v), {
    message: "Not a time zone this runtime recognises (expected an IANA name such as America/New_York)",
  });

/**
 * Whether `name` is a time zone this runtime understands.
 *
 * Deliberately a constructor probe rather than a membership test against
 * {@link listSelectableTimeZones}: that list holds only the canonical zone
 * names, while `Intl` also accepts the many legacy aliases ("US/Eastern",
 * "Asia/Calcutta") that a hand-set environment variable is quite likely to
 * carry. Rejecting a zone the runtime would have honoured is the worse error.
 */
export function isValidTimeZone(name: unknown): name is string {
  if (typeof name !== "string" || name.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical IANA zone names, for offering a choice. Sorted.
 *
 * Note this is the list to CHOOSE from, not the list of what is ACCEPTED —
 * see {@link isValidTimeZone}.
 */
export function listSelectableTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported !== "function") return [];
  try {
    return supported.call(Intl, "timeZone").slice().sort();
  } catch {
    return [];
  }
}

/** The zone this runtime is actually running in, whatever set it. */
export function getRuntimeTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export interface EffectiveTimeZoneInput {
  /** The server's zone, as reported by the server. */
  systemTimeZone: string | null | undefined;
  /** The person's own recorded zone, or null when they have not chosen one. */
  userTimeZone: string | null | undefined;
  /** Site policy. Absent means {@link DEFAULT_TIMEZONE_POLICY}. */
  allowUserTimezones: boolean;
  /**
   * The zone the viewing runtime reports for itself — the browser's zone on
   * the client. Used as the stand-in for "this person's own zone" when they
   * have not chosen one explicitly.
   */
  runtimeTimeZone?: string;
}

/**
 * THE resolver. Decides which zone a person should be shown dates in.
 *
 * Site policy wins outright: when personal zones are not allowed, a stored
 * personal zone is ignored rather than merely un-editable, so turning the
 * policy off actually changes what people see instead of leaving previously
 * saved choices quietly in force.
 *
 * When personal zones ARE allowed and the person has not chosen one, the
 * answer is their runtime's own zone — the best available evidence of where
 * they are, and identical to what they see today.
 */
export function resolveEffectiveTimeZone(input: EffectiveTimeZoneInput): string {
  const runtime = input.runtimeTimeZone ?? getRuntimeTimeZone();
  const system = isValidTimeZone(input.systemTimeZone) ? input.systemTimeZone : runtime;

  if (!input.allowUserTimezones) return system;
  if (isValidTimeZone(input.userTimeZone)) return input.userTimeZone;
  return runtime;
}

/**
 * Format an instant in a named zone. Falls back to the runtime's own zone
 * when the name is unusable, because a display surface must render something
 * rather than throw.
 */
export function formatInTimeZone(
  date: Date | string | number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
  locale?: string,
): string {
  const instant = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(instant.getTime())) return "";
  const zone = isValidTimeZone(timeZone) ? timeZone : getRuntimeTimeZone();
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(instant);
}

/**
 * The short offset label for a zone at a given instant, e.g. "GMT-4".
 *
 * Takes an instant because the answer changes across a DST boundary — a label
 * computed once and cached would be wrong for half the year.
 */
export function getTimeZoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : getRuntimeTimeZone();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * The offset of `timeZone` from UTC at `at`, in minutes (east of UTC is
 * positive, matching the sign convention of an ISO offset and the OPPOSITE of
 * `Date.prototype.getTimezoneOffset`).
 *
 * Derived by asking `Intl` for the zone's wall-clock fields and diffing them
 * against the same instant's UTC fields, which is the only way to get this
 * for an arbitrary named zone.
 */
export function getTimeZoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : getRuntimeTimeZone();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // formatToParts renders midnight as hour 24 under hour12:false in some
  // runtimes; normalize so the arithmetic below stays on the right day.
  const hour = field("hour") % 24;
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );
  // Both sides are whole seconds; drop the instant's milliseconds so the
  // difference is a clean offset rather than offset-minus-a-fraction.
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}
