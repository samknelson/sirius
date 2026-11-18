import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  storage: {} as any, plugin: null as any,
  upload: vi.fn(),
  csv: "SSN,First,Last,Status,Hours,Legal,Other\n123456789,Existing,Worker,Active,10,Yes,Yes\n234567891,New,Worker,Active,20,Yes,No\n234-56-7891,New,Worker,Active,20,Yes,No\n",
}));
vi.mock("../../server/storage", () => ({ storage: mock.storage }));
vi.mock("../../server/storage/database", () => ({ storage: mock.storage }));
vi.mock("../../server/services/files", () => ({ fileSystemService: {
  download: async () => Buffer.from(mock.csv),
  upload: mock.upload,
} }));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({
  list: async (kind: string) => kind === "employment-status" ? [{ id: "active", name: "Active", code: "A", employed: true }] : [],
}) }));
vi.mock("../../server/plugins/ledger/charge/registry", () => ({
  registerChargePlugin: (plugin: any) => { mock.plugin = plugin; },
  getEnabledChargePluginsByTrigger: async () => [mock.plugin],
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import "../../server/plugins/ledger/charge/plugins/gbhetLegalBenefit";
import { executeChargePlugins } from "../../server/plugins/ledger/charge/executor";
import { TriggerType } from "../../server/plugins/ledger/charge/types";
import { reportChargeResult } from "../../server/plugins/ledger/charge/execution-observer";
import { forecastLegalUpload } from "../../server/plugins/wizards/gbhet-legal-forecast";
import { gbhetLegalWorkersMonthly } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers_monthly";
import { gbhetLegalWorkersCorrections } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers_corrections";
const benefit = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let wizard: any, workers: any[], grants: any[], entries: any[], accounts: any[], alternateIds: any[];
function config(id: string, account: string, benefitId: string, rate: number, scope: string, offset = -3) {
  return { config: { id, enabled: true, pluginId: "gbhet-legal-benefit", data: {
    benefitId, rateHistory: [{ effectiveDate: "2020-01-01", rate }], billingOffsetMonths: offset,
  } }, subsidiary: { scope, account, employerId: scope === "employer" ? "employer" : null } };
}
beforeEach(() => {
  mock.csv = "SSN,First,Last,Status,Hours,Legal,Other\n123456789,Existing,Worker,Active,10,Yes,Yes\n234567891,New,Worker,Active,20,Yes,No\n234-56-7891,New,Worker,Active,20,Yes,No\n";
  mock.upload.mockReset().mockResolvedValue({ storagePath: "results", size: 1 });
  alternateIds = [];
  workers = [{ id: "existing", contactId: "existing-contact", ssn: "123456789" }];
  grants = [{ id: "old-grant", workerId: "existing", benefitId: benefit, year: 2027, month: 2 }];
  entries = []; accounts = [];
  wizard = { id: "upload", entityId: "employer", status: "draft", currentStep: "process", data: {
    launchArguments: { year: 2026, month: 11 }, uploadedFileId: "input",
    mode: "create", hasHeaders: true,
    columnMapping: { ssn: "col_0", firstName: "col_1", lastName: "col_2", employmentStatus: "col_3", numberOfHours: "col_4", benefit_1: "col_5", benefit_2: "col_6" },
    benefitConfig: [{ fieldId: "benefit_1", benefitId: benefit }, { fieldId: "benefit_2", benefitId: other }],
    validationResults: { invalidRows: 0 },
  } };
  Object.assign(mock.storage, {
    wizards: {
      getById: async () => structuredClone(wizard),
      update: vi.fn(async (_id, update) => { Object.assign(wizard, structuredClone(update)); return structuredClone(wizard); }),
    },
    files: {
      getById: async () => ({ id: "input", fileName: "input.csv", mimeType: "text/csv", fileSystemId: "private", storagePath: "input", uploadedBy: "uploader" }),
      create: async () => ({ id: "results" }),
    },
    workers: {
      getWorkerBySSN: async (ssn: string) => workers.find(w => w.ssn === ssn.replace(/\D/g, "")),
      getWorker: async (id: string) => workers.find(w => w.id === id),
      createWorker: vi.fn(async () => {
        const worker = { id: `new-${workers.length}`, contactId: "new-contact" };
        workers.push(worker); return worker;
      }),
      updateWorkerSSN: async (id: string, ssn: string) => Object.assign(workers.find(w => w.id === id), { ssn }),
      updateWorkerContactNameComponents: async () => {},
    },
    workerIds: {
      getWorkerIdByTypeAndValue: async (typeId: string, value: string) => alternateIds.find(id => id.typeId === typeId && id.value === value),
      createWorkerId: vi.fn(async data => { alternateIds.push(data); return data; }),
    },
    contacts: {
      getContact: async () => ({ displayName: "Worker" }),
      phoneNumbers: { getPhoneNumbersByContact: async () => [] },
      addresses: { getContactPostalByContact: async () => [] },
    },
    workerHours: { upsertWorkerHours: async () => {} },
    wizardEmploymentStatusMappings: { getByEmployer: async () => [] },
    trustBenefits: { getActiveTrustBenefitOptions: async () => [{ id: benefit }, { id: other }] },
    pluginConfigs: { search: async (_kind: string, filter: { scope: string }) => filter.scope === "global"
      ? [config("global-a", "a", benefit, 20, "global"), config("global-b", "b", other, 5, "global", -2)]
      : [config("override-a", "a", benefit, 30, "employer")] },
    trust: { wmb: {
      workerBenefitExists: async (workerId: string, benefitId: string, month: number, year: number) =>
        grants.some(g => g.workerId === workerId && g.benefitId === benefitId && g.month === month && g.year === year),
      createWorkerBenefit: vi.fn(async (data) => {
        const grant = { ...data, id: `grant-${grants.length}` }; grants.push(grant);
        const charges = await executeChargePlugins({ trigger: TriggerType.WMB_SAVED, ...data, wmbId: grant.id });
        reportChargeResult(charges);
        return grant;
      }),
    } },
    ledger: {
      accounts: { get: async (id: string) => ({ id, name: id, currencyCode: "USD" }) },
      ea: {
        getByEntityAndAccount: async (_type: string, _id: string, accountId: string) => accounts.find(a => a.accountId === accountId),
        getByEntity: async () => accounts,
        getOrCreate: async (_type: string, _id: string, accountId: string) => {
          let account = accounts.find(a => a.accountId === accountId);
          if (!account) { account = { id: `ea-${accountId}`, accountId }; accounts.push(account); }
          return account;
        },
      },
      entries: {
        getByEaId: async (id: string) => entries.filter(e => e.eaId === id),
        getByChargePluginKey: async (_plugin: string, key: string) => entries.find(e => e.chargePluginKey === key),
        getByReference: async (_type: string, id: string) => entries.filter(e => e.referenceId === id),
        create: vi.fn(async (entry) => { const saved = { ...entry, id: `entry-${entries.length}` }; entries.push(saved); return saved; }),
      },
      invoices: { getDetails: async () => ({ entries: [] }) },
    },
  });
});

describe.each([gbhetLegalWorkersMonthly, gbhetLegalWorkersCorrections])("$name preview/processing parity", feed => {
  it.each([false, true])("counts a worker once when submitted by both SSN and alternate ID (reversed: %s)", async reversed => {
    const { ALTERNATE_TAX_ID } = await import("../../shared/utils/worker-tax-identity");
    alternateIds.push({ workerId: "existing", typeId: ALTERNATE_TAX_ID, value: "000123456" });
    wizard.type = feed.name;
    const rows = [
      "123456789,Existing,Worker,Active,10,Yes,Yes",
      "000123456,Existing,Worker,Active,10,Yes,Yes",
    ];
    mock.csv = `SSN,First,Last,Status,Hours,Legal,Other\n${(reversed ? rows.reverse() : rows).join("\n")}\n`;
    const preview = await forecastLegalUpload(feed, wizard);
    expect(preview).toMatchObject({
      newWorkers: 0, workersWithNewGrants: 1, newGrants: 1, existingGrantSkips: 1, knownChargeTotal: "5.00",
    });
    const fullCsv = mock.csv;
    mock.csv = `SSN,First,Last,Status,Hours,Legal,Other\n${rows[0]}\n`;
    const singleIdentifierPreview = await forecastLegalUpload(feed, wizard);
    expect(singleIdentifierPreview.knownChargeTotal).toBe(preview.knownChargeTotal);
    expect(singleIdentifierPreview.fingerprint).not.toBe(preview.fingerprint);
    mock.csv = fullCsv;
    wizard.data.legalPreviewApproval = preview.fingerprint;
    expect(await feed.processFeedData("upload")).toMatchObject({ createdCount: 0, updatedCount: 2, failureCount: 0 });
    expect(workers).toHaveLength(1);
    expect(wizard.data.legalCompletion.population).toMatchObject({
      distinctWorkers: 1, confirmedWorkers: 1, unresolvedIdentityRows: 0,
      workersWithBenefits: 1, existingGrants: 1,
    });
    expect(wizard.data.legalCompletion.totals).toMatchObject({
      newWorkers: preview.newWorkers, workersWithNewGrants: preview.workersWithNewGrants,
      newGrants: preview.newGrants, postedAmount: preview.knownChargeTotal, postedCharges: 1,
    });
    expect(JSON.stringify([preview, wizard.data.legalCompletion])).not.toContain("000123456");
  });
  it("binds approval to the alternate identity even when estimated totals stay identical", async () => {
    wizard.type = feed.name;
    mock.csv = "SSN,First,Last,Status,Hours,Legal,Other\n900123456,New,Worker,Active,10,Yes,No\n";
    const first = await forecastLegalUpload(feed, wizard);
    mock.csv = mock.csv.replace("900123456", "901123456");
    const second = await forecastLegalUpload(feed, wizard);
    expect(second.newWorkers).toBe(first.newWorkers);
    expect(second.knownChargeTotal).toBe(first.knownChargeTotal);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(JSON.stringify([first, second])).not.toMatch(/900123456|901123456/);
  });
  it("counts alternate matches and creations, masks results, and retains a corrected SSN on reimport", async () => {
    mock.csv = "SSN,First,Last,Status,Hours,Legal,Other\n000123456,Existing,Worker,Active,10,Yes,Yes\n900-12-3456,New,Worker,Active,20,Yes,No\n900123456,New,Worker,Active,20,Yes,No\n";
    const { ALTERNATE_TAX_ID } = await import("../../shared/utils/worker-tax-identity");
    alternateIds.push({ workerId: "existing", typeId: ALTERNATE_TAX_ID, value: "000123456" });
    wizard.type = feed.name;
    const preview = await forecastLegalUpload(feed, wizard);
    expect(preview).toMatchObject({ newWorkers: 1, workersWithNewGrants: 2, newGrants: 2, knownChargeTotal: "35.00" });
    wizard.data.legalPreviewApproval = preview.fingerprint;
    const result = await feed.processFeedData("upload");
    expect(result).toMatchObject({ createdCount: 1, updatedCount: 2, failureCount: 0 });
    expect(workers).toHaveLength(2);
    expect(wizard.data.legalCompletion.population).toMatchObject({
      distinctWorkers: 2, confirmedWorkers: 2, unresolvedIdentityRows: 0,
      contactDifferences: { workers: 0 },
    });
    expect(workers[0].ssn).toBe("123456789");
    expect(workers[1].ssn).toBeUndefined();
    expect(alternateIds).toHaveLength(2);
    expect(wizard.data.legalCompletion.totals).toMatchObject({ newWorkers: 1, newGrants: 2, postedAmount: "35.00" });
    const safeOutputs = JSON.stringify([result, wizard.data.legalCompletion, preview])
      + mock.upload.mock.calls.map(call => call[0].fileContent.toString()).join("");
    expect(safeOutputs).not.toMatch(/000123456|900-12-3456|900123456/);
    wizard.data.legalPreviewApproval = (await forecastLegalUpload(feed, wizard)).fingerprint;
    expect((await feed.processFeedData("upload")).createdCount).toBe(0);
    expect(workers).toHaveLength(2);
  });
  it("requires correction for placeholders and conflicting rows before any worker or grant write", async () => {
    mock.csv = "SSN,First,Last,Status,Hours,Legal,Other\n999-99-9999,New,Worker,Active,10,Yes,No\n";
    wizard.type = feed.name;
    const validation = await feed.validateFeedData("upload");
    expect(validation.invalidRows).toBe(1);
    expect(validation.errors.some(error => error.message.includes("placeholder"))).toBe(true);
    expect(JSON.stringify(validation)).not.toContain("999-99-9999");
    await expect(forecastLegalUpload(feed, wizard)).rejects.toThrow("validate");
    expect(mock.storage.workers.createWorker).not.toHaveBeenCalled();
    expect(mock.storage.trust.wmb.createWorkerBenefit).not.toHaveBeenCalled();
    mock.csv = "SSN,First,Last,Status,Hours,Legal,Other\n900123456,One,Worker,Active,10,Yes,No\n900-12-3456,Other,Worker,Active,10,Yes,No\n";
    expect((await feed.validateFeedData("upload")).invalidRows).toBe(2);
    expect(mock.storage.workers.createWorker).not.toHaveBeenCalled();
  });
  it("performs no preview writes, then creates exactly the forecast workers/grants/charges and invoice periods", async () => {
    wizard.type = feed.name;
    const preview = await forecastLegalUpload(feed, wizard);
    expect(preview).toMatchObject({ newWorkers: 1, workersWithNewGrants: 2, newGrants: 2, existingGrantSkips: 1, knownChargeTotal: "35.00", unpriceableGrants: 0 });
    expect(mock.storage.wizards.update).not.toHaveBeenCalled();
    expect(mock.storage.workers.createWorker).not.toHaveBeenCalled();
    expect(mock.storage.trust.wmb.createWorkerBenefit).not.toHaveBeenCalled();
    expect(mock.storage.ledger.entries.create).not.toHaveBeenCalled();
    expect(accounts).toEqual([]);
    wizard.data.legalPreviewApproval = preview.fingerprint;
    const result = await feed.processFeedData("upload");
    expect(result.failureCount).toBe(0);
    expect(workers).toHaveLength(2);
    expect(grants).toHaveLength(3);
    expect(entries.map(e => e.amount).sort()).toEqual(["30.00", "5.00"]);
    expect(wizard.data.legalCompletion.totals).toMatchObject({
      newWorkers: preview.newWorkers, workersWithNewGrants: preview.workersWithNewGrants,
      newGrants: preview.newGrants, postedAmount: preview.knownChargeTotal, postedCharges: 2,
    });
    expect(wizard.data.legalCompletion.invoices.map((i: { path: string }) => i.path).sort()).toEqual([
      "/ea/ea-a/invoices/11/2026", "/ea/ea-b/invoices/12/2026",
    ]);
    // The old approval cannot authorize another run after grants changed.
    await expect(feed.processFeedData("upload")).rejects.toThrow("approve");
  });
  it("records a swallowed charge-write failure without inventing a successful invoice", async () => {
    wizard.type = feed.name;
    const forecast = await forecastLegalUpload(feed, wizard);
    wizard.data.legalPreviewApproval = forecast.fingerprint;
    mock.storage.ledger.entries.create.mockRejectedValueOnce(new Error("ledger write failed"));
    await feed.processFeedData("upload");
    expect(wizard.data.legalCompletion.totals).toMatchObject({
      chargeFailures: 1, postedCharges: 1, postedAmount: "30.00",
    });
    expect(wizard.data.legalCompletion.invoices.map((invoice: { path: string }) => invoice.path)).toEqual(["/ea/ea-a/invoices/11/2026"]);
  });
  it("retains actual alternate-worker creation when subsequent row writes fail, without calling it a confirmed benefit absence", async () => {
    wizard.type = feed.name;
    mock.csv = mock.csv.replaceAll("234567891", "900123456").replaceAll("234-56-7891", "900-12-3456");
    wizard.data.legalPreviewApproval = (await forecastLegalUpload(feed, wizard)).fingerprint;
    mock.storage.workers.updateWorkerContactNameComponents = async (id: string) => {
      if (id !== "existing") throw new Error("Contact update failed");
    };
    const result = await feed.processFeedData("upload");
    expect(result).toMatchObject({ successCount: 1, failureCount: 2 });
    expect(wizard.data.legalCompletion.totals).toMatchObject({ newWorkers: 1, failedRows: 2 });
    expect(wizard.data.legalCompletion.population).toMatchObject({
      distinctWorkers: 2, confirmedWorkers: 1, unconfirmedWorkers: 1,
      workersWithoutBenefits: 0, unresolvedRows: 2, unresolvedIdentityRows: 0,
    });
    expect(JSON.stringify(wizard.data.legalCompletion)).not.toMatch(/900123456|900-12-3456/);
  });
});
