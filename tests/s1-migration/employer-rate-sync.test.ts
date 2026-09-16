import { describe, expect, it } from "vitest";
import {
  employerRatesMatchDesired,
  buildEmployerRateSnapshot,
  evaluateEmployerRateDurability,
} from "../../scripts/s1-migration/lib/employer-rate-sync";

const migrated = (effectiveYmd: string, rate: string) => ({
  effectiveYmd,
  rate,
  data: { source: "s1-migration" },
});

describe("employer rate fingerprint fast path", () => {
  const desired = [
    { date: "2025-01-01", rate: "6.5000" },
    { date: "2026-01-01", rate: "7.0000" },
  ];

  it("refuses an empty or incomplete target", () => {
    expect(employerRatesMatchDesired([], desired)).toBe(false);
    expect(
      employerRatesMatchDesired([migrated("2025-01-01", "6.5000")], desired),
    ).toBe(false);
  });

  it("refuses mismatched and stale migration-owned rates", () => {
    expect(
      employerRatesMatchDesired(
        [
          migrated("2025-01-01", "6.7500"),
          migrated("2026-01-01", "7.0000"),
        ],
        desired,
      ),
    ).toBe(false);
    expect(
      employerRatesMatchDesired(
        [
          migrated("2025-01-01", "6.5000"),
          migrated("2026-01-01", "7.0000"),
          migrated("2024-01-01", "5.0000"),
        ],
        desired,
      ),
    ).toBe(false);
  });

  it("accepts complete numeric-equivalent rows and ignores foreign extras", () => {
    expect(
      employerRatesMatchDesired(
        [
          migrated("2025-01-01", "6.5"),
          migrated("2026-01-01", "7.00"),
          { effectiveYmd: "2024-01-01", rate: "5.0000", data: null },
        ],
        desired,
      ),
    ).toBe(true);
  });
});

describe("employer rate post-fleet durability gate", () => {
  it("fails when rows verified by the loader disappear later", () => {
    const expected = buildEmployerRateSnapshot([
      { employerId: "e1", effectiveYmd: "2025-01-01", rate: "6.5", data: { source: "s1-migration" } },
    ]);
    expect(evaluateEmployerRateDurability(expected, buildEmployerRateSnapshot([]))).toMatchObject({ status: "fail" });
  });

  it("fails when an unrelated row masks a missing expected row", () => {
    const expected = buildEmployerRateSnapshot([
      { employerId: "e1", effectiveYmd: "2025-01-01", rate: "6.5", data: null },
    ]);
    const masked = buildEmployerRateSnapshot([
      { employerId: "e2", effectiveYmd: "2025-01-01", rate: "6.5", data: null },
    ]);
    expect(evaluateEmployerRateDurability(expected, masked)).toMatchObject({ status: "fail" });
  });

  it("passes unchanged all-foreign adoption and an empty no-source account", () => {
    const foreign = buildEmployerRateSnapshot([
      { employerId: "e1", effectiveYmd: "2025-01-01", rate: "6.5", data: null },
    ]);
    expect(evaluateEmployerRateDurability(foreign, foreign)).toEqual({ status: "pass", failures: [] });
    const empty = buildEmployerRateSnapshot([]);
    expect(evaluateEmployerRateDurability(empty, empty)).toEqual({ status: "pass", failures: [] });
  });
});
