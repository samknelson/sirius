import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wizard } from "../../shared/schema";

const state = vi.hoisted(() => ({
  worker: vi.fn(), exists: vi.fn(), search: vi.fn(), account: vi.fn(), entry: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  workers: { getWorkerBySSN: state.worker },
  trust: { wmb: { workerBenefitExists: state.exists } },
  trustBenefits: { getActiveTrustBenefitOptions: async () => [{ id: "11111111-1111-4111-8111-111111111111" }, { id: "22222222-2222-4222-8222-222222222222" }] },
  pluginConfigs: { search: state.search },
  ledger: { ea: { getByEntityAndAccount: state.account }, entries: { getByChargePluginKey: state.entry } },
} }));
import { forecastLegalUpload, legalEligible, legalBenefitMonth } from "../../server/plugins/wizards/gbhet-legal-forecast";
import { legalBenefitPrice } from "../../server/plugins/ledger/charge/gbhet-legal-pricing";
import type { GbhetLegalWorkersWizard } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers";

const benefit = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function config(id: string, account = "a", rate = 20, scope = "global", benefitId = benefit, offset = -3) {
  return { config: { id, enabled: true, pluginId: "gbhet-legal-benefit", data: {
    benefitId, rateHistory: [{ effectiveDate: "2020-01-01", rate }], billingOffsetMonths: offset,
  } }, subsidiary: { scope, employerId: scope === "employer" ? "e" : null, account } };
}
function wizard(type = "gbhet_legal_workers_monthly"): Wizard {
  return { id: "upload", type, date: new Date(), entityId: "e", status: "draft", currentStep: "preview", data: {
    uploadedFileId: "file", mode: "create", hasHeaders: true,
    launchArguments: { year: 2026, month: 11 },
    columnMapping: { ssn: "col_0", benefit_1: "col_1", benefit_2: "col_2" },
    benefitConfig: [{ fieldId: "benefit_1", benefitId: benefit }, { fieldId: "benefit_2", benefitId: other }],
    validationResults: { invalidRows: 0 },
  } };
}
function feed(rows: any[]) {
  return {
    getFields: () => ["benefit_1", "benefit_2"].map(id => ({ id, type: "benefit", isBenefitEligibility: true })),
    readMappedRows: vi.fn(async () => rows),
    assertForecastRows: vi.fn(async () => {}),
  } as unknown as GbhetLegalWorkersWizard;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.worker.mockResolvedValue(undefined);
  state.exists.mockResolvedValue(false);
  state.account.mockResolvedValue(undefined);
  state.entry.mockResolvedValue(undefined);
  state.search.mockImplementation(async (_kind, filter) => filter.scope === "global" ? [config("g")] : []);
});

describe.each(["gbhet_legal_workers_monthly", "gbhet_legal_workers_corrections"])("%s read-only forecast", type => {
  it("normalizes duplicate identities, counts workers distinctly and grants separately", async () => {
    const result = await forecastLegalUpload(feed([
      { ssn: "123-45-6789", benefit_1: "yes", benefit_2: "x" },
      { ssn: "123456789", benefit_1: "1", benefit_2: "No" },
      { ssn: "345-67-8912", benefit_1: "n", benefit_2: "" },
    ]), wizard(type));
    expect(result).toMatchObject({ newWorkers: 2, workersWithNewGrants: 1, newGrants: 2, knownChargeTotal: "20.00", unpriceableGrants: 1 });
    expect(new Set(state.worker.mock.calls.map(call => call[0]))).toEqual(new Set(["123456789", "345678912"]));
    expect(JSON.stringify(result)).not.toContain("123456789");
    // The storage double has no write functions. Any write would throw.
  });
  it("skips existing grants even across employers and update mode creates no new workers", async () => {
    state.worker.mockResolvedValue({ id: "existing" });
    state.exists.mockResolvedValue(true);
    const w = wizard(type); (w.data as any).mode = "update";
    const result = await forecastLegalUpload(feed([{ ssn: "123456789", benefit_1: "yes" }]), w);
    expect(result).toMatchObject({ newWorkers: 0, newGrants: 0, existingGrantSkips: 1, knownChargeTotal: "0.00" });
    expect(state.exists).toHaveBeenCalledWith("existing", benefit, 2, 2027);
  });
});

it("uses all account-scoped overrides with independent billing periods", async () => {
  state.search.mockImplementation(async (_kind, filter) => filter.scope === "global"
    ? [config("g"), config("b", "b", 7, "global", benefit, -2)]
    : [config("override", "a", 30, "employer")]);
  const result = await forecastLegalUpload(feed([{ ssn: "123456789", benefit_1: "x" }]), wizard());
  expect(result.knownChargeTotal).toBe("37.00");
  expect(result.chargeGroups).toEqual(expect.arrayContaining([
    { accountId: "a", year: 2026, month: 11, amount: 30 },
    { accountId: "b", year: 2026, month: 12, amount: 7 },
  ]));
});
it("binds approval to changing rates, workers, grant state and mapping inputs", async () => {
  const f = feed([{ ssn: "123456789", benefit_1: "x" }]), w = wizard();
  const first = await forecastLegalUpload(f, w);
  state.search.mockImplementation(async (_kind, filter) => filter.scope === "global" ? [config("g", "a", 25)] : []);
  expect((await forecastLegalUpload(f, w)).fingerprint).not.toBe(first.fingerprint);
  state.worker.mockResolvedValue({ id: "created-elsewhere" });
  expect((await forecastLegalUpload(f, w)).newWorkers).toBe(0);
  state.exists.mockResolvedValue(true);
  expect((await forecastLegalUpload(f, w)).workersWithNewGrants).toBe(0);
});
it("rejects missing validation and does not confuse missing prices with configured zero", async () => {
  const w = wizard(); (w.data as any).validationResults = null;
  await expect(forecastLegalUpload(feed([]), w)).rejects.toThrow("validate");
  const settings = (config("g", "a", 0).config.data);
  expect(legalBenefitPrice(settings, 2027, 2)?.amount).toBe("0.00");
  expect(legalBenefitPrice({ ...settings, rateHistory: [{ effectiveDate: "2030-01-01", rate: 20 }] }, 2027, 2)).toBeNull();
  expect(legalBenefitPrice({ ...settings, rateHistory: [] }, 2027, 2)).toBeNull();
});
it("keeps eligibility and year rollover interpretation explicit", () => {
  expect(["", " 0 ", "no", "N", false, null, undefined].map(legalEligible)).toEqual(Array(7).fill(false));
  expect(["yes", "Y", "x", 1, "other"].map(legalEligible)).toEqual(Array(5).fill(true));
  expect(legalBenefitMonth(2026, 12)).toEqual({ year: 2027, month: 3 });
});
