/**
 * S1 date transforms are host-zone independent — each S1 category keeps its
 * documented meaning (06 §5, 03-transformations "Time zone contract") no
 * matter what zone the process happens to run in.
 *
 * This file therefore runs in a deliberately hostile zone: UTC+14, no DST,
 * a day ahead of Los Angeles for most of every day. Any transform that leaks
 * the host zone shows up as a shifted day or month below. (The gate refuses
 * to LOAD in this zone; these are the pure helpers, exercised in isolation.)
 */
process.env.TZ = "Pacific/Kiritimati";

import { describe, expect, it } from "vitest";
import { epochToYmd, parseUtcInstant, toYmd } from "../../scripts/s1-migration/lib/loader-utils";
import { epochToLaYm, epochToLaYmd, laStatementYmd } from "../../scripts/s1-migration/lib/resolvers";
import { currentLaMonth } from "../../scripts/s1-migration/sync-config";

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

it("really is running a day ahead of LA (the hostile host zone took effect)", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Pacific/Kiritimati");
  expect(new Date("2025-01-31T12:00:00Z").getDate()).toBe(1); // Feb 1 locally
});

describe("date-only values (dob, coverage/policy dates): the string IS the value", () => {
  it("keeps the calendar day no matter the host zone, including month-end and leap day", () => {
    expect(toYmd("2025-01-31 00:00:00")).toBe("2025-01-31");
    expect(toYmd("2025-01-31 23:59:59")).toBe("2025-01-31");
    expect(toYmd("2024-02-29 00:00:00")).toBe("2024-02-29");
    expect(toYmd("2026-03-08 00:00:00")).toBe("2026-03-08"); // spring-forward day
    expect(toYmd("2026-11-01 00:00:00")).toBe("2026-11-01"); // fall-back day
  });

  it("rejects an impossible calendar date rather than normalizing it onto a neighbouring day", () => {
    expect(toYmd("2025-02-30 00:00:00")).toBeNull();
    expect(toYmd("2023-02-29 00:00:00")).toBeNull();
    expect(toYmd("not a date")).toBeNull();
  });
});

describe("UTC-stored values (`tz_handling: site`): explicit instant, never host-parsed", () => {
  it("parses as UTC even on a UTC+14 host", () => {
    expect(parseUtcInstant("2025-01-31 23:30:00")?.toISOString()).toBe("2025-01-31T23:30:00.000Z");
    expect(parseUtcInstant("2025-02-01 05:30")?.toISOString()).toBe("2025-02-01T05:30:00.000Z");
  });

  it("a wall clock inside LA's spring-forward gap is a perfectly good UTC instant (the value is not LA)", () => {
    expect(parseUtcInstant("2026-03-08 02:30:00")?.toISOString()).toBe("2026-03-08T02:30:00.000Z");
  });

  it("rejects malformed values instead of inventing instants", () => {
    expect(parseUtcInstant("2025-02-30 10:00:00")).toBeNull();
    expect(parseUtcInstant("2025-02-01 24:00:00")).toBeNull();
    expect(parseUtcInstant("2025-02-01")).toBeNull();
  });
});

describe("epoch → LA fund calendar (ledger months, statement dates)", () => {
  it("UTC→LA month rollover: 05:30Z on Feb 1 is still January in LA", () => {
    const e = sec("2025-02-01T05:30:00Z");
    expect(epochToLaYmd(e)).toBe("2025-01-31");
    expect(epochToLaYm(e)).toEqual({ y: 2025, m: 1 });
    expect(laStatementYmd(e)).toBe("2025-01-01");
  });

  it("LA midnight is the boundary: 07:59:59Z vs 08:00:00Z (PST)", () => {
    expect(epochToLaYmd(sec("2025-02-01T07:59:59Z"))).toBe("2025-01-31");
    expect(epochToLaYmd(sec("2025-02-01T08:00:00Z"))).toBe("2025-02-01");
    expect(laStatementYmd(sec("2025-02-01T08:00:00Z"))).toBe("2025-02-01");
  });

  it("in daylight time the boundary moves to 07:00Z", () => {
    expect(epochToLaYmd(sec("2025-07-01T06:59:59Z"))).toBe("2025-06-30");
    expect(epochToLaYmd(sec("2025-07-01T07:00:00Z"))).toBe("2025-07-01");
  });

  it("spring-forward gap (2026-03-08 02:00 LA does not exist): both sides are the same LA day", () => {
    expect(epochToLaYmd(sec("2026-03-08T09:59:59Z"))).toBe("2026-03-08"); // 01:59:59 PST
    expect(epochToLaYmd(sec("2026-03-08T10:00:00Z"))).toBe("2026-03-08"); // 03:00:00 PDT
  });

  it("fall-back overlap (2026-11-01 01:xx LA happens twice): both instants are the same LA day", () => {
    expect(epochToLaYmd(sec("2026-11-01T08:30:00Z"))).toBe("2026-11-01"); // 01:30 PDT
    expect(epochToLaYmd(sec("2026-11-01T09:30:00Z"))).toBe("2026-11-01"); // 01:30 PST
    // and the day boundary that night is back at 08:00Z
    expect(epochToLaYmd(sec("2026-11-02T07:59:59Z"))).toBe("2026-11-01");
    expect(epochToLaYmd(sec("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
  });

  it("currentLaMonth (open-span horizon) buckets by LA, not by the host", () => {
    expect(currentLaMonth(new Date("2025-02-01T05:30:00Z"))).toBe("2025-01");
    expect(currentLaMonth(new Date("2025-02-01T08:00:00Z"))).toBe("2025-02");
  });
});

describe("epoch → UTC calendar (the ruled end-dating convention)", () => {
  it("is UTC by construction, so it does not move with the host either", () => {
    expect(epochToYmd(sec("2025-02-01T05:30:00Z"))).toBe("2025-02-01");
    expect(epochToYmd(NaN)).toBeNull();
  });
});
