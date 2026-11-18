import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ storage: {} as any, charges: vi.fn() }));
vi.mock("../../server/plugins/ledger/charge", () => ({
  executeChargePlugins: state.charges,
  TriggerType: { DUES_IMPORT_SAVED: "dues_import_saved" },
}));
vi.mock("../../server/storage", () => ({ storage: state.storage }));
vi.mock("../../server/storage/database", () => ({ storage: state.storage }));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: async (kind: string) =>
    kind === "worker-id-type" ? [{ id: "payroll", name: "Person Number" }]
      : [{ id: "active", name: "Active", code: "A", employed: true }] }),
}));
import { ALTERNATE_TAX_ID } from "../../shared/utils/worker-tax-identity";
import { HtaUnionImportWizard } from "../../server/plugins/wizards/engine/types/hta_union_import";
import { GbheLocal26HourlyWizard } from "../../server/plugins/wizards/engine/types/gbhe_local26_hourly";

beforeEach(() => {
  state.charges.mockReset().mockResolvedValue({ executed: [] });
  const worker = { id: "existing", ssn: "123456789", contactId: "contact" };
  Object.assign(state.storage, {
    workers: {
      getWorkerBySSN: async (value: string) => value === worker.ssn ? worker : undefined,
      getWorker: async (id: string) => id === worker.id ? worker : undefined,
    },
    workerIds: {
      getWorkerIdByTypeAndValue: async (type: string, value: string) =>
        type === ALTERNATE_TAX_ID && value === "000123456" || type === "payroll" && value === "001" ? { workerId: worker.id } : undefined,
    },
    employers: { getAllEmployers: async () => [{ id: "employer", name: "Employer" }] },
    wizards: {
      getById: async () => ({ entityId: "employer", data: { launchArguments: { year: 2026, month: 11 }, weekDates: {} } }),
      update: vi.fn(),
    },
    pluginConfigs: { search: async () => [] },
    wizardEmploymentStatusMappings: { getByEmployer: async () => [] },
    wizardWorkLocationMappings: { getByEmployer: async () => [] },
  });
});

describe("HTA and Local26 share tax identity decisions", () => {
  it("HTA update validation accepts alternate matches but refuses placeholders and unmatched values", async () => {
    const feed = new HtaUnionImportWizard();
    const row = { ssn: "000-12-3456", firstName: "Existing", lastName: "Worker", employerName: "Employer" };
    expect(await feed.validateRow({ ...row }, 0, "update")).toEqual([]);
    expect((await feed.validateRow({ ...row, ssn: "900123456" }, 0, "update")).some(error => error.message.includes("No worker"))).toBe(true);
    const invalid = await feed.validateRow({ ...row, ssn: "999-99-9999" }, 0, "create");
    expect(invalid.some(error => error.message.includes("placeholder"))).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("999-99-9999");
    const raw = { ...row, ssn: "A00123" };
    expect(await feed.validateRow(raw, 0, "create")).toEqual([]);
    expect(raw.ssn).toBe("A00123");
  });
  it("Local26 retains payroll-only matches and refuses contradictory tax assertions up front", async () => {
    const feed = new GbheLocal26HourlyWizard();
    const base: any = { fullName: "Existing Worker", employeeStatus: "Active", weeks: [], personNumber: "001", ssn: null };
    const parsed = { rows: [base], weeks: [], fileRates: {}, formatId: "generic" } as any;
    vi.spyOn(feed, "loadParsedFile").mockResolvedValue(parsed);
    const employers = [{ id: "employer", name: "Employer" }];
    expect((await feed.validateLocal26("upload", employers)).invalidRows).toBe(0);
    base.ssn = "000-12-3456";
    expect((await feed.validateLocal26("upload", employers)).invalidRows).toBe(0);
    base.ssn = "234567891";
    expect((await feed.validateLocal26("upload", employers)).errors.some(error => error.message.includes("disagree"))).toBe(true);
    base.ssn = "unknown";
    expect((await feed.validateLocal26("upload", employers)).errors.some(error => error.message.includes("placeholder"))).toBe(true);
    expect(state.storage.wizards.update).toHaveBeenCalled(); // Existing correction surface, not a new queue.
  });
  it("Local26 writes hours and dues for a normalized match to a legacy dashed SSN", async () => {
    const feed = new GbheLocal26HourlyWizard();
    const worker = { id: "existing", contactId: "contact", ssn: "123-45-6789" };
    state.storage.workers.getWorkerBySSN = async (value: string) => value === "123456789" ? worker : undefined;
    state.storage.workers.getWorker = async () => worker;
    const wizard = { entityId: "employer", data: {
      launchArguments: { year: 2026, month: 11 }, weekDates: { 1: "2026-11-06" },
      validationResults: { invalidRows: 0 },
    } };
    state.storage.wizards.getById = async () => wizard;
    state.storage.bargainingUnits = { getAllBargainingUnits: async () => [] };
    state.storage.gbhetShifts = { tableExists: async () => false };
    state.storage.workerHours = { upsertWorkerHours: vi.fn() };
    state.storage.pluginConfigs.search = async () => [{ subsidiary: { account: "dues-account" } }];
    const row = {
      ssn: "123456789", personNumber: "001", fullName: "Existing Worker", employeeStatus: "Active", shiftCount: null,
      weeks: [{ week: 1, hours: 8, dues: 12, grossPay: null, training: null, housing: null, legal: null, pension: null }],
    };
    vi.spyOn(feed, "loadParsedFile").mockResolvedValue({ rows: [row], weeks: [], fileRates: {}, formatId: "generic" } as any);
    expect((await feed.validateLocal26("upload", [{ id: "employer", name: "Employer" }])).invalidRows).toBe(0);
    const result = await feed.processLocal26("upload", [{ id: "employer", name: "Employer" }]);
    expect(result).toMatchObject({ failureCount: 0, createdCount: 0, updatedCount: 1, hoursWritten: 1, duesEventsEmitted: 1 });
    expect(state.storage.workerHours.upsertWorkerHours).toHaveBeenCalledWith(expect.objectContaining({ workerId: "existing", hours: 8 }));
    expect(state.charges).toHaveBeenCalledWith(expect.objectContaining({ workerId: "existing", amount: "12.00" }));
    expect(worker.ssn).toBe("123-45-6789");
  });
});
