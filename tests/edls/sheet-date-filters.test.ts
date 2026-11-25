import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarDateSchema } from "../../shared/calendar-date";
import { calendarDateSchema as explorerDateSchema } from "../../shared/edls-assignment-explorer";

const mocks = vi.hoisted(() => ({
  getPaginated: vi.fn(),
  getActiveOnDate: vi.fn(),
  getSheet: vi.fn(),
  getSheetAssignments: vi.fn(),
  getNextAssignments: vi.fn(),
  getAllAssignments: vi.fn(),
  jobGroupsEnabled: true,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    edlsSheets: { getPaginated: mocks.getPaginated, get: mocks.getSheet },
    edlsAssignments: {
      getBySheetId: mocks.getSheetAssignments,
      getNextAssignmentsForWorkerIds: mocks.getNextAssignments,
      getAssignmentsForWorkerIds: mocks.getAllAssignments,
    },
    dispatchJobGroups: { getActiveOnDate: mocks.getActiveOnDate },
  },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({ requireAccess: vi.fn() }));
vi.mock("../../server/modules/components", () => ({ requireComponent: vi.fn() }));
vi.mock("../../server/modules/edls/supervisor-context", () => ({
  getSupervisorContext: vi.fn(), validateSupervisorForSave: vi.fn(), getEdlsSettings: vi.fn(),
}));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: vi.fn() }));
vi.mock("../../server/services/component/cache", () => ({
  isComponentEnabledSync: () => mocks.jobGroupsEnabled,
}));

import { registerEdlsSheetsRoutes } from "../../server/modules/edls/sheets";

const handlers = new Map<string, (req: any, res: any) => Promise<void>>();
beforeAll(() => {
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(verb => [
    verb, (path: string, ...callbacks: any[]) => {
      if (verb === "get") handlers.set(path, callbacks.at(-1));
    },
  ]));
  registerEdlsSheetsRoutes(app as any, vi.fn(), vi.fn());
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobGroupsEnabled = true;
  mocks.getPaginated.mockResolvedValue({ rows: [], total: 0 });
  mocks.getActiveOnDate.mockResolvedValue([]);
});

async function request(path: string, query: Record<string, unknown>) {
  const result = { status: 200, body: undefined as any };
  const res = {
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  };
  await handlers.get(`/api/edls/${path}`)!({ query, params: { id: "sheet" } }, res);
  return result;
}

describe("sheet next assignments", () => {
  it("uses the bounded read with unique assigned workers and preserves the response envelope", async () => {
    mocks.getSheet.mockResolvedValue({ id: "sheet", ymd: "2026-06-15" });
    mocks.getSheetAssignments.mockResolvedValue([
      { workerId: "worker" }, { workerId: "none" }, { workerId: "worker" },
    ]);
    const assignment = { assignmentId: "next", ymd: "2026-06-16", sheetStatus: "reserved" };
    mocks.getNextAssignments.mockResolvedValue(new Map([["worker", assignment], ["none", null]]));
    const response = await request("sheets/:id/next-assignments", {});
    expect(mocks.getNextAssignments).toHaveBeenCalledExactlyOnceWith(["worker", "none"], "2026-06-15");
    expect(mocks.getAllAssignments).not.toHaveBeenCalled();
    expect(response).toEqual({ status: 200, body: { next: { worker: assignment, none: null } } });
  });

  it("keeps the empty-sheet response and missing-sheet refusal", async () => {
    mocks.getSheet.mockResolvedValue({ id: "sheet", ymd: "2026-06-15" });
    mocks.getSheetAssignments.mockResolvedValue([]);
    mocks.getNextAssignments.mockResolvedValue(new Map());
    expect(await request("sheets/:id/next-assignments", {})).toEqual({ status: 200, body: { next: {} } });
    mocks.getSheet.mockResolvedValue(undefined);
    mocks.getNextAssignments.mockClear();
    expect(await request("sheets/:id/next-assignments", {})).toEqual({ status: 404, body: { message: "Sheet not found" } });
    expect(mocks.getNextAssignments).not.toHaveBeenCalled();
  });
});

describe("EDLS calendar date request boundaries", () => {
  it("preserves the explorer's shared schema export", () => {
    expect(explorerDateSchema).toBe(calendarDateSchema);
  });

  const invalidDates = [
    "2026-02-30", "2025-02-29", "1900-02-29", "2026-04-31",
    "2026-00-01", "2026-13-01", "2026-01-00", "0000-01-01",
    "2026-1-01", "2026-01-01T00:00:00Z", "not-a-date", " ",
    ["2026-01-01", "2026-01-02"], { value: "2026-01-01" },
  ];
  it.each(invalidDates.map(value => [value]))("rejects invalid date input %j before storage", async value => {
    for (const field of ["dateFrom", "dateTo"]) {
      const response = await request("sheets", { [field]: value });
      expect(response.status).toBe(400);
      expect(response.body.message).toContain("valid calendar dates");
      expect(response.body.details.some((issue: any) => issue.path[0] === field)).toBe(true);
    }
    expect((await request("job-group-options", { date: value })).status).toBe(400);
    expect(mocks.getPaginated).not.toHaveBeenCalled();
    expect(mocks.getActiveOnDate).not.toHaveBeenCalled();
  });

  it.each(["2024-02-29", "2000-02-29", "2026-04-30", "0001-01-01", "9999-12-31"])(
    "forwards valid date %s unchanged", async date => {
      expect((await request("sheets", { dateFrom: date, dateTo: date })).status).toBe(200);
      expect(mocks.getPaginated).toHaveBeenCalledWith(0, 100, expect.objectContaining({
        dateFrom: date, dateTo: date,
      }));
      expect((await request("job-group-options", { date })).status).toBe(200);
      expect(mocks.getActiveOnDate).toHaveBeenCalledWith(date);
    },
  );

  it.each([{}, { dateFrom: "", dateTo: "" }, { dateFrom: "2026-01-01" }, { dateTo: "2026-01-31" }])(
    "keeps optional and blank sheet bounds: %j", async query => {
      expect((await request("sheets", query)).status).toBe(200);
      expect(mocks.getPaginated).toHaveBeenCalledWith(0, 100, expect.objectContaining({
        dateFrom: query.dateFrom, dateTo: query.dateTo,
      }));
    },
  );

  it("still requires a date for job group options even when job groups are disabled", async () => {
    mocks.jobGroupsEnabled = false;
    for (const query of [{}, { date: "" }, { date: "2026-02-30" }]) {
      expect((await request("job-group-options", query)).status).toBe(400);
    }
    expect(await request("job-group-options", { date: "2026-02-28" })).toEqual({ status: 200, body: [] });
    expect(mocks.getActiveOnDate).not.toHaveBeenCalled();
  });
});
