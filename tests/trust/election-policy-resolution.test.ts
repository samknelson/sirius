import { describe, expect, it, vi } from "vitest";
import type { Policy } from "@shared/schema";
import {
  createPolicyResolutionCache,
  resolveElectionPolicyAsOf,
  type PolicyResolutionStorage,
} from "../../server/services/policy-resolution";

const policy = (id: string) => ({ id, name: id } as Policy);

describe("resolveElectionPolicyAsOf", () => {
  it("uses the election employer and start date instead of the legacy policy value", async () => {
    const history = [
      { date: "2024-01-01", policy: policy("policy-at-election") },
      { date: "2026-01-01", policy: policy("later-policy") },
    ];
    const storage: PolicyResolutionStorage = {
      employerPolicyHistory: {
        getEmployerPolicyHistory: vi.fn(async () => history),
      },
      employers: {
        getEmployer: vi.fn(async (id: string) => ({
          id,
          denormPolicyId: "current-policy",
        })),
      },
      policies: {
        getPolicyById: vi.fn(async (id: string) => policy(id)),
      },
      variables: {
        getByName: vi.fn(async () => ({ value: "default-policy" })),
      },
    };
    const election = {
      employerId: "election-employer",
      startYmd: "2025-04-01",
      policyId: "legacy-policy",
    };

    const resolved = await resolveElectionPolicyAsOf(
      storage,
      election,
      createPolicyResolutionCache(),
    );

    expect(resolved.policy?.id).toBe("policy-at-election");
    expect(storage.employers.getEmployer).toHaveBeenCalledWith("election-employer");
    expect(storage.employerPolicyHistory.getEmployerPolicyHistory).toHaveBeenCalledWith(
      "election-employer",
    );
    expect(storage.policies.getPolicyById).not.toHaveBeenCalledWith("legacy-policy");
  });
});
