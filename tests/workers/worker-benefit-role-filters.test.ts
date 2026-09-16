import { describe, expect, it } from "vitest";
import {
  normalizeWorkerBenefitRoleFilters,
  WorkerBenefitRoleFilterError,
} from "@shared/worker-benefit-role-filters";
import { serializeQueryKey } from "@/lib/queryClient";

describe("worker benefit role filter normalization", () => {
  it.each([
    [{ isSubscriber: "any", isDependent: "", subscriberSinceFrom: " " }, {}],
    [
      {
        isSubscriber: "yes",
        isDependent: "no",
        subscriberSinceFrom: "2024-01",
        subscriberSinceThrough: "2024-12",
        dependentSinceFrom: "2023-06",
        dependentSinceThrough: "2025-02",
      },
      {
        isSubscriber: "yes",
        isDependent: "no",
        subscriberSinceFrom: "2024-01",
        subscriberSinceThrough: "2024-12",
        dependentSinceFrom: "2023-06",
        dependentSinceThrough: "2025-02",
      },
    ],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeWorkerBenefitRoleFilters(input, true)).toEqual(expected);
  });

  it.each([
    ["isSubscriber", { isSubscriber: "sometimes" }],
    ["isDependent", { isDependent: "1" }],
    ["subscriberSinceFrom", { subscriberSinceFrom: "2024-00" }],
    ["dependentSinceThrough", { dependentSinceThrough: "2024-2" }],
  ])("rejects invalid %s", (field, input) => {
    expect(() => normalizeWorkerBenefitRoleFilters(input, true)).toThrow(
      new RegExp(field),
    );
  });

  it("rejects reversed ranges and keeps both boundaries inclusive", () => {
    expect(() =>
      normalizeWorkerBenefitRoleFilters(
        { subscriberSinceFrom: "2025-01", subscriberSinceThrough: "2024-12" },
        true,
      ),
    ).toThrow("subscriberSinceFrom must be on or before subscriberSinceThrough");

    expect(
      normalizeWorkerBenefitRoleFilters(
        { dependentSinceFrom: "2024-01", dependentSinceThrough: "2024-01" },
        true,
      ),
    ).toEqual({
      dependentSinceFrom: "2024-01",
      dependentSinceThrough: "2024-01",
    });
  });

  it("returns no filters before validating disabled input", () => {
    const input = Object.defineProperty({}, "isSubscriber", {
      get() {
        throw new Error("must not inspect disabled input");
      },
    });

    expect(normalizeWorkerBenefitRoleFilters(input, false)).toEqual({});
  });

  it("uses the dedicated error type for invalid values", () => {
    try {
      normalizeWorkerBenefitRoleFilters(
        { isSubscriber: "invalid" },
        true,
      );
      throw new Error("expected normalization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerBenefitRoleFilterError);
    }
  });

  it.each([
    [{ isSubscriber: "yes" }, { isSubscriber: "yes" }],
    [
      { isSubscriber: "yes", subscriberSinceFrom: "2024-01" },
      { isSubscriber: "yes", subscriberSinceFrom: "2024-01" },
    ],
    [{ isDependent: "yes" }, { isDependent: "yes" }],
    [
      { isDependent: "yes", dependentSinceThrough: "2024-12" },
      { isDependent: "yes", dependentSinceThrough: "2024-12" },
    ],
  ])("normalizes role-only and optional-date values %j", (input, expected) => {
    expect(normalizeWorkerBenefitRoleFilters(input, true)).toEqual(expected);
  });

  it("omits role values when the gated component is disabled", () => {
    expect(
      normalizeWorkerBenefitRoleFilters(
        { isSubscriber: "yes", subscriberSinceFrom: "2024-01" },
        false,
      ),
    ).toEqual({});
  });

  it.each([
    [{ isSubscriber: "yes" }, "isSubscriber=yes"],
    [
      { isDependent: "yes", dependentSinceFrom: "2024-01" },
      "isDependent=yes&dependentSinceFrom=2024-01",
    ],
  ])("serializes the applied %j role filter for the list request", (params, query) => {
    expect(
      serializeQueryKey([
        "/api/workers/with-details/paginated",
        { page: 1, pageSize: 50, ...params },
      ]),
    ).toContain(query);
  });
});