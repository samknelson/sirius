/**
 * The clocks that make the time-zone settings comprehensible.
 *
 * This screen exists to show two zones side by side, so its one fatal failure
 * is both easy to cause and impossible to notice: every clock rendering the
 * SAME time. The browser's locale formatters are globally redirected at the
 * display zone (see `client/src/lib/display-timezone.ts`), and an explicit
 * `timeZone` is the only thing that redirection leaves alone. Drop it —
 * reformat with `toLocaleTimeString()`, or "simplify" through
 * `@/lib/date-format` — and both clocks quietly agree, the offset between them
 * disappears, and the screen states something false while looking entirely
 * correct. Nothing else catches that: it type-checks, it renders, and the
 * date-formatting lint rule only bans the date library.
 *
 * Pure: no database, no server, no network. The process zone is pinned before
 * the module under test is imported, because it captures the browser's zone
 * once at load; `pool: "forks"` keeps that mutation to this file.
 */
import { describe, it, expect, beforeAll } from "vitest";

process.env.TZ = "UTC";

type DisplayTimeZoneModule = typeof import("@/lib/display-timezone");
type ZoneClockModule = typeof import("@/components/timezone/ZoneClock");
type ServerModule = typeof import("react-dom/server");

let displayTz: DisplayTimeZoneModule;
let ZoneClock: ZoneClockModule["ZoneClock"];
let renderToStaticMarkup: ServerModule["renderToStaticMarkup"];

/**
 * An instant that falls on DIFFERENT CALENDAR DAYS in the three zones below:
 * 19:00 on the 15th in New York, 23:00 on the 15th in UTC, 08:00 on the 16th
 * in Tokyo. A clock that has lost its zone cannot fake that.
 */
const AT = new Date("2026-07-15T23:00:00Z");

/** The rendered time and date lines, pulled back out of the static markup. */
function readClock(zone: string): { time: string; date: string; markup: string } {
  const markup = renderToStaticMarkup(
    <ZoneClock title="Test" zone={zone} at={AT} testId="clock" />,
  );
  const pick = (testId: string): string => {
    const match = markup.match(
      new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`),
    );
    if (!match) throw new Error(`no ${testId} in markup: ${markup}`);
    return match[1];
  };
  return { time: pick("clock-time"), date: pick("clock-date"), markup };
}

beforeAll(async () => {
  displayTz = await import("@/lib/display-timezone");
  ({ ZoneClock } = await import("@/components/timezone/ZoneClock"));
  ({ renderToStaticMarkup } = await import("react-dom/server"));

  // The state a real browser is in by the time this screen renders, and the
  // whole reason the test is worth having: redirection installed, and pointed
  // at a zone that is none of the ones being displayed.
  displayTz.installTimeZoneRedirection();
  displayTz.setDisplayTimeZone("Asia/Tokyo");
});

describe("a zone clock renders the zone it was given", () => {
  it("shows a different time per zone at one instant", () => {
    const ny = readClock("America/New_York");
    const utc = readClock("UTC");
    const tokyo = readClock("Asia/Tokyo");

    // The collapse this file exists to catch.
    expect(ny.time).not.toBe(utc.time);
    expect(ny.time).not.toBe(tokyo.time);
    expect(utc.time).not.toBe(tokyo.time);
  });

  it("is not captured by the display zone the formatters are redirected at", () => {
    // Display zone is Tokyo. A clock told to show New York must still show New
    // York — otherwise every clock on the screen reads the viewer's own zone
    // and the comparison is meaningless.
    expect(displayTz.getDisplayTimeZone()).toBe("Asia/Tokyo");
    expect(readClock("America/New_York").time).not.toBe(readClock("Asia/Tokyo").time);
  });

  it("puts each zone on its own calendar day", () => {
    // 23:00 UTC on the 15th is still the 15th in New York and already the 16th
    // in Tokyo. Day numbers survive any locale the runtime happens to default
    // to, so this pins the actual wall clock rather than its wording.
    expect(readClock("America/New_York").date).toContain("15");
    expect(readClock("UTC").date).toContain("15");
    expect(readClock("Asia/Tokyo").date).toContain("16");
  });

  it("names the zone and its offset, so a reader can tell which clock is which", () => {
    const ny = readClock("America/New_York");
    expect(ny.markup).toContain("America/New_York");
    // July: New York is on daylight time.
    expect(ny.markup).toContain("GMT-4");
  });
});
