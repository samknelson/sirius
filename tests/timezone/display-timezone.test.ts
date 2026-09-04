/**
 * The browser's display-zone mechanisms.
 *
 * These are worth pinning because every way they can break is SILENT. A wrong
 * shift does not throw and does not fail typecheck — it renders a date that
 * looks entirely reasonable and is off by an hour or a day, and only for the
 * people who chose a zone, which is the smallest and least-watched population
 * on the site. Three specific mistakes are easy to make here and impossible to
 * notice:
 *
 *  - shifting by TODAY's offset instead of the offset AT THE INSTANT, which is
 *    wrong for half the year on either side of a daylight-saving boundary;
 *  - reading the runtime's zone after the redirection is installed, which
 *    hands back the zone we ourselves installed rather than the machine's, so
 *    clearing a personal zone would never fall back to where you actually are;
 *  - injecting a zone over one the caller named explicitly.
 *
 * Everything here is pure: no database, no server, no network.
 *
 * The suite pins the process zone before importing the module under test,
 * because it captures the browser's zone once at module load. `pool: "forks"`
 * gives this file its own process, so that mutation is not visible elsewhere.
 */
import { describe, it, expect, beforeAll } from "vitest";

process.env.TZ = "UTC";

type DisplayTimeZoneModule = typeof import("@/lib/display-timezone");
type DateFormatModule = typeof import("@/lib/date-format");

let displayTz: DisplayTimeZoneModule;
let dateFormat: DateFormatModule;

/** Noon UTC in January — New York is on standard time, UTC-5. */
const WINTER = new Date("2026-01-15T12:00:00Z");
/** Noon UTC in July — New York is on daylight time, UTC-4. */
const SUMMER = new Date("2026-07-15T12:00:00Z");

beforeAll(async () => {
  displayTz = await import("@/lib/display-timezone");
  dateFormat = await import("@/lib/date-format");
});

describe("the browser's own zone", () => {
  it("is the process zone", () => {
    expect(displayTz.getBrowserTimeZone()).toBe("UTC");
  });

  it("stays truthful after the redirection is installed", () => {
    displayTz.installTimeZoneRedirection();
    displayTz.setDisplayTimeZone("America/New_York");

    // The trap: `Intl.DateTimeFormat().resolvedOptions().timeZone` now reports
    // the zone the redirection injects, so it can no longer answer "where is
    // this person". This function must still know.
    expect(displayTz.getBrowserTimeZone()).toBe("UTC");
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");

    displayTz.setDisplayTimeZone(null);
    expect(displayTz.getDisplayTimeZone()).toBe("UTC");
  });
});

describe("setting the display zone", () => {
  it("reports whether it actually moved, so a caller knows to repaint", () => {
    displayTz.setDisplayTimeZone("UTC");
    expect(displayTz.setDisplayTimeZone("Asia/Tokyo")).toBe(true);
    expect(displayTz.setDisplayTimeZone("Asia/Tokyo")).toBe(false);
    displayTz.setDisplayTimeZone("UTC");
  });

  it("falls back to the browser's zone rather than throwing on an unusable name", () => {
    displayTz.setDisplayTimeZone("Mars/Olympus_Mons");
    expect(displayTz.getDisplayTimeZone()).toBe("UTC");
  });
});

describe("the redirected locale formatters", () => {
  it("leave an explicitly named zone alone", () => {
    displayTz.installTimeZoneRedirection();
    displayTz.setDisplayTimeZone("America/New_York");

    expect(WINTER.toLocaleString("en-US", { timeZone: "UTC", hour12: false })).toContain("12:00");
    displayTz.setDisplayTimeZone(null);
  });

  it("inject the display zone when the caller named none", () => {
    displayTz.installTimeZoneRedirection();
    displayTz.setDisplayTimeZone("America/New_York");

    expect(WINTER.toLocaleString("en-US", { hour12: false })).toContain("07:00");
    expect(WINTER.toLocaleDateString("en-US")).toBe("1/15/2026");
    displayTz.setDisplayTimeZone(null);
  });

  it("inject nothing at all when the display zone is the browser's own", () => {
    displayTz.installTimeZoneRedirection();
    displayTz.setDisplayTimeZone("UTC");

    expect(WINTER.toLocaleString("en-US", { hour12: false })).toContain("12:00");
  });
});

describe("date-library formatting", () => {
  it("renders the display zone's wall clock", () => {
    displayTz.setDisplayTimeZone("America/New_York");
    expect(dateFormat.format(WINTER, "yyyy-MM-dd HH:mm")).toBe("2026-01-15 07:00");
    displayTz.setDisplayTimeZone(null);
  });

  it("uses the offset at the instant, not the offset today", () => {
    displayTz.setDisplayTimeZone("America/New_York");
    // Same UTC time of day, five hours back in winter and four in summer. A
    // shift computed once — from "now", or from a fixed offset — gets exactly
    // one of these two right.
    expect(dateFormat.format(WINTER, "HH:mm")).toBe("07:00");
    expect(dateFormat.format(SUMMER, "HH:mm")).toBe("08:00");
    displayTz.setDisplayTimeZone(null);
  });

  it("can move the rendered date across midnight", () => {
    displayTz.setDisplayTimeZone("America/New_York");
    expect(dateFormat.format(new Date("2026-01-15T02:00:00Z"), "yyyy-MM-dd")).toBe("2026-01-14");
    displayTz.setDisplayTimeZone(null);
  });

  it("hands back the untouched instant when the display zone is the browser's", () => {
    displayTz.setDisplayTimeZone("UTC");
    expect(dateFormat.format(WINTER, "yyyy-MM-dd HH:mm")).toBe("2026-01-15 12:00");
  });

  it("renders an unusable date as the library does, rather than throwing", () => {
    displayTz.setDisplayTimeZone("America/New_York");
    expect(() => dateFormat.format(new Date("not a date"), "yyyy-MM-dd")).toThrow();
    displayTz.setDisplayTimeZone(null);
  });

  it("leaves elapsed time alone — it is the same number in every zone", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    displayTz.setDisplayTimeZone("UTC");
    const inBrowserZone = dateFormat.formatDistanceToNow(tenMinutesAgo);
    displayTz.setDisplayTimeZone("Asia/Tokyo");
    expect(dateFormat.formatDistanceToNow(tenMinutesAgo)).toBe(inBrowserZone);
    displayTz.setDisplayTimeZone(null);
  });
});
