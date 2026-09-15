import { describe, expect, it } from "vitest";
import {
  createBaoEeContributionRateRequestSchema,
  updateBaoEeContributionRateRequestSchema,
} from "../../shared/schema/sitespecific/bao/schema";

describe("BAO employee contribution rate validation", () => {
  const required = {
    policyId: "policy-1",
    benefitId: "benefit-1",
    effectiveYmd: "2026-02-01",
  };

  it("preserves an explicit zero contribution while rejecting imprecise or negative currency", () => {
    expect(createBaoEeContributionRateRequestSchema.parse({ ...required, rate: 0 }).rate).toBe("0.00");
    expect(
      createBaoEeContributionRateRequestSchema.safeParse({ ...required, rate: "-0.01" }).success,
    ).toBe(false);
    expect(
      createBaoEeContributionRateRequestSchema.safeParse({ ...required, rate: "1.001" }).success,
    ).toBe(false);
    expect(
      createBaoEeContributionRateRequestSchema.safeParse({ ...required, rate: "100000000.00" })
        .success,
    ).toBe(false);
  });

  it("requires a real effective date and at least one valid mutable field", () => {
    expect(
      createBaoEeContributionRateRequestSchema.safeParse({
        ...required,
        rate: "50.00",
        effectiveYmd: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(updateBaoEeContributionRateRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateBaoEeContributionRateRequestSchema.parse({ effectiveYmd: "2028-02-29" }),
    ).toEqual({ effectiveYmd: "2028-02-29" });
  });
});