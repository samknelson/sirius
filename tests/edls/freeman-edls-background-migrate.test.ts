import { beforeEach, describe, expect, it, vi } from "vitest";

const variables = new Map<string, { id: string; name: string; value: unknown }>();
const wcRequest = vi.fn();
const release = vi.fn(async () => {});
let lockAvailable = true;
let resetCounts = { workers: 3, sheets: 2, crews: 4, assignments: 5 };
const resetPlan = () => ({ counts: { ...resetCounts }, blockers: [], preservations: [] });
const executeFullReset = vi.fn(async (_expected: ReturnType<typeof resetPlan>) => ({
  ...resetCounts,
  workerEdls: 3,
  grievanceAssociations: 1,
  contactsDeleted: 2,
  contactsAnonymized: 1,
  contactsPreserved: 0,
}));

const storage = {
  variables: {
    getByName: vi.fn(async (name: string) => variables.get(name)),
    create: vi.fn(async ({ name, value }: { name: string; value: unknown }) => {
      const row = { id: name, name, value };
      variables.set(name, row);
      return row;
    }),
    update: vi.fn(async (id: string, { value }: { value: unknown }) => {
      const row = variables.get(id);
      if (row) row.value = value;
      return row;
    }),
  },
  advisoryLock: {
    tryAcquireSession: vi.fn(async () => lockAvailable ? { release } : null),
  },
  employers: {
    getEmployer: vi.fn(async () => ({ id: "employer-1" })),
  },
  workerIds: {
    getTypeIdBySiriusId: vi.fn(async (siriusId: string) => `${siriusId}-type`),
  },
  freemanEdlsFullReset: {
    getCounts: vi.fn(async () => ({ ...resetCounts })),
    getPlan: vi.fn(async () => resetPlan()),
    execute: executeFullReset,
  },
};

vi.mock("../../server/storage", () => ({ storage }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: vi.fn(),
  runInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
vi.mock("../../server/storage/edls/sheets", () => ({ validate: vi.fn() }));
vi.mock("../../server/services/webclient", () => ({ wcRequest }));
vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/middleware/request-context", () => ({
  withNotificationsSuppressed: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/modules/edls/supervisor-context", () => ({
  getEdlsSettings: vi.fn(async () => ({ employer: "employer-1" })),
}));
vi.mock("../../server/plugins/system/denorm/registry", () => ({
  recomputeDenormEntity: vi.fn(),
}));
vi.mock("../../server/plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate", () => ({
  FREEMAN_EDLS_FETCH_SHEETS_OPERATION: "fetch",
  FREEMAN_EDLS_MIGRATE_PLUGIN_ID: "freeman",
}));
vi.mock("../../shared/schema", () => ({
  dispatchJobGroups: {}, edlsAssignments: {}, edlsCrews: {}, edlsSheets: {},
  optionsClassifications: {}, optionsDepartment: {}, optionsEdlsShowStatus: {},
  optionsEdlsTasks: {}, optionsEmploymentStatus: {}, facilities: {}, users: {},
  workerHours: {}, workers: {},
}));

const migration = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");

function successfulEmptyPage() {
  return {
    source: "network",
    outcome: "success",
    value: {
      success: true,
      data: { success: true, data: { success: true, data: { sheets: [] } } },
    },
  };
}

