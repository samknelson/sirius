import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const listRequestTypes = vi.fn();
const list = vi.fn();
const count = vi.fn();
const getById = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    wcCache: {
      listRequestTypes,
      list,
      count,
      getById,
    },
    wcStats: {},
  },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/webclient", () => ({
  listWcRequests: () => [],
  resolveWcCacheDurations: () => undefined,
  resolveWcDuration: (value: number) => value,
}));
vi.mock("../../server/plugins/wc-vendors/registry", () => ({
  getWcVendorPlugin: (id: string) =>
    id === "lob" ? { id: "lob", name: "Lob Mail" } : undefined,
}));

const { registerWcCacheAdminRoutes } =
  await import("../../server/modules/system/wc-cache");

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  registerWcCacheAdminRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

beforeEach(() => {
  listRequestTypes.mockReset().mockResolvedValue([]);
  list.mockReset().mockResolvedValue([]);
  count.mockReset().mockResolvedValue(0);
  getById.mockReset();
});

function cacheRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cache-1",
    service: "lob",
    configurationId: "config-1",
    configurationName: "Production mail",
    pluginId: "lob",
    requestType: "postal.verify",
    requestKey: "key",
    outcome: "success",
    fetchedAt: new Date("2026-09-14T10:00:00Z"),
    createdAt: new Date("2026-09-14T10:00:00Z"),
    ...overrides,
  };
}

describe("web client cache provenance display metadata", () => {
  it("includes connection and vendor names in filter options", async () => {
    listRequestTypes.mockResolvedValue([
      {
        service: "lob",
        configurationId: "config-1",
        configurationName: "Production mail",
        pluginId: "lob",
        requestType: "postal.verify",
        rows: 2,
      },
    ]);

    const response = await fetch(`${baseUrl}/api/admin/wc-cache/request-types`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        configurationId: "config-1",
        configurationName: "Production mail",
        vendorName: "Lob Mail",
      }),
    ]);
  });

  it("includes safe display metadata in list and detail responses", async () => {
    const row = cacheRow();
    list.mockResolvedValue([row]);
    count.mockResolvedValue(1);
    getById.mockResolvedValue({ ...row, response: { deliverable: true } });

    const listResponse = await fetch(`${baseUrl}/api/admin/wc-cache`);
    const detailResponse = await fetch(`${baseUrl}/api/admin/wc-cache/cache-1`);

    expect((await listResponse.json()).rows[0]).toEqual(
      expect.objectContaining({
        configurationName: "Production mail",
        vendorName: "Lob Mail",
      }),
    );
    expect(await detailResponse.json()).toEqual(
      expect.objectContaining({
        configurationName: "Production mail",
        vendorName: "Lob Mail",
      }),
    );
  });

  it("keeps deleted configuration rows readable without display attribution", async () => {
    const deleted = cacheRow({
      configurationName: null,
      pluginId: null,
    });
    list.mockResolvedValue([deleted]);
    count.mockResolvedValue(1);

    const response = await fetch(`${baseUrl}/api/admin/wc-cache`);
    const body = await response.json();

    expect(body.rows[0]).toEqual(
      expect.objectContaining({
        configurationId: "config-1",
        configurationName: null,
        vendorName: null,
      }),
    );
  });
});