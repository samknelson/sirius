import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALTERNATE_TAX_ID } from "@shared/utils/worker-tax-identity";
const state = vi.hoisted(() => ({
  workers: [] as any[], ids: [] as any[], grants: new Set<string>(), failRead: false,
}));
vi.mock("../../server/storage", () => ({ storage: {
  workers: {
    getWorkerBySSN: async (ssn: string) => state.workers.find(w => w.ssn === ssn),
    getWorker: async (id: string) => state.workers.find(w => w.id === id),
  },
  workerIds: { getWorkerIdByTypeAndValue: async (type: string, value: string) =>
    state.ids.find(id => id.typeId === type && id.value === value) },
  contacts: {
    getContact: async () => ({ email: "OLD@example.com" }),
    phoneNumbers: { getPhoneNumbersByContact: async () => [{ isPrimary: true, phoneNumber: "+16175550100" }] },
    addresses: { getContactPostalByContact: async () => [{ isActive: true, isPrimary: true, street: "100 Main St.", city: "Boston", state: "MA", postalCode: "02110" }] },
  },
  trust: { wmb: { workerBenefitExists: async (worker: string, benefit: string) => {
    if (state.failRead) throw new Error("unavailable");
    return state.grants.has(`${worker}:${benefit}`);
  } } },
} }));
import { measureLegalPopulation } from "../../server/plugins/wizards/gbhet-legal-population";
const wizard = { data: { launchArguments: { year: 2026, month: 11 }, benefitConfig: [{ benefitId: "legal" }, { benefitId: "other" }] } } as any;
beforeEach(() => {
  state.workers = [{ id: "existing", contactId: "contact", ssn: "123456789" }];
  state.ids = [{ typeId: ALTERNATE_TAX_ID, value: "000123456", workerId: "existing" }];
  state.grants = new Set(["existing:legal"]); state.failRead = false;
});
describe("Actual Legal populations use the shared tax resolver", () => {
  it("deduplicates SSN/alternate/format variants, compares pre-import supplied contacts, and excludes new-worker initial values", async () => {
    const measurement = await measureLegalPopulation(wizard, [
      { ssn: "123456789", email: " old@example.com ", phoneNumber: "(617) 555-0100", addressLine1: "100  MAIN ST" },
      { ssn: "000-12-3456", email: "new@example.com", phoneNumber: "6175550199", city: "Cambridge" },
      { ssn: "000.12.3456", email: "", phoneNumber: "", addressLine1: "" },
      { ssn: "900123456", email: "initial@example.com", city: "New" },
      { ssn: "unknown", email: "unresolved@example.com" },
      { ssn: "901123456", email: "unmatched-failed@example.com" },
    ]);
    state.workers.push({ id: "new", contactId: "new-contact", ssn: null });
    state.grants.add("new:legal");
    const actual = new Map([[0, "existing"], [1, "existing"], [2, "existing"], [3, "new"]]);
    const snapshot = await measurement.finish(new Set([0, 1, 2, 3]), actual, new Set(["existing"]), new Set(), new Set(["new"]));
    expect(snapshot).toMatchObject({
      totalRows: 6, distinctWorkers: 2, unresolvedRows: 2, unresolvedIdentityRows: 2, confirmedWorkers: 2,
      workersWithBenefits: 2, workersWithoutBenefits: 0, existingGrants: 1,
      contactDifferences: { workers: 1, email: 1, phone: 1, address: 1, failedWorkers: 1 },
      benefits: [
        { benefitId: "legal", year: 2027, month: 2, withBenefit: 2, withoutBenefit: 0 },
        { benefitId: "other", year: 2027, month: 2, withBenefit: 0, withoutBenefit: 2 },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/000123456|900123456|123456789|example.com/);
  });
  it("does not infer created workers from unmatched identifiers or failed rows", async () => {
    const measurement = await measureLegalPopulation(wizard, [{ ssn: "900123456" }, { ssn: "123456789", email: "changed@example.com" }]);
    expect(await measurement.finish(new Set(), new Map(), new Set(), new Set(), new Set())).toMatchObject({
      distinctWorkers: 1, confirmedWorkers: 0, unconfirmedWorkers: 1, unresolvedIdentityRows: 1, workersWithoutBenefits: 0,
      contactDifferences: { failedWorkers: 0, unconfirmedWorkers: 1 },
    });
    // A real creation can persist even when subsequent name/contact work fails.
    expect(await measurement.finish(new Set(), new Map([[0, "created"]]), new Set(), new Set(), new Set(["created"]))).toMatchObject({
      distinctWorkers: 2, confirmedWorkers: 0, unconfirmedWorkers: 2, unresolvedIdentityRows: 0,
    });
  });
  it("does not classify failed grants or unavailable reads as confirmed absence", async () => {
    state.grants.clear();
    const measurement = await measureLegalPopulation(wizard, [{ ssn: "000123456" }]);
    const args = [new Set([0]), new Map([[0, "existing"]]), new Set<string>()] as const;
    expect(await measurement.finish(...args, new Set(["existing"]), new Set())).toMatchObject({
      confirmedWorkers: 1, workersWithoutBenefits: 0, benefitReadFailures: 1,
    });
    expect(await measurement.finish(...args, new Set(), new Set())).toMatchObject({
      workersWithoutBenefits: 1, benefitReadFailures: 0,
    });
    state.failRead = true;
    expect(await measurement.finish(...args, new Set(), new Set())).toMatchObject({
      workersWithoutBenefits: 0, benefitReadFailures: 1,
    });
  });
  it("excludes contradictory SSN and alternate rows resolving to the same worker", async () => {
    const measurement = await measureLegalPopulation(wizard, [
      { ssn: "123456789", firstName: "First", lastName: "Person" },
      { ssn: "000123456", firstName: "Different", lastName: "Person" },
    ]);
    expect(await measurement.finish(new Set(), new Map(), new Set(), new Set(), new Set())).toMatchObject({
      distinctWorkers: 0, unresolvedIdentityRows: 2, confirmedWorkers: 0,
    });
  });
});
