/**
 * The two zones this site names, and the third it must never show.
 *
 * The reported defect: on a site with personal time zones off — the default —
 * the settings screen showed "site time zone" reading one thing and "your time
 * zone" reading another, while every date on the site rendered in the first.
 * The second clock was the browser's own zone, which under that policy governs
 * nothing. Nothing was wrong with the resolution; the screen was describing a
 * zone that had no bearing on what it was showing.
 *
 * So the case pinned here is exactly that one — policy off, browser somewhere
 * else entirely — and the assertion is about what a reader is told: two zones,
 * both system time, in agreement, with the browser's zone nowhere on screen.
 * The zones below are chosen so no offset coincidence can make a wrong answer
 * pass.
 *
 * Pure: no database, no server, no network. The process zone is pinned before
 * anything under test is imported, because `display-timezone` captures the
 * browser's zone once at load; `pool: "forks"` keeps that mutation to this
 * file.
 */
import { describe, it, expect, beforeAll } from "vitest";

/**
 * Where the "browser" is. Not the site's zone, and never a legitimate answer
 * on the surfaces below.
 */
const BROWSER_ZONE = "America/New_York";
process.env.TZ = BROWSER_ZONE;

/** Where the server runs: the site's system time. */
const SYSTEM_ZONE = "Asia/Tokyo";

/** A zone a person might choose for themselves — a third distinct offset. */
const CHOSEN_ZONE = "Europe/Paris";

/** No two of the three share an offset at this instant. */
const AT = new Date("2026-07-15T23:00:00Z");

type VocabularyModule = typeof import("@/components/timezone/zone-vocabulary");
type ZoneClockModule = typeof import("@/components/timezone/ZoneClock");
type SharedModule = typeof import("@shared/utils/timezone");
type ServerModule = typeof import("react-dom/server");

let describeTimeZones: VocabularyModule["describeTimeZones"];
let ZoneClock: ZoneClockModule["ZoneClock"];
let resolveEffectiveTimeZone: SharedModule["resolveEffectiveTimeZone"];
let renderToStaticMarkup: ServerModule["renderToStaticMarkup"];

/**
 * What a surface actually puts in front of a reader, for one set of published
 * facts: the two clocks rendered from the shared vocabulary, exactly as both
 * the settings screen and the header panel render them.
 *
 * The display zone is resolved the way the app resolves it — through the one
 * shared resolver — rather than being asserted independently here, so this
 * test cannot pass by agreeing with itself about a rule the app does not
 * follow.
 */
