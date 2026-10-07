import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  retired: "flag" as "flag" | "reject",
  options: vi.fn(async () => [
    { id: "active", name: "Active", code: "active", employed: true },
    { id: "fmla", name: "FMLA", code: "fmla", employed: true },
    { id: "disability", name: "Disability", code: "disability", employed: false },
  ]),
}));
vi.mock("../../server/storage/unified-options", async original => {
  const real = await original<any>();
  return { ...real, createUnifiedOptionsStorage: () => ({ ...real.createUnifiedOptionsStorage(), list: fixtures.options }) };
});
vi.mock("../../server/services/sitespecific/bao/dc-settings", async original => ({
  ...await original<any>(), getDcRetiredDisabilityRowMode: async () => fixtures.retired,
}));
import { storage } from "../../server/storage";
import { BaoMonthlyHoursWizard } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";

class RowLookupBaseline extends BaoMonthlyHoursWizard {
  protected async prepareValidationRows() {}
}
const existing = new Set(["123456789", "001234567"]);
function row(extra: Record<string, unknown> = {}) {
  return { ssn: "123-45-6789", firstName: "Synthetic", lastName: "Fixture", dateOfBirth: "6/8/85",
    employmentStatus: "Active", numberOfHours: "", phoneNumber: "5550100",
    addressLine1: "1 Test St", city: "Test", state: "MN", postalCode: "55401", withholdingAmount: "$1,234.50", ...extra };
}
const fixtureRows = () => [
  row(), row({ ssn: "123456789", dateOfBirth: 31206 }), row({ ssn: "1234567" }),
  row({ ssn: "700-12-3456" }), row({ ssn: "too many digits 1234567890" }),
  row({ ssn: "000-00-0000" }), row({ ssn: "" }),
  row({ dateOfBirth: "2/30/85" }), row({ numberOfHours: "-1" }), row({ addressLine1: " \t " }),
  row({ withholdingAmount: "-$1" }), row({ withholdingAmount: "abc" }),
  row({ employmentStatus: "Not mapped" }), row({ employmentStatus: "Not mapped", numberOfHours: "-1" }),
  row({ employmentStatus: "Local active" }), row({ employmentStatus: "Disability" }),
];

beforeEach(() => {
  fixtures.options.mockClear();
  fixtures.retired = "flag";
  vi.spyOn(storage.wizards, "getById").mockImplementation(async id => ({ id, entityId: id } as any));
  vi.spyOn(storage.wizards, "mergeData").mockResolvedValue({ id: "saved" } as any);
  vi.spyOn(storage.workers, "getWorkerBySSN").mockImplementation(async ssn =>
    existing.has(ssn.replace(/\D/g, "")) ? { id: "fixture" } as any : undefined);
  vi.spyOn(storage.workers, "getWorkersBySSNs").mockImplementation(async ssns =>
    new Map(ssns.filter(ssn => existing.has(ssn)).map(ssn => [ssn, { id: "fixture" } as any])));
  vi.spyOn(storage.wizardEmploymentStatusMappings, "getByEmployer").mockImplementation(async employer =>
    employer === "mapped-employer" ? [{ sourceStatus: "Local active", targetStatusId: "active" } as any] : []);
});
afterEach(() => vi.restoreAllMocks());

describe("BAO bulk lookup semantic parity", () => {
  for (const mode of ["create", "update"] as const) for (const retired of ["flag", "reject"] as const) {
    it(`${mode} / retired Disability ${retired} preserves every row outcome`, async () => {
      fixtures.retired = retired;
      const baseline = new RowLookupBaseline();
      const optimized = new BaoMonthlyHoursWizard();
      for (const feed of [baseline, optimized]) vi.spyOn(feed, "loadMappedRows").mockImplementation(async () =>
        ({ mappedRows: fixtureRows(), mode } as any));
      const old = await baseline.validateFeedData("mapped-employer");
      const current = await optimized.validateFeedData("mapped-employer");
      expect({ ...current, completedAt: null, diagnostics: null }).toEqual({ ...old, completedAt: null, diagnostics: null });
      expect(current.unmappedStatuses).toEqual(["Not mapped"]);
      expect(current.ssnWarnings).toHaveLength(2);
      expect(current.errors.some(e => e.field === "addressLine1")).toBe(true);
      expect(current.errors.some(e => e.field === "dateOfBirth")).toBe(true);
      expect(current.errors.filter(e => e.rowIndex === 12)).toEqual([]); // unmapped-only + dollar amount
      expect(current.errors.some(e => e.rowIndex === 13 && e.field === "numberOfHours")).toBe(true);
      expect(current.errors.some(e => e.rowIndex === 15)).toBe(retired === "reject");
      expect(fixtures.options).toHaveBeenCalledTimes(2); // one list per run, not per row
      expect(storage.workers.getWorkersBySSNs).toHaveBeenCalledTimes(mode === "update" ? 1 : 0);
    });
  }

  it("isolates caches and employer-scoped mappings during simultaneous runs", async () => {
    const feeds = [new BaoMonthlyHoursWizard(), new BaoMonthlyHoursWizard()];
    for (const feed of feeds) vi.spyOn(feed, "loadMappedRows").mockImplementation(async () =>
      ({ mappedRows: Array.from({ length: 500 }, () => row({ employmentStatus: "Local active" })), mode: "update" } as any));
    const [mapped, unmapped] = await Promise.all([
      feeds[0].validateFeedData("mapped-employer"), feeds[1].validateFeedData("other-employer"),
    ]);
    expect(mapped.validRows).toBe(500);
    expect(mapped.unmappedStatuses).toBeUndefined();
    expect(unmapped.validRows).toBe(500);
    expect(unmapped.unmappedStatuses).toEqual(["Local active"]);
    expect(fixtures.options).toHaveBeenCalledTimes(2);
    expect(storage.wizardEmploymentStatusMappings.getByEmployer).toHaveBeenCalledTimes(2);
    expect(storage.workers.getWorkersBySSNs).toHaveBeenCalledTimes(2);
  });
});
