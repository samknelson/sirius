import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const countsByDay = vi.fn();
const listDimensions = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    wcStats: { countsByDay, listDimensions },
    wcCache: {},
  },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/webclient", () => ({
  listWcRequests: () => [],
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
  countsByDay.mockReset().mockResolvedValue([{ ymd: "2026-09-13", calls: 7 }]);
  listDimensions.mockReset().mockResolvedValue([]);
});

async function read(query: string) {
  const response = await fetch(`${baseUrl}/api/admin/wc-stats${query}`);
  return { status: response.status, body: await response.json() };
}

describe("outgoing stats configuration filtering", () => {
  it("leaves configuration undefined for cross-vendor totals", async () => {
    const { body } = await read("?start=2026-09-13&end=2026-09-13");
    expect(body.total).toBe(7);
    expect(countsByDay).toHaveBeenCalledWith({
      start: "2026-09-13",
      end: "2026-09-13",
      service: undefined,
      requestType: undefined,
      configurationId: undefined,
    });
  });

  it("passes a selected connection through to the grouped read", async () => {
    await read(
      "?start=2026-09-13&end=2026-09-13&service=lob&requestType=verify_address&configurationId=cfg-lob",
    );
    expect(countsByDay).toHaveBeenCalledWith(
      expect.objectContaining({ configurationId: "cfg-lob" }),
    );
  });

  it("can narrow to the legacy and deleted-configuration bucket", async () => {
    await read(
      "?start=2026-09-13&end=2026-09-13&configurationId=__unattributed__",
    );
    expect(countsByDay).toHaveBeenCalledWith(
      expect.objectContaining({ configurationId: null }),
    );
  });

  it("decorates surviving configurations while retaining historical rows", async () => {
    listDimensions.mockResolvedValue([
      {
        service: "lob",
        requestType: "verify_address",
        configurationId: "cfg-lob",
        configurationName: "Production mail",
        pluginId: "lob",
      },
      {
        service: "lob",
        requestType: "verify_address",
        configurationId: null,
        configurationName: null,
        pluginId: null,
      },
    ]);

    const { body } = await read("?start=2026-09-13&end=2026-09-13");
    expect(body.dimensions).toEqual([
      expect.objectContaining({ configurationId: "cfg-lob", pluginName: "Lob Mail" }),
      expect.objectContaining({ configurationId: null, pluginName: null }),
    ]);
  });
});