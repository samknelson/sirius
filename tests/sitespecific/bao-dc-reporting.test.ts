import { describe, expect, it } from "vitest";
import {
  buildDcYearUsage,
  daysUntilYmd,
  isDcExpiryWarning,
  isDcGrantEvent,
  isDcRemovalEvent,
  summarizeDcGrantActivity,
  BAO_DC_EXPIRY_WARNING_DAYS,
} from "@shared/sitespecific/bao/dc-reporting";
import { BAO_DC_ANNUAL_MONTH_LIMIT } from "@shared/schema";

describe("buildDcYearUsage", () => {
  it("counts non-removed months per calendar year against the annual limit", () => {
    const usage = buildDcYearUsage([
      { workMonthYmd: "2025-11-01" },
      { workMonthYmd: "2025-12-01" },
      { workMonthYmd: "2026-01-01" },
    ]);
    expect(usage).toEqual({
      "2025": { used: 2, limit: BAO_DC_ANNUAL_MONTH_LIMIT },
      "2026": { used: 1, limit: BAO_DC_ANNUAL_MONTH_LIMIT },
    });
  });

  it("returns an empty object for no months", () => {
    expect(buildDcYearUsage([])).toEqual({});
  });

  it("honours a custom limit", () => {
    const usage = buildDcYearUsage([{ workMonthYmd: "2026-03-01" }], 4);
    expect(usage["2026"]).toEqual({ used: 1, limit: 4 });
  });
});

describe("expiry warning window", () => {
  it("computes signed day differences", () => {
    expect(daysUntilYmd("2026-09-25", "2026-08-26")).toBe(30);
    expect(daysUntilYmd("2026-08-26", "2026-08-26")).toBe(0);
    expect(daysUntilYmd("2026-08-25", "2026-08-26")).toBe(-1);
  });

  it("warns strictly inside the 30-day window", () => {
    // Exactly 30 days out: warn.
    expect(isDcExpiryWarning("2026-09-25", "2026-08-26")).toBe(true);
    // 31 days out: no warning yet.
    expect(isDcExpiryWarning("2026-09-26", "2026-08-26")).toBe(false);
    // 1 day out: warn.
    expect(isDcExpiryWarning("2026-08-27", "2026-08-26")).toBe(true);
    // Expiry date itself (end-exclusive) and past: no warning, letter is dead.
    expect(isDcExpiryWarning("2026-08-26", "2026-08-26")).toBe(false);
    expect(isDcExpiryWarning("2026-08-01", "2026-08-26")).toBe(false);
    expect(BAO_DC_EXPIRY_WARNING_DAYS).toBe(30);
  });
});

describe("grant/removal event classification", () => {
  it("classifies granted and released as grants", () => {
    expect(isDcGrantEvent({ eventType: "case_month_granted", payload: {} })).toBe(true);
    expect(isDcGrantEvent({ eventType: "case_month_released", payload: {} })).toBe(true);
    expect(isDcGrantEvent({ eventType: "case_month_voided", payload: {} })).toBe(false);
  });

  it("classifies only reconciled-to-zero as removals", () => {
    expect(
      isDcRemovalEvent({
        eventType: "case_month_reconciled",
        payload: { removed: true, dcHours: 0 },
      }),
    ).toBe(true);
    expect(
      isDcRemovalEvent({ eventType: "case_month_reconciled", payload: { dcHours: 0 } }),
    ).toBe(true);
    // A reduction (still granted) is NOT a removal.
    expect(
      isDcRemovalEvent({ eventType: "case_month_reconciled", payload: { dcHours: 40 } }),
    ).toBe(false);
    // Voided months were never granted — not removals of grants.
    expect(isDcRemovalEvent({ eventType: "case_month_voided", payload: {} })).toBe(false);
  });
});

describe("summarizeDcGrantActivity", () => {
  it("nets same-period grant/removal pairs to zero", () => {
    const rows = summarizeDcGrantActivity([
      { eventType: "case_month_granted", payload: { workMonthYmd: "2026-05-01" } },
      {
        eventType: "case_month_reconciled",
        payload: { workMonthYmd: "2026-05-01", removed: true, dcHours: 0 },
      },
    ]);
    expect(rows).toEqual([
      { workMonthYmd: "2026-05-01", grants: 1, removals: 1, net: 0 },
    ]);
  });

  it("aggregates per work month, sorted, mixing granted and released", () => {
    const rows = summarizeDcGrantActivity([
      { eventType: "case_month_released", payload: { workMonthYmd: "2026-06-01" } },
      { eventType: "case_month_granted", payload: { workMonthYmd: "2026-05-01" } },
      { eventType: "case_month_granted", payload: { workMonthYmd: "2026-06-01" } },
      {
        eventType: "case_month_reconciled",
        payload: { workMonthYmd: "2026-06-01", dcHours: 0 },
      },
      // Reduction: neither grant nor removal.
      {
        eventType: "case_month_reconciled",
        payload: { workMonthYmd: "2026-05-01", dcHours: 32 },
      },
    ]);
    expect(rows).toEqual([
      { workMonthYmd: "2026-05-01", grants: 1, removals: 0, net: 1 },
      { workMonthYmd: "2026-06-01", grants: 2, removals: 1, net: 1 },
    ]);
  });

  it("ignores unrelated events and malformed payloads", () => {
    const rows = summarizeDcGrantActivity([
      { eventType: "case_status_changed", payload: { workMonthYmd: "2026-05-01" } },
      { eventType: "case_month_granted", payload: null },
      { eventType: "case_month_granted", payload: { workMonthYmd: "not-a-month" } },
    ]);
    expect(rows).toEqual([]);
  });

  it("cross-year: yearly usage and event netting stay independent per year", () => {
    const events = [
      { eventType: "case_month_granted", payload: { workMonthYmd: "2025-12-01" } },
      { eventType: "case_month_granted", payload: { workMonthYmd: "2026-01-01" } },
    ];
    const rows = summarizeDcGrantActivity(events);
    expect(rows.map((r) => r.workMonthYmd)).toEqual(["2025-12-01", "2026-01-01"]);
    const usage = buildDcYearUsage([
      { workMonthYmd: "2025-12-01" },
      { workMonthYmd: "2026-01-01" },
    ]);
    expect(usage["2025"].used).toBe(1);
    expect(usage["2026"].used).toBe(1);
  });
});
