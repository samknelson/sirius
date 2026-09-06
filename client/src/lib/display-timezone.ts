/**
 * The zone this browser DISPLAYS dates in, and the one place that redirects
 * the platform's own formatters to it.
 *
 * The server can set its zone with a single process setting; the browser has
 * no equivalent — the resolved zone is read-only and no API changes it. So the
 * client half is done by redirecting how dates are formatted rather than by
 * flipping a switch, and this module owns both halves of that:
 *
 *  - the CURRENT display zone, held as a module value and read at call time,
 *    so nothing has to be re-created or re-plumbed when it changes;
 *  - the redirection itself, installed once at the browser entry point.
 *
 * The redirection covers the built-in locale formatters — `Intl.DateTimeFormat`
 * and the `toLocale*String` date methods — which is roughly 150 call sites, none
 * of which need editing. It does NOT cover the date library's `format`, which
 * reads the raw local field getters instead of going through `Intl`; that half
 * is `@/lib/date-format`.
 *
 * ## What is deliberately NOT patched
 *
 * The raw field getters (`getHours`, `getMonth`, ...). Redirecting those would
 * change date ARITHMETIC as well as display, and the date library round-trips
 * through them internally, so its own `addDays`/`startOfDay` would start
 * returning wrong instants. This is the one approach that must not be taken.
 */

import { getRuntimeTimeZone, isValidTimeZone } from "@shared/utils/timezone";

/**
 * The browser's OWN zone, captured at module load — deliberately before
 * {@link installTimeZoneRedirection} can run, because afterwards
 * `getRuntimeTimeZone()` reports the redirected zone rather than the machine's.
 * Anything that needs to know where this person actually is (chiefly: what to
 * fall back to when they clear their personal zone) must read this.
 */
const browserTimeZone = getRuntimeTimeZone();

let displayTimeZone = browserTimeZone;

/** The zone this browser is actually configured for. Never changes. */
export function getBrowserTimeZone(): string {
  return browserTimeZone;
}

/** The zone dates are currently displayed in. Read at call time, never cached. */
export function getDisplayTimeZone(): string {
  return displayTimeZone;
}

/**
 * Point display at `zone`. Returns whether it actually moved, so the caller
 * can decide whether anything on screen needs re-rendering.
 *
 * An unusable name falls back to the browser's own zone rather than throwing:
 * a bad stored value must not take every date on the site down with it.
 */
export function setDisplayTimeZone(zone: string | null | undefined): boolean {
  const next = isValidTimeZone(zone) ? zone : browserTimeZone;
  if (next === displayTimeZone) return false;
  displayTimeZone = next;
  return true;
}

let installed = false;

/**
 * Redirect the built-in locale formatters at the display zone. Call once, at
 * the entry point, before anything renders.
 *
 * Two rules keep the blast radius small:
 *
 *  - a caller that named its own `timeZone` is left completely alone — an
 *    explicit choice is an explicit choice;
 *  - when the display zone already equals the browser's, nothing is injected
 *    at all. That is everyone who has not deliberately chosen a zone, so the
 *    common case renders byte-for-byte what it rendered before this existed.
 */
export function installTimeZoneRedirection(): void {
  if (installed) return;
  installed = true;

  const withDisplayZone = (
    options?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormatOptions | undefined => {
    if (options?.timeZone) return options;
    const zone = getDisplayTimeZone();
    if (zone === browserTimeZone) return options;
    return { ...options, timeZone: zone };
  };

  const NativeDateTimeFormat = Intl.DateTimeFormat;

  // Reuses the native prototype so `instanceof` and every instance method keep
  // working, and stays callable with and without `new`, as the real one is.
  function PatchedDateTimeFormat(
    this: unknown,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new NativeDateTimeFormat(locales, withDisplayZone(options));
  }
  PatchedDateTimeFormat.prototype = NativeDateTimeFormat.prototype;
  PatchedDateTimeFormat.supportedLocalesOf =
    NativeDateTimeFormat.supportedLocalesOf.bind(NativeDateTimeFormat);
  Intl.DateTimeFormat = PatchedDateTimeFormat as unknown as typeof Intl.DateTimeFormat;

  // The `toLocale*String` date methods do NOT route through the global
  // `Intl.DateTimeFormat` binding, so patching that one is not enough.
  // Injecting only `timeZone` leaves each method's default component set
  // (date+time, date, time respectively) exactly as it was.
  const nativeToLocaleString = Date.prototype.toLocaleString;
  const nativeToLocaleDateString = Date.prototype.toLocaleDateString;
  const nativeToLocaleTimeString = Date.prototype.toLocaleTimeString;

  Date.prototype.toLocaleString = function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return nativeToLocaleString.call(this, locales, withDisplayZone(options));
  };
  Date.prototype.toLocaleDateString = function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return nativeToLocaleDateString.call(this, locales, withDisplayZone(options));
  };
  Date.prototype.toLocaleTimeString = function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return nativeToLocaleTimeString.call(this, locales, withDisplayZone(options));
  };
}
