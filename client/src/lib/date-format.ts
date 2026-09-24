/**
 * Date formatting for the browser — the project's stand-in for the date
 * library's own formatters.
 *
 * `date-fns` `format` reads a Date's RAW LOCAL FIELD GETTERS rather than going
 * through `Intl`, so it cannot be redirected at the platform level the way the
 * built-in locale formatters are (see `@/lib/display-timezone`). The installed
 * version has no zone support of its own, so this module supplies it — by
 * handing the library a Date whose field getters answer for the display zone
 * (see {@link zonedDateClassFor}). The library then formats it exactly as it
 * always has, so every format string, locale and token behaves the same.
 *
 * Every browser file formats dates through here. An architecture rule
 * (`date-formatting`) enforces that, so a new screen is zone-aware by default
 * rather than by memory.
 *
 * ## Two functions, and the choice between them matters
 *
 * {@link format} reinterprets an INSTANT in the display zone. {@link
 * formatLocalFields} does not reinterpret anything. A value gets the second
 * one when it is not really an instant, or when what is printed is going to be
 * read back:
 *
 *  - a CALENDAR DATE (`2026-01-15`, usually via `new Date(ymd + "T00:00:00")`)
 *    names a day, not a moment. There is no instant to reinterpret, and
 *    shifting it can move it across midnight into the wrong day. Better still,
 *    keep it a `Ymd` and use `formatYmd` from `@shared/utils/date`, which has
 *    no Date in it at all.
 *  - a value written into a `date` or `datetime-local` input is parsed back by
 *    the browser in the BROWSER's zone. Print it in another zone and the
 *    instant silently changes the moment someone saves the form — the worst
 *    kind of failure here, because the number on screen looks right.
 *
 * ## What this does not do
 *
 * Arithmetic (`addDays`, `startOfDay`, `differenceIn*`) and parsing stay on the
 * library directly, on ordinary Dates. Those operate on an instant and are
 * zone-independent; running them through the display zone would be a different
 * feature, and a wrong one for values on their way into an input.
 */

import {
  format as formatDateFns,
  formatDistanceToNow as formatDistanceToNowInternal,
} from "date-fns";
import { getTimeZoneOffsetMinutes } from "@shared/utils/timezone";
import { getBrowserTimeZone, getDisplayTimeZone } from "./display-timezone";

type DateInput = Date | number | string;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function toInstant(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The wall clock `zone` is showing at `instant`. */
function wallClockIn(instant: Date, zone: string): WallClock {
  // An explicit `timeZone` here, so the global redirection installed by
  // `@/lib/display-timezone` leaves this call alone — it only fills one in
  // when the caller named none.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    // Some runtimes render midnight as hour 24 under hour12:false.
    hour: field("hour") % 24,
    minute: field("minute"),
    second: field("second"),
  };
}

/**
 * The instant at which `zone` shows this wall clock.
 *
 * Read the fields as though they were UTC, then step back by the zone's offset.
 * The offset has to be looked up at an instant, and the only instant available
 * to look it up at is the approximate one, so it is checked a second time from
 * where the first answer landed — that second pass is what gets a wall clock
 * near a transition onto the right side of it.
 *
 * A wall clock in a zone's spring-forward gap does not exist, and one in its
 * fall-back hour exists twice. Both settle on a real instant here rather than
 * failing; which side of an ambiguous hour is arbitrary, exactly as it is for
 * the platform's own `new Date(y, m, d, h)`.
 */
function instantFromWallClock(wall: WallClock, milliseconds: number, zone: string): number {
  let asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    milliseconds,
  );
  // Date.UTC reads years 0-99 as 1900-1999.
  if (wall.year >= 0 && wall.year < 100) {
    const corrected = new Date(asUtc);
    corrected.setUTCFullYear(wall.year);
    asUtc = corrected.getTime();
  }
  if (Number.isNaN(asUtc)) return NaN;

  const firstOffset = getTimeZoneOffsetMinutes(zone, new Date(asUtc));
  const firstGuess = asUtc - firstOffset * 60_000;
  const secondOffset = getTimeZoneOffsetMinutes(zone, new Date(firstGuess));
  return secondOffset === firstOffset ? firstGuess : asUtc - secondOffset * 60_000;
}

const zonedDateClasses = new Map<string, typeof Date>();

/**
 * A `Date` subclass, one per zone, whose LOCAL field getters answer for that
 * zone while its time value stays the true instant.
 *
 * This is the whole mechanism, and the reason it is a subclass rather than a
 * shifted timestamp: a shifted timestamp has to be a real instant, and the
 * wall clock being displayed is not always one. There is no instant whose
 * BROWSER-local fields read 02:30 on a day the browser's own zone jumps from
 * 02:00 to 03:00 — so a viewer in New York reading a UTC timestamp in that
 * hour could not be shown the right time at all. Lying in the getters has no
 * such hole: the fields are whatever `Intl` says they are, and every hour of
 * every zone is representable.
 *
 * A class per zone because `date-fns` clones its argument with
 * `new date.constructor(+date)` — no arguments beyond the timestamp — so the
 * zone has to live in the constructor rather than in the instance.
 *
 * The SETTERS are overridden too, and they have to be: several format tokens
 * reach one indirectly. `D` goes through `getDayOfYear` → `startOfYear`, and
 * `Y`/`R`/`w`/`I` through the week-year helpers → `startOfWeek`, each of which
 * clones this date and then writes fields to it. Left native, those writes
 * would be interpreted in the BROWSER's zone while every surrounding read
 * answered in the display zone, and the token would come out quietly wrong
 * near a year or week boundary. Overridden, they mean the class is simply a
 * Date in another zone, and every token the library has works.
 *
 * `getUTC*`/`setUTC*` are untouched and still correct — they name an instant,
 * which no zone changes.
 */
