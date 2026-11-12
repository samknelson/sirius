import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  storage: {} as any, plugin: null as any,
  csv: "SSN,First,Last,Status,Hours,Legal,Other\n123456789,Existing,Worker,Active,10,Yes,Yes\n234567891,New,Worker,Active,20,Yes,No\n234-56-7891,New,Worker,Active,20,Yes,No\n",
}));
vi.mock("../../server/storage", () => ({ storage: mock.storage }));
vi.mock("../../server/storage/database", () => ({ storage: mock.storage }));
vi.mock("../../server/services/files", () => ({ fileSystemService: {
  download: async () => Buffer.from(mock.csv),
  upload: async () => ({ storagePath: "results", size: 1 }),
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
let wizard: any, workers: any[], grants: any[], entries: any[], accounts: any[];
function config(id: string, account: string, benefitId: string, rate: number, scope: string, offset = -3) {
  return { config: { id, enabled: true, pluginId: "gbhet-legal-benefit", data: {
    benefitId, rateHistory: [{ effectiveDate: "2020-01-01", rate }], billingOffsetMonths: offset,
  } }, subsidiary: { scope, account, employerId: scope === "employer" ? "employer" : null } };
}
beforeEach(() => {
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
    contacts: { getContact: async () => ({ displayName: "Worker" }) },
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
        getByChargePluginKey: async (_plugin: string, key: string) => entries.find(e => e.chargePluginKey === key),
        getByReference: async (_type: string, id: string) => entries.filter(e => e.referenceId === id),
        create: vi.fn(async (entry) => { const saved = { ...entry, id: `entry-${entries.length}` }; entries.push(saved); return saved; }),
      },
      invoices: { getDetails: async () => ({ entries: [] }) },
    },
  });
});

describe.each([gbhetLegalWorkersMonthly, gbhetLegalWorkersCorrections])("$name preview/processing parity", feed => {
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
});
