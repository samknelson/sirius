import { describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";
import { loadGbhetBenefitSetup, assertGbhetBenefitConfiguration } from "../../server/plugins/wizards/gbhet-legal-benefits";
import { benefitConfigurationError, mappedBenefitFieldIds } from "../../shared/gbhet-legal-benefits";
import { missingMappingGroups } from "../../shared/feed-mapping-requirements";

const fields = [
  { id: "ssn", name: "SSN", type: "string" as const, required: true },
  { id: "benefit_1", name: "Eligibility 1", type: "benefit" as const, required: false, isBenefitEligibility: true },
  { id: "benefit_2", name: "Eligibility 2", type: "benefit" as const, required: false, isBenefitEligibility: true },
];
const benefits = [
  { id: "unrelated", name: "First Active", isActive: true },
  { id: "legal", name: "Employer Legal", isActive: true },
  { id: "global", name: "Global Legal", isActive: true },
  { id: "inactive", name: "Old Legal", isActive: false },
];
function config(benefitId: unknown, scope = "global", account: string | null = null) {
  return { config: { id: `${scope}-${account}`, pluginId: "gbhet-legal-benefit", enabled: true,
    name: "Legal", data: { benefitId } },
  subsidiary: { scope, employerId: scope === "employer" ? "employer" : null, account } };
}
function storageFor(globals: ReturnType<typeof config>[], employer: ReturnType<typeof config>[] = []) {
  return {
    trustBenefits: { getAllTrustBenefits: async () => benefits,
      getActiveTrustBenefitOptions: vi.fn(async () => benefits.filter(benefit => benefit.isActive)) },
    pluginConfigs: { search: vi.fn(async (_kind, filter) => filter.scope === "global" ? globals : employer) },
  } as unknown as IStorage;
}
describe("authoritative Legal benefit default", () => {
  it("uses a configured benefit instead of the first active option", async () => {
    const setup = await loadGbhetBenefitSetup(storageFor([config("legal")]), fields, "employer");
    expect(setup.defaultBenefit).toEqual({ id: "legal", name: "Employer Legal" });
  });
  it("honors employer overrides for the same account", async () => {
    const setup = await loadGbhetBenefitSetup(
      storageFor([config("global", "global", "account")], [config("legal", "employer", "account")]),
      fields, "employer",
    );
    expect(setup.defaultBenefit?.id).toBe("legal");
  });
  it("uses global fallback and accepts multiple configs agreeing on one benefit", async () => {
    const storage = storageFor([config("global", "global", "a"), config("global", "global", "b")]);
    expect((await loadGbhetBenefitSetup(storage, fields, "employer")).defaultBenefit?.id).toBe("global");
    expect(storage.pluginConfigs.search).toHaveBeenCalledWith("charge", expect.objectContaining({
      pluginId: "gbhet-legal-benefit", enabled: true, scope: "global", employerId: null,
    }));
    expect(storage.pluginConfigs.search).toHaveBeenCalledWith("charge", expect.objectContaining({
      scope: "employer", employerId: "employer", enabled: true,
    }));
  });
  it.each([
    [], [config("inactive")], [config("missing")], [config(undefined)],
    [config("global", "global", "a"), config("legal", "global", "b")],
  ].map(configs => ({ configs })))("requires explicit choice when configuration is absent, invalid or ambiguous: $configs", async ({ configs }) => {
    const setup = await loadGbhetBenefitSetup(storageFor(configs), fields, "employer");
    expect(setup.defaultBenefit).toBeNull();
    expect(setup.defaultBenefitWarning).toContain("Select an active benefit");
  });
  it("does not discard global configuration for a different account", async () => {
    const setup = await loadGbhetBenefitSetup(
      storageFor([config("global", "global", "a")], [config("legal", "employer", "b")]), fields, "employer",
    );
    expect(setup.defaultBenefit).toBeNull();
  });
});
describe("benefit mapping coverage", () => {
  const mappingExamples: Record<string, string>[] = [
    { ssn: "col_0", benefit_1: "col_1" },
    { col_0: "ssn", col_1: "benefit_1", col_2: "_unmapped" },
  ];
  it.each(mappingExamples)("recognizes either saved mapping orientation", mapping => {
    expect(mappedBenefitFieldIds(fields, mapping)).toEqual(["benefit_1"]);
  });
  it("requires any one benefit field, without making all five required", () => {
    const groups = [{ fieldIds: ["benefit_1", "benefit_2"], message: "Choose eligibility" }];
    expect(missingMappingGroups({ ssn: "col_0" }, groups)).toHaveLength(1);
    expect(missingMappingGroups({ benefit_2: "col_3" }, groups)).toHaveLength(0);
    expect(missingMappingGroups({ col_3: "benefit_2" }, groups)).toHaveLength(0);
    expect(missingMappingGroups({ ssn: "col_0" })).toHaveLength(0);
  });
  it.each([
    undefined, [], [{ fieldId: "benefit_2", benefitId: "legal" }],
    [{ fieldId: "benefit_1", benefitId: "_none" }],
    [{ fieldId: "benefit_1", benefitId: "inactive" }],
    [{ fieldId: "benefit_1", benefitId: "legal" }, { fieldId: "benefit_1", benefitId: "legal" }],
  ].map(value => ({ value })))("rejects incomplete, stale, duplicate or unavailable association: $value", ({ value }) => {
    expect(benefitConfigurationError(["benefit_1"], value, new Set(["legal"]))).toBeTruthy();
  });
  it("accepts every mapped field with an active choice, including an explicit nondefault", async () => {
    await expect(assertGbhetBenefitConfiguration(storageFor([]), fields, {
      columnMapping: { benefit_1: "col_1", benefit_2: "col_2" },
      benefitConfig: [{ fieldId: "benefit_1", benefitId: "unrelated" }, { fieldId: "benefit_2", benefitId: "legal" }],
    })).resolves.toBeUndefined();
  });
  it("refuses zero benefit mappings before reading or writing storage", async () => {
    const storage = storageFor([]);
    await expect(assertGbhetBenefitConfiguration(storage, fields, { columnMapping: { ssn: "col_0" } }))
      .rejects.toThrow("at least one");
    expect(storage.trustBenefits.getActiveTrustBenefitOptions).not.toHaveBeenCalled();
  });
});
