import { beforeEach, expect, it, vi } from "vitest";
import type { WebServiceOperationContext } from "../../../../server/plugins/web-service/types";
import type { EdlsPassportSheet } from "../../server/storage/edls/passport-export";
import { buildPassportExportEnvelope } from "../../server/modules/webservices/edls-passport-export-mapper";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  getPage: vi.fn(),
}));
vi.mock("../../server/storage/edls/passport-export", () => ({ getEdlsPassportExportPage: mocks.getPage }));
vi.mock("../../../../server/plugins/web-service/registry", () => ({
  registerWebServicePlugin: mocks.register,
}));
await import("../../server/plugins/web-service/edls-sheet-export");
const handler = mocks.register.mock.calls[0][0].operations[0].handler;

beforeEach(() => {
  mocks.getPage.mockReset().mockResolvedValue({ total: 0, sheets: [] });
});

async function request(filter: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({
    req: { body: ["v1_sheet_export", "", "", JSON.stringify(filter)] },
    res,
  } as unknown as WebServiceOperationContext);
  return res;
}

it("passes reserved status and pagination to storage", async () => {
  await request({ status: "reserved", page: "2", limit: "10" });
  expect(mocks.getPage).toHaveBeenCalledWith({
    status: "reserved", changedSince: null, page: 2, limit: 10,
  });
});

it("leaves omitted status to the storage scheduled default", async () => {
  await request({});
  expect(mocks.getPage).toHaveBeenCalledWith({
    status: undefined, changedSince: null, page: 0, limit: 100,
  });
});

it.each(["layoff", "", "unknown", ["reserved"], 1])("rejects invalid status %j rather than returning scheduled sheets", async (status) => {
  const res = await request({ status });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(mocks.getPage).not.toHaveBeenCalled();
});

it.each([
  ["reserved", "Reserved"],
  ["lock", "Scheduled"],
  ["draft", "Draft"],
  ["request", "Requested"],
  ["trash", "Trash"],
] as const)("exports the actual %s status label", (status, label) => {
  const sheet: EdlsPassportSheet = {
    id: "sheet", status, title: "Sheet", ymd: "2026-11-19", notes: null,
    changed: new Date(), workerCount: 0, assignedCount: 0,
    employerName: null, departmentName: null, facilityName: null,
    jobGroupName: null, showStatusName: null, supervisorUser: null,
    creatorUser: null, latestSnapshotId: null, crews: [],
  };
  const result = buildPassportExportEnvelope({ sheets: [sheet], total: 1 }, { page: 0, limit: 100 });
  expect(result.data.data.sheets[0].status).toBe(label);
  expect(result.data.data.paging.total_records).toBe("1");
});
