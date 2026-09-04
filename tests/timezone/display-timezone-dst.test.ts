/**
 * Display-zone formatting from a browser whose OWN zone observes daylight
 * saving.
 *
 * A separate file from display-timezone.test.ts because the browser's zone is
 * captured once at module load, so a suite gets exactly one of them, and the
 * whole point here is that it is not UTC. `pool: "forks"` gives this file its
 * own process.
 *
 * This is where the first implementation was wrong, and the failure was
 * invisible: it shifted the instant by the difference between the two zones'
 * offsets, measured at the ORIGINAL instant, and then let the date library
 * read the fields of the SHIFTED one. When the shift stepped over the
 * browser's own daylight-saving boundary, the fields it read were an hour off
 * — a plausible-looking time, in a plausible-looking place, for a few hours
 * twice a year. Constructing the Date from the target wall clock instead
 * cannot drift that way, and the first case below is the reproducer.
 */
import { describe, it, expect, beforeAll } from "vitest";

process.env.TZ = "America/New_York";

let displayTz: typeof import("@/lib/display-timezone");
let dateFormat: typeof import("@/lib/date-format");
let deadlines: typeof import("@/lib/grievance-deadlines");

beforeAll(async () => {
  displayTz = await import("@/lib/display-timezone");
  dateFormat = await import("@/lib/date-format");
  deadlines = await import("@/lib/grievance-deadlines");
  expect(displayTz.getBrowserTimeZone()).toBe("America/New_York");
});

describe("formatting from a DST-observing browser", () => {
  it("is right for an instant whose shift crosses the browser's spring-forward", () => {
    displayTz.setDisplayTimeZone("UTC");
    // New York springs forward at 07:00Z on 2026-03-08. This instant is 30
    // minutes before that, so New York is still on standard time (-5) — but
    // adding five hours to reach UTC lands AFTER the transition, where the
    // offset is -4. Shift-by-offset reads 07:30 here. The wall clock is 06:30.
    expect(dateFormat.format(new Date("2026-03-08T06:30:00Z"), "yyyy-MM-dd HH:mm")).toBe(
      "2026-03-08 06:30",
    );
    displayTz.setDisplayTimeZone(null);
  });

  it("is right on the far side of the browser's fall-back", () => {
    displayTz.setDisplayTimeZone("UTC");
    // New York falls back at 06:00Z on 2026-11-01.
    expect(dateFormat.format(new Date("2026-11-01T05:30:00Z"), "HH:mm")).toBe("05:30");
    expect(dateFormat.format(new Date("2026-11-01T06:30:00Z"), "HH:mm")).toBe("06:30");
    displayTz.setDisplayTimeZone(null);
  });

  it("is right when the DISPLAY zone changes offset and the browser does not", () => {
    // Tokyo has no daylight saving; New York does. Nine hours ahead of UTC
    // either way, so the rendered wall clock must not move with the seasons.
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    expect(dateFormat.format(new Date("2026-01-15T12:00:00Z"), "HH:mm")).toBe("21:00");
    expect(dateFormat.format(new Date("2026-07-15T12:00:00Z"), "HH:mm")).toBe("21:00");
    displayTz.setDisplayTimeZone(null);
  });

  it("moves the rendered date across midnight", () => {
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    expect(dateFormat.format(new Date("2026-01-15T16:00:00Z"), "yyyy-MM-dd HH:mm")).toBe(
      "2026-01-16 01:00",
    );
    displayTz.setDisplayTimeZone(null);
  });

  it("renders the browser's own zone untouched", () => {
    displayTz.setDisplayTimeZone("America/New_York");
    expect(dateFormat.format(new Date("2026-01-15T12:00:00Z"), "HH:mm")).toBe("07:00");
    expect(dateFormat.format(new Date("2026-07-15T12:00:00Z"), "HH:mm")).toBe("08:00");
  });

  it("renders a wall clock the BROWSER's own zone skips", () => {
    displayTz.setDisplayTimeZone("UTC");
    // 02:30 on 2026-03-08 does not exist in New York — the clock goes straight
    // from 02:00 to 03:00 — so there is no instant a browser-local Date could
    // hold to spell this out, and the earlier shift-the-timestamp approach
    // printed 03:30. Nothing here depends on the browser being able to
    // represent the target wall clock, so it does not care.
    expect(dateFormat.format(new Date("2026-03-08T02:30:00Z"), "HH:mm")).toBe("02:30");
    // The same hour from the other side: New York's own gap, rendered for a
    // viewer who has chosen to see New York's clock.
    displayTz.setDisplayTimeZone("America/New_York");
    expect(dateFormat.format(new Date("2026-03-08T07:30:00Z"), "HH:mm")).toBe("03:30");
    displayTz.setDisplayTimeZone(null);
  });

  it("renders the display zone's own DST transition correctly", () => {
    // Browser New York, display Europe/London: London springs forward at
    // 01:00Z on 2026-03-29, three weeks after New York did.
    displayTz.setDisplayTimeZone("Europe/London");
    expect(dateFormat.format(new Date("2026-03-29T00:30:00Z"), "HH:mm")).toBe("00:30");
    expect(dateFormat.format(new Date("2026-03-29T01:30:00Z"), "HH:mm")).toBe("02:30");
    displayTz.setDisplayTimeZone(null);
  });

  it("names the right weekday and month for the display zone's date", () => {
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    // 2026-01-15 is a Thursday; 19:00 in New York is already Friday in Tokyo.
    expect(dateFormat.format(new Date("2026-01-16T00:00:00Z"), "EEEE d MMMM yyyy")).toBe(
      "Friday 16 January 2026",
    );
    displayTz.setDisplayTimeZone(null);
    expect(dateFormat.format(new Date("2026-01-16T00:00:00Z"), "EEEE d MMMM yyyy")).toBe(
      "Thursday 15 January 2026",
    );
  });
});