async function waitForLifecycle(expected: string) {
  for (let index = 0; index < 100; index++) {
    const status = await migration.getFreemanMigrateStatus();
    if (status.run.lifecycle === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Migration did not reach ${expected}`);
}

beforeEach(async () => {
  variables.clear();
  vi.clearAllMocks();
  lockAvailable = true;
  resetCounts = { workers: 3, sheets: 2, crews: 4, assignments: 5 };
  wcRequest.mockResolvedValue(successfulEmptyPage());
  await migration.resetFreemanMigrateStatus();
});

describe("Freeman EDLS full reset control", () => {
  it("requires the exact typed confirmation", async () => {
    const preflight = await migration.getFreemanEdlsFullResetPreflight();

    await expect(migration.executeFreemanEdlsFullReset({
      confirmation: "delete all workers",
      snapshot: preflight.snapshot,
    })).rejects.toThrow();
    expect(executeFullReset).not.toHaveBeenCalled();
  });

  it("refuses execution when preflight counts are stale", async () => {
    const preflight = await migration.getFreemanEdlsFullResetPreflight();
    resetCounts = { ...resetCounts, workers: resetCounts.workers + 1 };

    await expect(migration.executeFreemanEdlsFullReset({
      confirmation: migration.FREEMAN_EDLS_FULL_RESET_CONFIRMATION,
      snapshot: preflight.snapshot,
    })).rejects.toThrow(/counts changed/i);
    expect(executeFullReset).not.toHaveBeenCalled();
  });

  it("refuses preflight and execution while a live import is active", async () => {
    const now = new Date().toISOString();
    variables.set(migration.FREEMAN_MIGRATE_RUN_VARIABLE, {
      id: migration.FREEMAN_MIGRATE_RUN_VARIABLE,
      name: migration.FREEMAN_MIGRATE_RUN_VARIABLE,
      value: JSON.stringify({
        lifecycle: "running", limit: 10, stopRequested: false,
        startedAt: now, finishedAt: null, heartbeatAt: now, batchCount: 0,
        totals: {
          fetched: 0, valid: 0, created: 0, updated: 0, failed: 0,
          records: {
            crews: { created: 0, updated: 0 },
            assignments: { created: 0, updated: 0 },
            workers: { created: 0, updated: 0 },
          },
        },
        latestBatch: null, error: null,
      }),
    });

    await expect(migration.getFreemanEdlsFullResetPreflight()).rejects.toThrow(/active/i);
    await expect(migration.executeFreemanEdlsFullReset({
      confirmation: migration.FREEMAN_EDLS_FULL_RESET_CONFIRMATION,
      snapshot: "0".repeat(64),
    })).rejects.toThrow(/active/i);
    expect(executeFullReset).not.toHaveBeenCalled();
  });

  it("executes with fresh counts and returns authoritative deleted counts", async () => {
    const preflight = await migration.getFreemanEdlsFullResetPreflight();
    const result = await migration.executeFreemanEdlsFullReset({
      confirmation: migration.FREEMAN_EDLS_FULL_RESET_CONFIRMATION,
      snapshot: preflight.snapshot,
    });

    expect(result.deleted).toEqual({
      workers: 3,
      sheets: 2,
      crews: 4,
      assignments: 5,
      workerEdls: 3,
      grievanceAssociations: 1,
      contactsDeleted: 2,
      contactsAnonymized: 1,
      contactsPreserved: 0,
    });
    expect(executeFullReset).toHaveBeenCalledWith(resetPlan());
  });
});

describe("Freeman background migration control", () => {
  it("persists completion, cumulative progress, and the latest batch", async () => {
    await migration.startFreemanMigrate({ limit: 25 });
    const status = await waitForLifecycle("completed");

    expect(status.run.limit).toBe(25);
    expect(status.run.batchCount).toBe(1);
    expect(status.run.totals.fetched).toBe(0);
    expect(status.run.latestBatch).toMatchObject({ mode: "live", limit: 25 });
    expect(status.run.finishedAt).toBeTruthy();
  });

  it("refuses a duplicate start while the active batch is waiting", async () => {
    let answer!: (value: unknown) => void;
    wcRequest.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));

    await migration.startFreemanMigrate({ limit: 10 });
    while (wcRequest.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    await expect(migration.startFreemanMigrate({ limit: 10 }))
      .rejects.toThrow("already in progress");
    answer(successfulEmptyPage());
    await waitForLifecycle("completed");
  });

  it("finishes the active batch and then records a requested stop", async () => {
    let answer!: (value: unknown) => void;
    wcRequest.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));

    await migration.startFreemanMigrate({ limit: 10 });
    while (wcRequest.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const stopping = await migration.stopFreemanMigrate();
    expect(stopping.run.lifecycle).toBe("stopping");

    answer(successfulEmptyPage());
    const stopped = await waitForLifecycle("stopped");
    expect(stopped.run.batchCount).toBe(1);
    expect(stopped.run.latestBatch).toBeTruthy();
  });

  it("resumes from the persisted cursor", async () => {
    const cursors = await migration.getFreemanMigrateStatus();
    const state = {
      statuses: {
        ...cursors.statuses,
        draft: { ...cursors.statuses.draft, page: 7 },
      },
    };
    variables.set(migration.FREEMAN_MIGRATE_STATUS_VARIABLE, {
      id: migration.FREEMAN_MIGRATE_STATUS_VARIABLE,
      name: migration.FREEMAN_MIGRATE_STATUS_VARIABLE,
      value: JSON.stringify(state),
    });

    await migration.startFreemanMigrate({ limit: 12 });
    await waitForLifecycle("completed");
    expect(wcRequest.mock.calls[0][0].args).toMatchObject({ status: "draft", page: 7, limit: 12 });
  });

  it("recovers a stale active state as an interrupted failure", async () => {
    const stale = {
      lifecycle: "running", limit: 10, stopRequested: false,
      startedAt: "2020-01-01T00:00:00.000Z", finishedAt: null,
      heartbeatAt: "2020-01-01T00:00:00.000Z", batchCount: 2,
      totals: {
        fetched: 10, valid: 10, created: 10, updated: 0, failed: 0,
        records: {
          crews: { created: 1, updated: 0 },
          assignments: { created: 1, updated: 0 },
          workers: { created: 1, updated: 0 },
        },
      },
      latestBatch: null, error: null,
    };
    variables.set(migration.FREEMAN_MIGRATE_RUN_VARIABLE, {
      id: migration.FREEMAN_MIGRATE_RUN_VARIABLE,
      name: migration.FREEMAN_MIGRATE_RUN_VARIABLE,
      value: JSON.stringify(stale),
    });

    const recovered = await migration.getFreemanMigrateStatus();
    expect(recovered.run.lifecycle).toBe("failed");
    expect(recovered.run.error).toMatch(/interrupted/i);
    expect(recovered.run.totals.fetched).toBe(10);
  });
});