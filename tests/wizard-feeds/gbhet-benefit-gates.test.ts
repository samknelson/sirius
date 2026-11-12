import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wizard } from "../../shared/schema";

const mocks = vi.hoisted(() => ({
  wizard: vi.fn(), options: vi.fn(), update: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  wizards: { getById: mocks.wizard, update: mocks.update },
  trustBenefits: { getActiveTrustBenefitOptions: mocks.options },
} }));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: async () => [] }),
}));
vi.mock("../../server/services/files", () => ({ fileSystemService: {} }));
vi.mock("../../server/plugins/wizards/registry", () => ({ registerWizardPlugin: vi.fn() }));

import { gbhetLegalWorkersMonthlyPlugin as monthly, gbhetLegalWorkersCorrectionsPlugin as corrections }
  from "../../server/plugins/wizards/plugins/gbhet-legal-workers";
import { gbhetLegalWorkersMonthly } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers_monthly";
import { gbhetLegalWorkersCorrections } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers_corrections";
import { FeedWizard } from "../../server/plugins/wizards/engine/feed";
import { buildMapStep } from "../../server/plugins/wizards/plugins/feed-steps";

const mapping = {
  ssn: "col_0", employmentStatus: "col_1", numberOfHours: "col_2", benefit_1: "col_3",
};
const valid = {
  mode: "update", columnMapping: mapping,
  benefitConfig: [{ fieldId: "benefit_1", benefitId: "legal" }],
  validationResults: { invalidRows: 0 },
};
const wizard = (data: unknown = valid) => ({
  id: "wizard", type: "gbhet_legal_workers_monthly", entityId: "employer", currentStep: "benefits",
  status: "draft", data,
}) as Wizard;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockResolvedValue([{ id: "legal", name: "Legal" }]);
  mocks.wizard.mockResolvedValue(wizard());
});

describe.each([monthly, corrections])("$id benefit enforcement", plugin => {
  const step = (id: string) => plugin.steps.find(step => step.id === id)!;
  it("does not complete Map or Benefits without any mapped eligibility column", async () => {
    const w = wizard({ mode: "update", columnMapping: { ssn: "col_0", employmentStatus: "col_1", numberOfHours: "col_2" }, benefitConfig: [] });
    expect(await step("map").getState!(w)).not.toBe("completed");
    expect(await step("benefits").getState!(w)).not.toBe("completed");
    await expect(Promise.resolve().then(() => step("map").submit!({
      wizard: w, input: w.data,
    } as any))).rejects.toThrow("at least one");
  });
  it("accepts one eligibility mapping in either mapping orientation", async () => {
    for (const columnMapping of [mapping, Object.fromEntries(Object.entries(mapping).map(([field, col]) => [col, field]))]) {
      const w = wizard({ ...valid, columnMapping });
      expect(await step("map").getState!(w)).toBe("completed");
      expect(await step("benefits").getState!(w)).toBe("completed");
    }
  });
  it("rechecks active benefits on readiness rather than trusting an old validation result", async () => {
    mocks.options.mockResolvedValue([]);
    expect(await step("benefits").getState!(wizard())).not.toBe("completed");
    expect(await step("validate").getState!(wizard())).not.toBe("completed");
  });
  it("refuses empty/stale associations on submit, including direct requests", async () => {
    const storage = { trustBenefits: { getActiveTrustBenefitOptions: mocks.options } };
    for (const benefitConfig of [[], [{ fieldId: "benefit_2", benefitId: "legal" }], [{ fieldId: "benefit_1", benefitId: "missing" }]]) {
      await expect(step("benefits").submit!({
        wizard: wizard(), input: { benefitConfig }, storage,
      } as any)).rejects.toThrow();
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("saving a benefit choice explicitly clears downstream approvals in a shallow-merged step result", async () => {
    const result = await step("benefits").submit!({
      wizard: wizard({ ...valid, processResults: { totalRows: 5 },
        progress: { validate: { status: "completed" }, process: { status: "completed" } } }),
      input: { benefitConfig: valid.benefitConfig },
      storage: { trustBenefits: { getActiveTrustBenefitOptions: mocks.options } },
    } as any);
    expect(result.data).toMatchObject({ validationResults: null, processResults: null, benefitConfig: valid.benefitConfig });
    expect((result.data?.progress as any).validate).toBeUndefined();
  });
  it("mapping edits invalidate validation while preserving explicitly saved choices for review", async () => {
    const result = await step("map").submit!({
      wizard: wizard(), input: { mode: "update", columnMapping: { ...mapping, benefit_1: "col_4" }, hasHeaders: true },
    } as any);
    expect(result.data).toMatchObject({ validationResults: null, benefitConfig: valid.benefitConfig });
  });
  it("direct update cannot bypass the mapping requirement or retain old validation on benefit changes", async () => {
    const old = wizard();
    const rejected = await plugin.prepareUpdate!({
      existing: old, incoming: { columnMapping: {} }, merged: { ...valid, columnMapping: {} },
    });
    expect(rejected).toMatchObject({ status: 400 });
    const updated = await plugin.prepareUpdate!({
      existing: old, incoming: { benefitConfig: valid.benefitConfig, hasHeaders: false },
      merged: { ...valid, hasHeaders: false },
    });
    expect(updated.data).toMatchObject({ validationResults: null, processResults: null });
  });
  it("leaves completed historical imports readable without retroactive configuration requirements", async () => {
    const completed = { ...wizard({ processResults: { successCount: 5 } }), status: "completed" };
    expect(await step("benefits").getState!(completed)).toBe("completed");
    expect(await step("map").getState!(completed)).toBe("completed");
    expect(mocks.options).not.toHaveBeenCalled();
  });
});

describe.each([gbhetLegalWorkersMonthly, gbhetLegalWorkersCorrections])("$name engine guards", feed => {
  it("blocks direct validation and processing before any row or file side effects", async () => {
    mocks.wizard.mockResolvedValue(wizard({ ...valid, benefitConfig: [] }));
    const validate = vi.spyOn(FeedWizard.prototype, "validateFeedData").mockRejectedValue(new Error("must not reach base validation"));
    const process = vi.spyOn(FeedWizard.prototype, "processFeedData").mockRejectedValue(new Error("must not reach base processing"));
    try {
      await expect(feed.validateFeedData("wizard")).rejects.toThrow("every mapped");
      await expect(feed.processFeedData("wizard")).rejects.toThrow("every mapped");
      expect(validate).not.toHaveBeenCalled();
      expect(process).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    } finally {
      validate.mockRestore(); process.mockRestore();
    }
  });
});

it("leaves other feed types free of the optional benefit-mapping requirement", async () => {
  const feed = { getFields: () => [{ id: "name", required: true }] } as unknown as FeedWizard;
  const map = buildMapStep(feed);
  expect(await map.getState!(wizard({ columnMapping: { name: "col_0" } }))).toBe("completed");
});
