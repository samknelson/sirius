import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWorkerSsnListRoutes } from "../../server/modules/workers/ssn-list-routes";
import { registerWorkerExportRoute } from "../../server/modules/workers/export";
import type { WorkerWithDetails } from "../../server/storage/workers";

const workers = [
  { id: "one", contact_id: "contact-one", ssn: "123-45-6789", given: "One", family: "Worker" },
  { id: "two", contact_id: "contact-two", ssn: "987-65-6789", given: "Two", family: "Worker" },
  { id: "three", contact_id: "contact-three", ssn: "111-22-3333", given: "Three", family: "Worker" },
];
const list = vi.fn();
const allIds = vi.fn();
const batch = vi.fn();
const parseFilters = vi.fn((body: Record<string, unknown>) => ({ nameIdSearch: body.nameIdSearch as string | undefined }));
let permitted = true;
let baseUrl: string;
let server: http.Server;

function matches(filter: { mode: "full" | "last4"; digits: string }, name?: string) {
  return workers.filter(worker => {
    const digits = worker.ssn.replace(/\D/g, "");
    return (filter.mode === "full" ? digits === filter.digits : digits.endsWith(filter.digits))
      && (!name || worker.given === name);
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const pass: express.RequestHandler = (_req, _res, next) => next();
  const permission = (key: string): express.RequestHandler => (_req, res, next) =>
    key === "workers.ssn" && !permitted ? res.status(403).json({ message: "Insufficient permissions" }) : next();
  list.mockImplementation(async (params) => {
    const selected = matches(params.ssnFilter, params.nameIdSearch);
    const page = selected.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
    return { data: page.map(({ ssn: _ssn, ...row }) => row), total: selected.length, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(selected.length / params.pageSize) };
  });
  allIds.mockImplementation(async (params) => matches(params.ssnFilter, params.nameIdSearch).map(row => row.contact_id));
  batch.mockImplementation(async (params, offset, limit) => matches(params.ssnFilter, params.nameIdSearch).slice(offset, offset + limit) as unknown as WorkerWithDetails[]);
  registerWorkerSsnListRoutes(app, pass, pass, permission, {
    getWorkersWithDetailsPaginated: list,
    getAllMatchingContactIds: allIds,
  }, parseFilters);
  registerWorkerExportRoute(app, pass, permission, {
    workers: { getWorkersForExportBatch: batch },
    workerIds: { getShowOnListsIdTypes: async () => [], getWorkerIdsForListByWorkerIds: async () => [] },
    employers: { getByIds: async () => [] },
    getMemberStatusOptions: async () => [],
  });
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
  permitted = true;
  list.mockClear();
  allIds.mockClear();
  batch.mockClear();
  parseFilters.mockClear();
});

async function post(path: string, body: object) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("SSN worker list routes", () => {
  it.each([
    ["123-45-6789", "full", 1],
    ["123456789", "full", 1],
    ["6789", "last4", 2],
    ["67-89", "last4", 2],
  ])("keeps list, count, all matching IDs, and export aligned for %s", async (ssn, mode, count) => {
    const input = { ssn, page: 1, pageSize: 1 };
    const pageOne = await post("/api/workers/with-details/paginated", input);
    const first = await pageOne.json();
    expect(first.total).toBe(count);
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).not.toHaveProperty("ssn");
    const pageTwo = await (await post("/api/workers/with-details/paginated", { ...input, page: 2 })).json();
    expect(pageTwo.data).toHaveLength(count - 1);
    const ids = await (await post("/api/workers/with-details/all-ids", input)).json();
    expect(ids.total).toBe(count);
    expect(ids.contactIds).toHaveLength(count);
    const exportResponse = await post("/api/workers/export", input);
    const csv = await exportResponse.text();
    expect(exportResponse.status).toBe(200);
    expect(csv.split("\n").filter(line => line.includes("Worker"))).toHaveLength(count);
    expect(csv).not.toContain("SSN");
    expect(list.mock.calls[0][0].ssnFilter).toEqual({ mode, digits: ssn.replace(/\D/g, "") });
    expect(allIds.mock.calls[0][0].ssnFilter).toEqual(list.mock.calls[0][0].ssnFilter);
    expect(batch.mock.calls[0][0].ssnFilter).toEqual(list.mock.calls[0][0].ssnFilter);
  });

  it("refuses unauthorized crafted requests before calling storage or parsing filters", async () => {
    permitted = false;
    for (const path of ["/api/workers/with-details/paginated", "/api/workers/with-details/all-ids", "/api/workers/export"]) {
      const response = await post(path, { ssn: "123456789" });
      expect(response.status).toBe(403);
    }
    expect(list).not.toHaveBeenCalled();
    expect(allIds).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(parseFilters).not.toHaveBeenCalled();
  });

  it("refuses fragments without silently returning an unfiltered list", async () => {
    for (const path of ["/api/workers/with-details/paginated", "/api/workers/with-details/all-ids", "/api/workers/export"]) {
      const response = await post(path, { ssn: "12345" });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("12345");
    }
    expect(list).not.toHaveBeenCalled();
    expect(allIds).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });
});