describe("format tokens that reach a date-fns setter", () => {
  // These tokens clone the date and WRITE fields to it — `D` via
  // getDayOfYear/startOfYear, the week tokens via the week-year helpers and
  // startOfWeek. A zoned date that only lied in its getters would answer them
  // from browser-local writes and be wrong across the boundary they measure.
  it("numbers the day of the year from the display zone's calendar", () => {
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    // 19:00 on New Year's Eve in New York is already day 1 in Tokyo.
    expect(dateFormat.format(new Date("2027-01-01T00:00:00Z"), "D", { useAdditionalDayOfYearTokens: true })).toBe("1");
    displayTz.setDisplayTimeZone(null);
    expect(dateFormat.format(new Date("2027-01-01T00:00:00Z"), "D", { useAdditionalDayOfYearTokens: true })).toBe("365");
  });

  it("numbers the week from the display zone's calendar", () => {
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    expect(dateFormat.format(new Date("2027-01-01T00:00:00Z"), "I")).toBe("53");
    expect(dateFormat.format(new Date("2027-01-01T00:00:00Z"), "R")).toBe("2026");
    displayTz.setDisplayTimeZone(null);
    expect(dateFormat.format(new Date("2027-01-01T00:00:00Z"), "I")).toBe("53");
    expect(dateFormat.format(new Date("2027-01-01T00:00:00Z"), "R")).toBe("2026");
  });
});

describe("values that must not be reinterpreted", () => {
  it("leaves a calendar date on the day it names", () => {
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    // `new Date("2026-01-15T00:00:00")` — no zone marker, so the browser reads
    // it as local midnight. The day is the whole content of the value; there
    // is no instant to move it to.
    expect(dateFormat.formatLocalFields(new Date("2026-01-15T00:00:00"), "yyyy-MM-dd")).toBe(
      "2026-01-15",
    );
    // What the zone-aware formatter would have done to it, for contrast.
    expect(dateFormat.format(new Date("2026-01-15T00:00:00"), "yyyy-MM-dd")).toBe("2026-01-15");
    expect(dateFormat.format(new Date("2026-01-15T20:00:00"), "yyyy-MM-dd")).toBe("2026-01-16");
    displayTz.setDisplayTimeZone(null);
  });

  it("names a grievance deadline's day whatever zone the viewer chose", () => {
    // The deadline is a Ymd. It used to be turned into a picker Date and then
    // through toLocaleDateString, which the global redirection reinterprets —
    // so a display zone far enough east or west renamed the due date. There is
    // no Date in this path any more, and nothing for a zone to move.
    const rendered = (zone: string | null) => {
      displayTz.setDisplayTimeZone(zone);
      return deadlines.formatYmd("2026-08-09");
    };
    expect(rendered(null)).toBe("Aug 9, 2026");
    expect(rendered("Pacific/Kiritimati")).toBe("Aug 9, 2026");
    expect(rendered("Pacific/Midway")).toBe("Aug 9, 2026");
    displayTz.setDisplayTimeZone(null);
  });

  it("round-trips a datetime-local value back to the same instant", () => {
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    const stored = new Date("2026-01-15T12:00:00Z");

    // What a `datetime-local` input is given, and what the browser parses back
    // out of it on save: both in the browser's zone, so the instant survives.
    const inputValue = dateFormat.formatLocalFields(stored, "yyyy-MM-dd'T'HH:mm:ss");
    expect(new Date(inputValue).toISOString()).toBe(stored.toISOString());

    // The zone-aware formatter would have written Tokyo's wall clock into a
    // field parsed as New York's, moving the saved instant by 14 hours without
    // anything on screen looking wrong.
    expect(new Date(dateFormat.format(stored, "yyyy-MM-dd'T'HH:mm:ss")).toISOString()).not.toBe(
      stored.toISOString(),
    );
    displayTz.setDisplayTimeZone(null);
  });
});
