import { describe, expect, it } from "vitest";
import { FLEET, fleetGateStatus } from "../../scripts/s1-migration/sync-config";

const passing = FLEET.map(({ id }) => ({ id, status: "pass" }));
const skippedSeeders = passing.map((record) =>
  record.id === "seed-trust-config" || record.id === "seed-policy-benefits"
    ? { ...record, status: "skipped" }
    : record,
);

describe("sync fleet gate", () => {
  it("accepts precisely the two intentionally skipped daily seeders", () => {
    expect(fleetGateStatus(skippedSeeders, "daily", true)).toBe("pass");
    expect(fleetGateStatus(passing, "daily", false)).toBe("pass");
  });

  it("refuses skips without authorization, missing records, or failures", () => {
    expect(fleetGateStatus(skippedSeeders, "daily", false)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders, "daily", true, "elections")).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.slice(0, -1), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.map((r) => r.id === "elections" ? { ...r, status: "skipped" } : r), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.map((r) => r.id === "elections" ? { ...r, status: "fail" } : r), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.map((r) => r.id === "elections" ? { ...r, id: "wrong" } : r), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders, "final-freeze", false)).toBe("fail");
  });
});