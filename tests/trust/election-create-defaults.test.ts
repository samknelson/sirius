import { describe, expect, it } from "vitest";
import { getCreateElectionDefaults } from "../../client/src/components/trust/ElectionForm";
import type { WorkerTrustElection } from "../../shared/schema";

const latestElection: WorkerTrustElection = {
  id: "latest-election",
  workerId: "worker-1",
  employerId: "employer-1",
  policyId: "historical-policy",
  benefitIds: ["medical", "dental"],
  relationshipIds: ["relationship-1"],
  startYmd: "2025-01-01",
  endYmd: "2025-12-31",
  enrollmentType: "open_enrollment",
  data: { historical: true },
};

describe("new election carry-forward defaults", () => {
  it("copies only employer, benefits, and relationships onto fresh dates", () => {
    expect(getCreateElectionDefaults(latestElection, "2026-09-09")).toEqual({
      employerId: "employer-1",
      startYmd: "2026-09-09",
      endYmd: "",
      benefitIds: ["medical", "dental"],
      relationshipIds: ["relationship-1"],
    });
  });

  it("keeps the existing blank defaults when the worker has no history", () => {
    expect(getCreateElectionDefaults(null, "2026-09-09")).toEqual({
      employerId: "",
      startYmd: "2026-09-09",
      endYmd: "",
      benefitIds: [],
      relationshipIds: [],
    });
  });
});