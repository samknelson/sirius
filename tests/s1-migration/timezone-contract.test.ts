/**
 * The migration time zone gate — verdict rules, the storage contract the pin
 * exists for, and the runtime facts the gate relies on.
 *
 * Runs pinned to the S2 system zone so the pg serialization assertions show
 * exactly what a healthy loader writes. Host-independence of the transforms
 * themselves is proven separately (date-transforms.test.ts runs in a
 * deliberately odd zone).
 */
process.env.TZ = "America/Los_Angeles";

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  evaluateTimeZoneEvidence,
  MIGRATION_SYSTEM_TIME_ZONE,
  OFFSET_PROBES,
  type TimeZoneEvidence,
} from "../../scripts/s1-migration/lib/timezone-contract";
import { getTimeZoneOffsetMinutes } from "../../shared/utils/timezone";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";

const LA = MIGRATION_SYSTEM_TIME_ZONE;

function healthy(over: Partial<TimeZoneEvidence> = {}): TimeZoneEvidence {
  return {
    expected: LA,
    runtimeTimeZone: LA,
    source: "environment",
    configured: LA,
    storedOverride: null,
    dbSessionTimeZone: LA,
    runtimeOffsets: { standard: -480, daylight: -420 },
    expectedOffsets: { standard: -480, daylight: -420 },
    node: process.version,
    icu: null,
    tz: null,
    ...over,
  };
}

describe("evaluateTimeZoneEvidence (the rejection rules)", () => {
  it("accepts a process pinned to the S2 system zone with an aligned session", () => {
    expect(evaluateTimeZoneEvidence(healthy())).toEqual([]);
    expect(evaluateTimeZoneEvidence(healthy({ source: "override", storedOverride: LA }))).toEqual([]);
  });

  it("rejects a deliberately wrong runtime zone (the default container: UTC)", () => {
    const v = evaluateTimeZoneEvidence(
      healthy({ runtimeTimeZone: "UTC", source: "unset", configured: null, runtimeOffsets: { standard: 0, daylight: 0 } }),
    );
    expect(v.some((m) => m.includes('running in "UTC"'))).toBe(true);
    expect(v.some((m) => m.includes("pinned EXPLICITLY"))).toBe(true);
    expect(v.some((m) => m.includes("DST fingerprint"))).toBe(true);
  });

  it("rejects an explicitly configured but wrong zone (an operator typo is still wrong)", () => {
    const v = evaluateTimeZoneEvidence(
      healthy({ runtimeTimeZone: "America/New_York", configured: "America/New_York", runtimeOffsets: { standard: -300, daylight: -240 } }),
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toContain("America/New_York");
  });

  it("rejects a zone that merely LOOKS Pacific for half the year (no DST)", () => {
    // America/Phoenix = -7 all year: matches LA in summer, not in winter.
    const v = evaluateTimeZoneEvidence(
      healthy({ runtimeTimeZone: "America/Phoenix", configured: "America/Phoenix", runtimeOffsets: { standard: -420, daylight: -420 } }),
    );
    expect(v.some((m) => m.includes("DST fingerprint"))).toBe(true);
  });

  it("rejects an implicit (container-default) zone even when it happens to be right", () => {
    const v = evaluateTimeZoneEvidence(healthy({ source: "unset", configured: null }));
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("pinned EXPLICITLY");
  });

  it("rejects a target whose stored ENV_TZ override disagrees — the APP would boot into it", () => {
    const v = evaluateTimeZoneEvidence(healthy({ storedOverride: "UTC" }));
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('ENV_TZ override of "UTC"');
  });

  it("rejects a DB session the pool hook failed to align", () => {
    const v = evaluateTimeZoneEvidence(healthy({ dbSessionTimeZone: "UTC" }));
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("database session TimeZone");
  });

  it("does not tolerate aliases — the pin is the canonical name, full stop", () => {
    const v = evaluateTimeZoneEvidence(healthy({ runtimeTimeZone: "US/Pacific", configured: "US/Pacific" }));
    expect(v).toHaveLength(1);
  });
});

describe("the runtime facts the gate relies on", () => {
  it("the DST fingerprint probes really are deep standard / deep daylight for the pin", () => {
    expect(getTimeZoneOffsetMinutes(LA, new Date(OFFSET_PROBES.standard))).toBe(-480);
    expect(getTimeZoneOffsetMinutes(LA, new Date(OFFSET_PROBES.daylight))).toBe(-420);
  });

  it("TZ in the environment is what drives a child process's runtime zone (children inherit the pin)", () => {
    const probe = "process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)";
    const run = (tz: string | undefined) =>
      execFileSync(process.execPath, ["-e", probe], {
        env: { PATH: process.env.PATH, ...(tz === undefined ? {} : { TZ: tz }) },
        encoding: "utf8",
      });
    expect(run("UTC")).toBe("UTC");
    expect(run(LA)).toBe(LA);
    expect(run("America/New_York")).toBe("America/New_York");
  });

  it("a pool session checked out by a pinned process reports the pinned zone (db.ts checkout hook)", async () => {
    const res = (await db.execute(sql`SELECT current_setting('TimeZone') AS tz`)) as unknown as { rows: Array<{ tz: string }> };
    expect(res.rows[0].tz).toBe(LA);
  });
});

describe("the storage contract the pin protects (pg serialization of a JS Date)", () => {
  // pg renders a Date with the PROCESS zone's wall clock and offset. A naive
  // `timestamp` column keeps only the wall clock — so what lands in S2 is the
  // wall clock in the zone the writer ran in. This is why loader and app must
  // share one zone, and why a UTC-stored S1 instant must be a real Date (not a
  // string) by the time storage sees it.
  const { prepareValue } = createRequire(import.meta.url)("pg/lib/utils") as { prepareValue: (v: unknown) => string };
  const wall = (iso: string) => prepareValue(new Date(iso)).slice(0, 19);

  it("writes the LA wall clock of a UTC instant (month rollover: Feb 1 UTC is still Jan 31 in LA)", () => {
    expect(wall("2025-02-01T05:30:00Z")).toBe("2025-01-31T21:30:00");
  });

  it("LA midnight is the day boundary, not UTC midnight", () => {
    expect(wall("2025-02-01T07:59:59Z")).toBe("2025-01-31T23:59:59");
    expect(wall("2025-02-01T08:00:00Z")).toBe("2025-02-01T00:00:00");
  });

  it("spring-forward gap: 09:59:59Z is 01:59:59 PST, 10:00:00Z is 03:00:00 PDT — 02:xx never exists", () => {
    expect(wall("2026-03-08T09:59:59Z")).toBe("2026-03-08T01:59:59");
    expect(wall("2026-03-08T10:00:00Z")).toBe("2026-03-08T03:00:00");
    expect(prepareValue(new Date("2026-03-08T10:00:00Z"))).toMatch(/-07:00$/);
  });

  it("fall-back overlap: two distinct instants share the naive wall clock 01:30 (accepted S2 model — the offset is dropped by a naive column)", () => {
    expect(wall("2026-11-01T08:30:00Z")).toBe("2026-11-01T01:30:00");
    expect(wall("2026-11-01T09:30:00Z")).toBe("2026-11-01T01:30:00");
    expect(prepareValue(new Date("2026-11-01T08:30:00Z"))).toMatch(/-07:00$/);
    expect(prepareValue(new Date("2026-11-01T09:30:00Z"))).toMatch(/-08:00$/);
  });
});
