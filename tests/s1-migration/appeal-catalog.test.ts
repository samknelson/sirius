import { describe, expect, it } from "vitest";
import {
  APPEAL_CATALOG,
  appealForPolicyTitle,
  benefitKindForExactName,
  classifyAppealExemption,
  deletedAppealElectionNids,
  type AppealOwnedRow,
} from "../../scripts/s1-migration/lib/appeal-catalog";
import {
  TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION,
  createTrustBenefitEligibilityExemptionRequestSchema,
  trustBenefitEligibilityExemptionSourceSchema,
} from "../../shared/schema/trust/eligibility-exemptions-schema";

describe("S1 appeal catalog", () => {
  it("contains all nine exact policy titles", () => {
    expect(Object.keys(APPEAL_CATALOG)).toHaveLength(9);
    for (const title of [
      "EVENT CENTER Plan - Delta Appeal", "Participation Agreement - Delta Appeal",
      "RESTAURANT Plan - Delta Appeal", "UNITE HERE Plan - Delta Appeal",
      "EVENT CENTER Plan - HealthNet Appeal", "UNITE HERE Plan - HealthNet Appeal",
      "EVENT CENTER Plan - Kaiser Appeal", "RESTAURANT Plan - Kaiser Appeal",
      "UNITE HERE Plan - Kaiser Appeal",
    ]) expect(appealForPolicyTitle(title)).toBeDefined();
  });
  it("rejects unknown policy names and fuzzy benefit names", () => {
    expect(appealForPolicyTitle("Unknown Appeal")).toBeUndefined();
    expect(benefitKindForExactName("Delta Dental Plus")).toBeUndefined();
    expect(benefitKindForExactName("Delta Dental")).toBe("delta");
    expect(benefitKindForExactName("Health Net")).toBe("healthnet");
    expect(benefitKindForExactName("Kaiser")).toBe("kaiser");
  });

  it("classifies create, stable rerun, correction, and withdrawal without adopting foreign rows", () => {
    const desired = {
      electionNid: 42,
      workerId: "worker-a",
      benefitId: "delta",
      plugin: "sitespecific-bao-start-delta",
      startYmd: "2026-01-01",
      endYmd: null,
    };
    const manual: AppealOwnedRow = {
      sourceKind: null,
      electionNid: null,
      workerId: "worker-a",
      benefitId: "delta",
      plugins: [desired.plugin],
      startYmd: desired.startYmd,
      endYmd: null,
    };
    const nativeBao = { ...manual, sourceKind: "bao_appeal" };
    expect(classifyAppealExemption([manual, nativeBao], desired)).toBe("create");

    const owned: AppealOwnedRow = {
      ...manual,
      sourceKind: "s1_appeal_election",
      electionNid: 42,
    };
    expect(classifyAppealExemption([manual, nativeBao, owned], desired)).toBe("unchanged");
    expect(classifyAppealExemption([owned], { ...desired, workerId: "worker-corrected" })).toBe("update");
    expect(classifyAppealExemption([owned], { ...desired, endYmd: "2026-06-01" })).toBe("update");
    expect(classifyAppealExemption([owned, { ...owned }], desired)).toBe("duplicate");
  });

  it("deletes vanished owned sources only with complete staging evidence", () => {
    expect(deletedAppealElectionNids([10, 20], new Set([10]), false)).toEqual([]);
    expect(deletedAppealElectionNids([10, 20], new Set([10]), true)).toEqual([20]);
    expect(deletedAppealElectionNids([20], new Set(), true)).toEqual([20]);
  });

  it("validates truthful migration provenance without exposing provenance on staff create", () => {
    const source = trustBenefitEligibilityExemptionSourceSchema.parse({
      kind: TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION,
      electionNid: "42",
      electionName: "EVENT CENTER Plan - Delta Appeal",
      policyNid: "9001",
      policyName: "EVENT CENTER Plan - Delta Appeal",
      startYmd: "2026-01-01",
      endYmd: null,
      active: true,
    });
    expect(source.kind).toBe(TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION);
    expect(() => createTrustBenefitEligibilityExemptionRequestSchema.parse({
      subscriberWorkerId: "worker-a",
      benefitId: "delta",
      eligibilityPlugins: ["sitespecific-bao-start-delta"],
      startYmd: "2026-01-01",
      source,
    })).toThrow();
  });
});