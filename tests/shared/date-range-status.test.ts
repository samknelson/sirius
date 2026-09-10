import { describe, expect, it } from "vitest";
import { getDateRangeStatus } from "../../shared/utils/date";

describe("getDateRangeStatus", () => {
  const today = "2026-09-09";

  it("treats both start and end boundaries as active", () => {
    expect(getDateRangeStatus(today, null, today)).toBe("active");
    expect(getDateRangeStatus("2026-01-01", today, today)).toBe("active");
  });

  it("classifies ranges before and after the as-of date", () => {
    expect(getDateRangeStatus("2026-09-10", null, today)).toBe("upcoming");
    expect(getDateRangeStatus("2025-01-01", "2026-09-08", today)).toBe("ended");
  });

  it("does not treat an open future range as active", () => {
    expect(getDateRangeStatus("2027-01-01", null, today)).toBe("upcoming");
  });
});