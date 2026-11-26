import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { edlsSheetStatusEnum, edlsSheets } from "../../shared/schema/edls/schema";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  recordMutation: vi.fn(),
  capture: vi.fn(),
  emit: vi.fn(async () => {}),
  crews: {
    getBySheetId: vi.fn(async () => []),
    createMany: vi.fn(async () => []),
  },
  release: vi.fn(),
}));
vi.mock("../../../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
  runInTransaction: (callback: () => unknown) => callback(),
  runInSavepoint: (callback: () => unknown) => callback(),
  onAfterCommit: (callback: () => unknown) => callback(),
}));
vi.mock("../../../../server/storage", () => ({
  storage: {
    edlsCrews: mocks.crews,
    edlsAssignments: { deleteByCrewId: mocks.release },
  },
}));
vi.mock("../../../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { recordMutation: mocks.recordMutation },
}));
vi.mock("../../../../server/services/snapshots/capture", () => ({
  captureEntitySnapshot: mocks.capture,
}));
vi.mock("../../../../server/services/event-bus", () => ({
  eventBus: { emit: mocks.emit },
  registerComponentEvent: () => "EDLS_SHEET_SAVED",
}));
vi.mock("../../../../server/services/component/cache", () => ({
  isComponentEnabledSync: () => false,
}));
vi.mock("../../../../server/storage/middleware/logging", () => ({
  defineLoggingConfig: (config: unknown) => config,
}));
vi.mock("../../../../server/middleware/request-context", () => ({
  getRequestContext: () => ({ userId: "effective-user" }),
}));
vi.mock("../../../../server/logger", () => ({
  logger: { error: vi.fn() },
}));

import { createEdlsSheetsStorage } from "../../server/storage/edls/sheets";

const storage = createEdlsSheetsStorage();
let row: Record<string, any>;
let written: Record<string, any>;
beforeEach(() => {
  vi.clearAllMocks();
  row = {
    id: "sheet", employerId: "employer", departmentId: "department", title: "Job",
    ymd: "2026-10-31", workerCount: 0, status: "draft", notificationsEnabled: true,
    data: { trashLock: true, unrelated: { nested: ["preserved"] } },
  };
  written = {};
  const returning = async () => [row];
  mocks.getClient.mockReturnValue({
    select: () => ({ from: (table: unknown) => {
      const rows = table === edlsSheets ? [row] : [];
      const query = {
        where: () => query,
        innerJoin: () => query,
        for: async () => rows,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return query;
    } }),
    update: () => ({
      set: (patch: Record<string, any>) => {
        written = patch;
        row = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
        return { where: () => ({ returning }) };
      },
    }),
    insert: () => ({
      values: (input: Record<string, any>) => {
        written = input;
        row = { id: "created", ...input };
        return { returning };
      },
    }),
  });
});

describe("EDLS storage ordinary saves and trusted writes", () => {
  it("preserves all JSON, status and notifications, ignores date changes and attributes the effective actor", async () => {
    const data = row.data;
    const result = await storage.update("sheet", { title: "Updated", ymd: "2026-11-01" });
    expect(result).toMatchObject({
      title: "Updated", ymd: "2026-10-31", status: "draft", notificationsEnabled: true, data,
    });
    expect(result?.data).toBe(data);
    for (const key of ["status", "data", "ymd", "notificationsEnabled"]) {
      expect(written).not.toHaveProperty(key);
    }
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith("EDLS_SHEET_SAVED", expect.objectContaining({
      previousStatus: "draft", newStatus: "draft",
    }));
    expect(mocks.recordMutation).toHaveBeenCalledWith(expect.objectContaining({ actorId: "effective-user" }));
  });

  it.each(edlsSheetStatusEnum)("still permits trusted creation at %s with application data", async status => {
    const input = {
      employerId: "employer", departmentId: "department", title: "Imported",
      ymd: "2026-10-31", workerCount: 0, status, data: { imported: true, trashLock: true },
    };
    const result = await storage.create(input, []);
    expect(result.status).toBe(status);
    expect(written.data).toEqual(input.data);
  });

  it("persists copied sheet and crew values with fresh identities and a database change watermark", async () => {
    const input = {
      employerId: "employer", departmentId: "department", title: "Copied",
      ymd: "2026-11-01", workerCount: 1, status: "draft",
      jobGroupId: "job-group", facilityId: "facility", showStatusId: "show-status",
      notes: "Copied notes", data: { extension: { keep: true } },
    };
    const crew = {
      id: "source-crew", title: "Crew", workerCount: 1, sequence: 0,
      startTime: "08:00", endTime: "17:00", data: { nested: [null, "", false] },
    };
    const result = await storage.create(input, [crew]);
    expect(written).toEqual({ ...input, changed: sql`now()` });
    expect(written).not.toHaveProperty("id");
    expect(written).not.toHaveProperty("notificationsEnabled");
    expect(result).toMatchObject({ ...input, id: "created" });
    const { id, ...crewData } = crew;
    expect(mocks.crews.createMany).toHaveBeenCalledExactlyOnceWith([
      { ...crewData, sheetId: "created" },
    ]);
  });

  it("still permits trusted status and JSON updates", async () => {
    const result = await storage.update("sheet", { status: "lock", data: { imported: true } });
    expect(result).toMatchObject({ status: "lock", data: { imported: true } });
    expect(mocks.emit).toHaveBeenCalledWith("EDLS_SHEET_SAVED", expect.objectContaining({
      previousStatus: "draft", newStatus: "lock",
    }));
  });

  it.each([undefined, "sheet"])("retains imported status and data on replaceFromImport(%s)", async id => {
    const result = await storage.replaceFromImport(id, {
      employerId: "employer", departmentId: "department", title: "Imported",
      ymd: "2026-10-31", workerCount: 0, status: "lock", data: { imported: true },
    }, []);
    expect(result.kind).toBe(id ? "updated" : "created");
    expect(result.sheet).toMatchObject({ status: "lock", data: { imported: true } });
  });
});
