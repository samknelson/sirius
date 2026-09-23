import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { parse } from "csv-parse/sync";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWorkerExportRoute } from "../../server/modules/workers/export";
import { parseWorkerSsnFilter } from "../../server/modules/workers/ssn-filter";
import type { WorkerWithDetails } from "../../server/storage/workers";

const batchCalls: Array<{
  params: Record<string, unknown>;
  offset: number;
  limit: number;
}> = [];
const workerIdCalls: string[][] = [];
const employerIdCalls: string[][] = [];
let rows: WorkerWithDetails[] = [];
let getBatch: ReturnType<typeof vi.fn>;
let baseUrl = "";
let server: http.Server;

function makeWorker(index: number, extra: Record<string, unknown> = {}) {
  return {
    id: `worker-${index}`,
    sirius_id: index,
    contact_id: `contact-${index}`,
    ssn: index === 1 ? "123456789" : null,
    denorm_ws_id: null,
    denorm_job_title: index === 1 ? 'Cook, "Lead"' : "Cook",
    denorm_home_employer_id: "employer-1",
    denorm_employer_ids: ["employer-1"],
    contact_name: `Family ${index}`,
    contact_email: index === 1 ? "ada@example.com" : `worker-${index}@example.com`,
    given: index === 1 ? 'Ada, "A"' : `Given ${index}`,
    middle: index === 1 ? "M" : null,
    family: index === 1 ? "Lovelace" : `Family ${index}`,
    phone_number: "555-0100",
    is_primary: true,
    address_id: null,
    address_friendly_name: null,
    address_street: index === 1 ? "1 Main\nSuite 2" : "1 Main",
    address_city: "London",
    address_state: "LDN",
    address_postal_code: "NW1",
    work_status_name: "Active",
    address_country: "UK",
    address_is_primary: true,
    bargaining_unit_name: "Unit A",
    benefit_types: [],
    benefit_ids: [],
    benefits: index === 1
      ? [{ id: "benefit-1", name: "Medical, Core", typeName: "Medical", typeIcon: null, color: null }]
      : [],
    denorm_ms_ids: ["member-status-1"],
    ...extra,
  } as unknown as WorkerWithDetails;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const passThrough: any = (_req: any, _res: any, next: any) => next();
  getBatch = vi.fn(async (params: Record<string, unknown>, offset: number, limit: number) => {
    batchCalls.push({ params, offset, limit });
    return rows.slice(offset, offset + limit);
  });

  registerWorkerExportRoute(app, passThrough, () => passThrough, {
    workers: { getWorkersForExportBatch: getBatch as any },
    workerIds: {
      getShowOnListsIdTypes: vi.fn(async () => [{ id: "employee-id", name: "Employee ID" }]),
      getWorkerIdsForListByWorkerIds: vi.fn(async (ids: string[]) => {
        workerIdCalls.push(ids);
        return ids.map((workerId) => ({
          workerId,
          typeId: "employee-id",
          value: `E-${workerId}`,
        }));
      }),
    },
    employers: {
      getByIds: vi.fn(async (ids: string[]) => {
        employerIdCalls.push(ids);
        return ids.map((id) => ({
          id,
          name: "Acme, Inc.",
          siriusId: null,
          isActive: true,
          typeId: null,
          industryId: null,
          denormPolicyId: null,
          businessCalendarId: null,
        }));
      }),
    },
    getMemberStatusOptions: vi.fn(async () => [
      { id: "member-status-1", name: "Good Standing" },
    ]),
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  rows = [];
  batchCalls.length = 0;
  workerIdCalls.length = 0;
  employerIdCalls.length = 0;
  getBatch.mockReset();
  getBatch.mockImplementation(async (params: Record<string, unknown>, offset: number, limit: number) => {
    batchCalls.push({ params, offset, limit });
    return rows.slice(offset, offset + limit);
  });
});

describe("GET /api/workers/export", () => {
  it("streams complete ordered batches with stable columns, enrichment, and CSV escaping", async () => {
    rows = Array.from({ length: 251 }, (_, index) => makeWorker(index + 1));

    const response = await fetch(
      `${baseUrl}/api/workers/export?nameIdSearch=Ada&contactSearch=example&sortBy=firstName&sortOrder=desc&employerId=employer-1&contactStatus=has_email&includeBenefits=true`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("workers_export_");

    const records = parse(await response.text(), { columns: true });
    expect(records).toHaveLength(251);
    const firstRecord = records[0] as Record<string, string>;
    const lastRecord = records[250] as Record<string, string>;
    expect(firstRecord).toMatchObject({
      "First Name": 'Ada, "A"',
      "Employee ID": "E-worker-1",
      "Member Status": "Good Standing",
      "Employer(s)": "Acme, Inc.",
      "Current Benefits": "Medical, Core",
    });
    expect(firstRecord.Street).toBe("1 Main\nSuite 2");
    expect(lastRecord["First Name"]).toBe("Given 251");
    expect(batchCalls.map((call) => call.offset)).toEqual([0, 250]);
    expect(batchCalls.every((call) => call.limit === 250)).toBe(true);
    expect(batchCalls[0].params).toMatchObject({
      nameIdSearch: "Ada",
      contactSearch: "example",
      sortBy: "firstName",
      sortOrder: "desc",
      employerId: "employer-1",
      contactStatus: "has_email",
      includeBenefits: true,
    });
    expect(workerIdCalls.map((ids) => ids.length)).toEqual([250, 1]);
    expect(employerIdCalls).toEqual([["employer-1"], ["employer-1"]]);
  });

  it("does not request or emit benefit data when the option is absent", async () => {
    rows = [makeWorker(1)];

    const response = await fetch(`${baseUrl}/api/workers/export`);
    const csv = await response.text();

    expect(csv).not.toContain("Current Benefits");
    expect(batchCalls[0].params).toMatchObject({ includeBenefits: false });
  });

  it("ends without another database batch after the client disconnects", async () => {
    let resolveBatch!: (value: WorkerWithDetails[]) => void;
    getBatch.mockImplementationOnce(
      () =>
        new Promise<WorkerWithDetails[]>((resolve) => {
          resolveBatch = resolve;
        }),
    );

    await new Promise<void>((resolve, reject) => {
      const request = http.get(`${baseUrl}/api/workers/export`, (response) => {
        // Headers are flushed before the first batch query. Disconnect at
        // that point, then let the in-flight read finish.
        request.destroy();
        setTimeout(() => resolveBatch([makeWorker(1)]), 25);
        resolve();
        response.on("error", () => undefined);
      });
      request.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(workerIdCalls).toHaveLength(0);
    expect(employerIdCalls).toHaveLength(0);
    expect(getBatch).toHaveBeenCalledTimes(1);
  });

  it("does not send a second response when a batch fails after streaming starts", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getBatch.mockRejectedValueOnce(new Error("batch failed"));

    const statusCode = await new Promise<number>((resolve, reject) => {
      const request = http.get(`${baseUrl}/api/workers/export`, (response) => {
        resolve(response.statusCode ?? 0);
        response.resume();
      });
      request.on("error", reject);
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(statusCode).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to export workers:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("SSN-filtered worker exports", () => {
  it("normalizes full and last-four input, and rejects unsupported fragments without reading rows", async () => {
    expect(parseWorkerSsnFilter(" 123-45-6789 ")).toEqual({ mode: "full", digits: "123456789" });
    expect(parseWorkerSsnFilter("67-89")).toEqual({ mode: "last4", digits: "6789" });
    for (const fragment of ["123", "12345", "12345678", "1234567890", "12x4", ""]) {
      expect(() => parseWorkerSsnFilter(fragment)).toThrow("Enter a full SSN or exactly the last four digits.");
      const response = await fetch(`${baseUrl}/api/workers/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssn: fragment }),
      });
      expect(response.status).toBe(400);
    }
    expect(getBatch).not.toHaveBeenCalled();
  });

  it("uses a body-only filter on every export batch without exposing the matching SSN", async () => {
    rows = [makeWorker(1)];
    const response = await fetch(`${baseUrl}/api/workers/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ssn: "123-45-6789", nameIdSearch: "Ada", includeBenefits: true }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const records = parse(text, { columns: true }) as Record<string, string>[];
    expect(records).toHaveLength(1);
    expect(records[0]["First Name"]).toBe('Ada, "A"');
    expect(records[0]).not.toHaveProperty("SSN");
    expect(text).not.toContain("123456789");
    expect(text).not.toContain("123-45-6789");
    expect(batchCalls[0].params).toMatchObject({
      ssnFilter: { mode: "full", digits: "123456789" },
      nameIdSearch: "Ada",
      includeBenefits: true,
    });

    const lastFour = await fetch(`${baseUrl}/api/workers/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ssn: "6789" }),
    });
    expect(lastFour.status).toBe(200);
    expect(batchCalls.at(-1)?.params.ssnFilter).toEqual({ mode: "last4", digits: "6789" });
  });

  it("refuses query-string SSNs even on the legacy export", async () => {
    const response = await fetch(`${baseUrl}/api/workers/export?ssn=123456789`);
    expect(response.status).toBe(400);
    expect(getBatch).not.toHaveBeenCalled();
  });
});