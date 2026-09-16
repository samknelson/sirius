import { describe, expect, it } from "vitest";
import { employerRatesMatchDesired } from "../../scripts/s1-migration/lib/employer-rate-sync";

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