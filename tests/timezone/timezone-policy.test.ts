/**
 * THE resolver, and the policy that feeds it.
 *
 * `resolveEffectiveTimeZone` decides which zone every date on the site renders
 * in — server-rendered or browser-rendered, one call, both halves. Nothing else
 * in the codebase gets to have an opinion. It had no coverage at all, which is
 * a poor place for a gap because every way it goes wrong is silent: a wrong
 * branch yields a real zone, a plausible time, no throw and no type error. The
 * only symptom is a person reading a number that is off by some whole number of
 * hours, and believing it.
 *
 * Two guarantees in particular are load-bearing and easy to "helpfully" undo:
 *
 *  - Site policy WINS. With personal zones off, a stored personal zone is
 *    ignored rather than merely un-editable. An implementation that honours a
 *    saved choice because "they did choose it, after all" turns the policy into
 *    a decoration, and does so only for the people who had already picked a
 *    zone before it was turned off — the population least likely to report it.
 *  - The default is the RESTRICTIVE one. An unconfigured site, or one whose
 *    settings row is corrupt, shows everyone site time. Flipping that constant
 *    back would hand out personal zones on every installation that never asked
 *    for them, and no screen anywhere would look broken.
 *
 * Everything here is pure: no database, no server, no network, no DOM.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE_POLICY,
  parseTimeZonePolicy,
  resolveEffectiveTimeZone,
} from "@shared/utils/timezone";

const SITE = "America/Chicago";
const CHOSEN = "Asia/Tokyo";
const BROWSER = "Europe/Berlin";

/** The three zones must be distinct or every assertion below passes vacuously. */
it("uses three genuinely different zones", () => {
  expect(new Set([SITE, CHOSEN, BROWSER]).size).toBe(3);
});

describe("site policy decides whether a personal zone counts", () => {
  it("ignores a stored personal zone while personal zones are off", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: SITE,
        userTimeZone: CHOSEN,
        allowUserTimezones: false,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(SITE);
  });

  it("honours that same stored zone once personal zones are turned on", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: SITE,
        userTimeZone: CHOSEN,
        allowUserTimezones: true,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(CHOSEN);
  });

  it("shows site time to a browser elsewhere while personal zones are off", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: SITE,
        userTimeZone: null,
        allowUserTimezones: false,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(SITE);
  });

  it("falls back to the browser's zone for someone who has not chosen one", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: SITE,
        userTimeZone: null,
        allowUserTimezones: true,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(BROWSER);
  });
});

describe("unusable inputs resolve to something rather than throwing", () => {
  it("treats an unusable stored zone as no choice at all", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: SITE,
        userTimeZone: "Mars/Olympus_Mons",
        allowUserTimezones: true,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(BROWSER);
  });

  it("falls back to the runtime when the site zone is missing", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: null,
        userTimeZone: null,
        allowUserTimezones: false,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(BROWSER);
  });

  it("falls back to the runtime when the site zone is not a real zone", () => {
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: "Middle/Earth",
        userTimeZone: null,
        allowUserTimezones: false,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(BROWSER);
  });
});

describe("an unconfigured site keeps one clock", () => {
  it("does not allow personal zones by default", () => {
    expect(DEFAULT_TIMEZONE_POLICY.allowUserTimezones).toBe(false);
  });

  it("reads an absent settings row as the default", () => {
    expect(parseTimeZonePolicy(undefined).allowUserTimezones).toBe(false);
    expect(parseTimeZonePolicy(null).allowUserTimezones).toBe(false);
  });

  it("reads a malformed settings row as the default rather than trusting it", () => {
    expect(parseTimeZonePolicy({}).allowUserTimezones).toBe(false);
    expect(parseTimeZonePolicy("yes").allowUserTimezones).toBe(false);
    expect(
      parseTimeZonePolicy({ allowUserTimezones: "true" }).allowUserTimezones,
    ).toBe(false);
  });

  it("still honours a row that genuinely says personal zones are allowed", () => {
    expect(
      parseTimeZonePolicy({ allowUserTimezones: true }).allowUserTimezones,
    ).toBe(true);
  });

  it("shows site time on an unconfigured site even to someone who once chose a zone", () => {
    // The composition that matters: no settings row at all, plus a personal
    // zone saved back when the site permitted one.
    const policy = parseTimeZonePolicy(undefined);
    expect(
      resolveEffectiveTimeZone({
        systemTimeZone: SITE,
        userTimeZone: CHOSEN,
        allowUserTimezones: policy.allowUserTimezones,
        runtimeTimeZone: BROWSER,
      }),
    ).toBe(SITE);
  });
});