function zonedDateClassFor(zone: string): typeof Date {
  const existing = zonedDateClasses.get(zone);
  if (existing) return existing;

  class ZonedDate extends Date {
    private wall: WallClock | null = null;

    private fields(): WallClock {
      if (!this.wall) this.wall = wallClockIn(new Date(this.getTime()), zone);
      return this.wall;
    }

    override getFullYear(): number {
      return this.fields().year;
    }
    override getMonth(): number {
      return this.fields().month - 1;
    }
    override getDate(): number {
      return this.fields().day;
    }
    override getHours(): number {
      return this.fields().hour;
    }
    override getMinutes(): number {
      return this.fields().minute;
    }
    override getSeconds(): number {
      return this.fields().second;
    }
    override getDay(): number {
      const { year, month, day } = this.fields();
      // Day-of-week of the zone's calendar date, computed away from any zone.
      return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    }
    override getTimezoneOffset(): number {
      // Inverted: this method is minutes WEST of UTC, the helper is east.
      return -getTimeZoneOffsetMinutes(zone, new Date(this.getTime()));
    }

    /**
     * Move to the wall clock this one becomes after `changes`, and report the
     * new time value — the contract every `Date` setter has.
     *
     * Out-of-range parts are left to `Date.UTC` inside
     * {@link instantFromWallClock}, which rolls them over exactly as the
     * platform setters do (`setDate(32)` lands in the next month).
     */
    private applyWallClock(
      changes: Partial<WallClock>,
      milliseconds = this.getMilliseconds(),
    ): number {
      const next = instantFromWallClock({ ...this.fields(), ...changes }, milliseconds, zone);
      this.wall = null;
      return super.setTime(next);
    }

    override setTime(time: number): number {
      this.wall = null;
      return super.setTime(time);
    }

    override setFullYear(year: number, month?: number, day?: number): number {
      const current = this.fields();
      return this.applyWallClock({
        year,
        month: month === undefined ? current.month : month + 1,
        day: day ?? current.day,
      });
    }

    override setMonth(month: number, day?: number): number {
      return this.applyWallClock({ month: month + 1, day: day ?? this.fields().day });
    }

    override setDate(day: number): number {
      return this.applyWallClock({ day });
    }

    override setHours(hour: number, minute?: number, second?: number, ms?: number): number {
      const current = this.fields();
      return this.applyWallClock(
        {
          hour,
          minute: minute ?? current.minute,
          second: second ?? current.second,
        },
        ms,
      );
    }

    override setMinutes(minute: number, second?: number, ms?: number): number {
      return this.applyWallClock({ minute, second: second ?? this.fields().second }, ms);
    }

    override setSeconds(second: number, ms?: number): number {
      return this.applyWallClock({ second }, ms);
    }

    override setMilliseconds(ms: number): number {
      return this.applyWallClock({}, ms);
    }
  }

  zonedDateClasses.set(zone, ZonedDate as unknown as typeof Date);
  return ZonedDate as unknown as typeof Date;
}

/**
 * The instant, as a Date that READS as the display zone. Only for handing to a
 * field-reading formatter.
 *
 * Returns the instant untouched — the same object — whenever the display zone
 * is the browser's own, which is the case for everyone who has not chosen a
 * zone. That path is byte-for-byte what the library did before any of this
 * existed.
 */
function inDisplayZone(value: DateInput): Date {
  const instant = toInstant(value);
  const zone = getDisplayTimeZone();
  if (zone === getBrowserTimeZone()) return instant;
  if (Number.isNaN(instant.getTime())) return instant;

  const ZonedDate = zonedDateClassFor(zone);
  return new ZonedDate(instant.getTime());
}

/** `date-fns` `format`, rendering in the display zone. Same arguments. */
export function format(
  date: DateInput,
  formatStr: string,
  options?: Parameters<typeof formatDateFns>[2],
): string {
  return formatDateFns(inDisplayZone(date), formatStr, options);
}

/**
 * `date-fns` `format`, rendering the Date's OWN local fields with no zone
 * redirection at all — identical to importing it straight from the library.
 *
 * For the two kinds of value that must not be reinterpreted:
 *
 *  - a CALENDAR DATE, which names a day rather than a moment, so there is no
 *    instant to move and shifting it can land on the wrong day;
 *  - a value being written into a `date` or `datetime-local` input, which the
 *    browser parses back in the BROWSER's zone. Rendering it in any other zone
 *    means the saved instant quietly changes when the form is submitted.
 *
 * Reach for this ONLY for those two. Everything a person merely reads is an
 * instant and belongs in {@link format} — using this to dodge a shift you did
 * not expect just moves the bug somewhere less visible.
 */
export function formatLocalFields(
  date: DateInput,
  formatStr: string,
  options?: Parameters<typeof formatDateFns>[2],
): string {
  return formatDateFns(toInstant(date), formatStr, options);
}

/**
 * `date-fns` `formatDistanceToNow`, unchanged.
 *
 * Elapsed time between two instants is the same number in every zone, so there
 * is nothing to redirect. It is re-exported here anyway so that a screen has
 * ONE place to import date formatting from, and so the architecture rule can
 * be a flat ban on the library rather than a list of exceptions.
 */
export function formatDistanceToNow(
  date: DateInput,
  options?: Parameters<typeof formatDistanceToNowInternal>[1],
): string {
  return formatDistanceToNowInternal(toInstant(date), options);
}