function renderSurface(input: {
  userTimeZone: string | null;
  allowUserTimezones: boolean;
}) {
  const displayTimeZone = resolveEffectiveTimeZone({
    systemTimeZone: SYSTEM_ZONE,
    userTimeZone: input.userTimeZone,
    allowUserTimezones: input.allowUserTimezones,
    runtimeTimeZone: BROWSER_ZONE,
  });
  const zones = describeTimeZones({
    systemTimeZone: SYSTEM_ZONE,
    userTimeZone: input.userTimeZone,
    allowUserTimezones: input.allowUserTimezones,
    displayTimeZone,
    testIdPrefix: "clock",
  });
  const markup = [zones.system, zones.user]
    .map((clock) =>
      renderToStaticMarkup(
        <ZoneClock
          title={clock.title}
          zone={clock.zone}
          at={AT}
          showing={clock.showing}
          description={clock.description}
          testId={clock.testId}
        />,
      ),
    )
    .join("\n");
  const pick = (testId: string): string => {
    const match = markup.match(new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`));
    if (!match) throw new Error(`no ${testId} in markup: ${markup}`);
    return match[1];
  };
  return {
    zones,
    displayTimeZone,
    markup,
    systemTime: pick("clock-system-time"),
    userTime: pick("clock-user-time"),
  };
}

beforeAll(async () => {
  ({ describeTimeZones } = await import("@/components/timezone/zone-vocabulary"));
  ({ ZoneClock } = await import("@/components/timezone/ZoneClock"));
  ({ resolveEffectiveTimeZone } = await import("@shared/utils/timezone"));
  ({ renderToStaticMarkup } = await import("react-dom/server"));
});

describe("the reported case: personal zones off, browser elsewhere", () => {
  it("names both zones system time, agreeing, with no third zone on screen", () => {
    const surface = renderSurface({
      userTimeZone: null,
      allowUserTimezones: false,
    });

    // Both clocks are the site's zone...
    expect(surface.zones.system.zone).toBe(SYSTEM_ZONE);
    expect(surface.zones.user.zone).toBe(SYSTEM_ZONE);
    expect(surface.zones.sameZone).toBe(true);

    // ...and they READ the same, which is the part a reader checks. Rendered,
    // not compared as strings: the defect was visible on screen.
    expect(surface.userTime).toBe(surface.systemTime);

    // The browser's zone appears nowhere — not as a clock, not as a value in
    // a description, not as an offset label.
    expect(surface.markup).not.toContain(BROWSER_ZONE);
    expect(surface.markup).not.toContain("New York");
    expect(surface.markup).not.toContain("browser");
  });

  it("still honours a zone the person chose before the site switched it off", () => {
    // A stored choice is not honoured under this policy, so it must not
    // surface as a zone either.
    const surface = renderSurface({
      userTimeZone: CHOSEN_ZONE,
      allowUserTimezones: false,
    });

    expect(surface.zones.user.zone).toBe(SYSTEM_ZONE);
    expect(surface.markup).not.toContain(CHOSEN_ZONE);
    expect(surface.userTime).toBe(surface.systemTime);
  });

  it("says why the two agree rather than leaving it to be inferred", () => {
    const { zones } = renderSurface({
      userTimeZone: null,
      allowUserTimezones: false,
    });

    expect(zones.summary).toMatch(/personal time zones are off/i);
    expect(zones.user.description).toMatch(/system time/i);
    // Two clocks reading the same time, one badged "dates shown in this zone",
    // reads as a distinction that is not there.
    expect(zones.user.showing).toBe(false);
    expect(zones.system.showing).toBe(false);
  });
});

describe("the two zones, whatever the policy", () => {
  it("always names exactly system time and user time", () => {
    for (const allowUserTimezones of [true, false]) {
      for (const userTimeZone of [null, CHOSEN_ZONE]) {
        const { zones } = renderSurface({ userTimeZone, allowUserTimezones });
        expect(zones.system.title).toBe("System time");
        expect(zones.user.title).toBe("User time");
      }
    }
  });

  it("shows a chosen zone as user time, marked as the one dates are in", () => {
    const surface = renderSurface({
      userTimeZone: CHOSEN_ZONE,
      allowUserTimezones: true,
    });

    expect(surface.zones.user.zone).toBe(CHOSEN_ZONE);
    expect(surface.zones.user.showing).toBe(true);
    expect(surface.zones.sameZone).toBe(false);
    expect(surface.userTime).not.toBe(surface.systemTime);
    expect(surface.markup).not.toContain(BROWSER_ZONE);
  });

  it("does not call a stored zone 'chosen' when the resolver refused it", () => {
    // A name the resolver cannot use — a typo, or a zone the IANA database
    // renamed out from under a stored value. It falls back to the browser's
    // zone, and describing THAT as the zone this person picked would be a
    // plain lie about a value they can see is not what they set.
    const surface = renderSurface({
      userTimeZone: "Mars/Phobos",
      allowUserTimezones: true,
    });

    expect(surface.zones.user.zone).toBe(BROWSER_ZONE);
    expect(surface.zones.user.description).toMatch(/automatic/i);
    expect(surface.zones.user.description).not.toMatch(/chose/i);
  });

  it("describes an automatic zone without printing the browser's as a value", () => {
    // With no choice made and the policy on, user time IS the browser's zone —
    // the one case where the two coincide. It is still described as automatic
    // rather than restated as a second fact: the clock beneath already says
    // which zone that resolved to.
    const surface = renderSurface({
      userTimeZone: null,
      allowUserTimezones: true,
    });

    expect(surface.zones.user.zone).toBe(BROWSER_ZONE);
    expect(surface.zones.user.description).toMatch(/automatic/i);
    expect(surface.zones.user.description).not.toContain(BROWSER_ZONE);
  });

  it("keeps the two surfaces' test ids apart", () => {
    const page = describeTimeZones({
      systemTimeZone: SYSTEM_ZONE,
      userTimeZone: null,
      allowUserTimezones: false,
      displayTimeZone: SYSTEM_ZONE,
      testIdPrefix: "clock",
    });
    const panel = describeTimeZones({
      systemTimeZone: SYSTEM_ZONE,
      userTimeZone: null,
      allowUserTimezones: false,
      displayTimeZone: SYSTEM_ZONE,
      testIdPrefix: "clock-panel",
    });

    expect(page.system.testId).toBe("clock-system");
    expect(panel.system.testId).toBe("clock-panel-system");
    // Same facts in, same words out: the two screens cannot disagree.
    expect(panel.summary).toBe(page.summary);
    expect(panel.user.description).toBe(page.user.description);
  });
});

describe("the rule that keeps it that way", () => {
  it("catches a browser-zone read in a new screen, and lets the resolver be", async () => {
    const { findViolationsInSource } = await import(
      "../../scripts/dev/check-browser-timezone"
    );

    const offending = [
      'import { getBrowserTimeZone } from "@/lib/display-timezone";',
      "const here = getBrowserTimeZone();",
      "const runtime = getRuntimeTimeZone();",
      "const raw = Intl.DateTimeFormat().resolvedOptions().timeZone;",
      // The ways around the obvious spelling: the same question with a locale
      // in front of it. A rule that only knew the empty-argument form would be
      // one keystroke from useless.
      'const withLocale = Intl.DateTimeFormat("en-US").resolvedOptions().timeZone;',
      "const explicitUndef = Intl.DateTimeFormat(undefined).resolvedOptions().timeZone;",
      "const withOpts = Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().timeZone;",
    ].join("\n");
    const found = findViolationsInSource("client/src/pages/new.tsx", offending);
    expect(found.map((v) => v.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const fine = [
      "// getBrowserTimeZone() is banned here — see the vocabulary module.",
      "const { displayTimeZone } = useAuth();",
      'Intl.DateTimeFormat("en-US", { timeZone: displayTimeZone }).format(at);',
      // Reading back a zone the formatter was HANDED says nothing about where
      // the browser is, so it is not the thing being banned.
      "const named = Intl.DateTimeFormat(undefined, { timeZone: zone }).resolvedOptions().timeZone;",
    ].join("\n");
    expect(findViolationsInSource("client/src/pages/fine.tsx", fine)).toEqual([]);
  });
});
