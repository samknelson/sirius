import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysYmd, getTodayYmd } from "@shared/utils/date";

const getByKind = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const countsByConfiguration = vi.hoisted(() => vi.fn());
const checker = vi.hoisted(() => vi.fn());
const getWcVendorPlugin = vi.hoisted(() => vi.fn());
const wcRequest = vi.hoisted(() => vi.fn());

const readOperation = {
  description: "read a value",
  needsWritableDatabase: false,
  externalSideEffect: false,
  cacheMode: "cached" as const,
  manualRun: {
    argsSchema: {
      type: "object",
      properties: {
        value: { type: "string", minLength: 1 },
        mode: { type: "string", default: "safe" },
      },
      required: ["value"],
      additionalProperties: false,
    },
    effect: "read" as const,
  },
};
const privateOperation = {
  description: "private operation",
  needsWritableDatabase: false,
  externalSideEffect: false,
  cacheMode: "uncached" as const,
};
const writeOperation = {
  description: "write a value",
  needsWritableDatabase: true,
  externalSideEffect: true,
  cacheMode: "uncached" as const,
  manualRun: {
    argsSchema: {
      type: "object",
      properties: { value: { type: "string", minLength: 1 } },
      required: ["value"],
      additionalProperties: false,
    },
    effect: "write" as const,
  },
};

const plugins = {
  fixture: {
    id: "fixture",
    name: "Fixture Vendor",
    service: "Google",
    operations: {
      "service.test-connection": {
        description: "test the fixture connection",
        needsWritableDatabase: false,
        cacheMode: "uncached" as const,
        externalSideEffect: false,
      },
      "tests.read": readOperation,
      "tests.private": privateOperation,
      "tests.write": writeOperation,
    },
  },
  gated: {
    id: "gated",
    name: "Gated Vendor",
    service: "T631",
    requiredComponent: "fixture.component",
    operations: {
      "service.test-connection": {
        description: "test the gated connection",
        needsWritableDatabase: false,
        cacheMode: "uncached" as const,
        externalSideEffect: false,
      },
      "tests.read": readOperation,
    },
  },
};

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: { getByKind, get: getConfig },
    wcStats: { countsByConfiguration },
  },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getComponentChecker: () => checker,
}));
vi.mock("../../server/plugins/wc-vendors", () => ({
  getWcVendorPlugin,
  getWcVendorOperationManifest: (plugin: typeof plugins.fixture) =>
    Object.entries(plugin.operations).map(([id, operation]) => {
      const declared = operation as
        | typeof readOperation
        | typeof privateOperation
        | typeof writeOperation;
      return {
      id,
      description: declared.description,
      needsWritableDatabase: declared.needsWritableDatabase,
      externalSideEffect: declared.externalSideEffect ?? true,
      cacheMode: declared.cacheMode,
      ...("manualRun" in declared && declared.manualRun
        ? { manualRun: declared.manualRun }
        : {}),
      };
    }),
}));
vi.mock("../../server/services/webclient", () => ({ wcRequest }));

const { registerWcVendorRoutes } =
  await import("../../server/modules/system/wc-vendors");

let server: http.Server;
let baseUrl: string;

function config(id: string, pluginId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pluginKind: "wc-vendors",
    pluginId,
    enabled: true,
    name: id,
    data: {},
    ...overrides,
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerWcVendorRoutes(app);
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
  getByKind.mockReset();
  getConfig.mockReset();
  countsByConfiguration.mockReset();
  checker.mockReset().mockResolvedValue(true);
  getWcVendorPlugin.mockReset().mockImplementation((id: string) => plugins[id as keyof typeof plugins]);
  wcRequest.mockReset().mockResolvedValue({
    source: "network",
    outcome: "success",
    fresh: true,
    value: { accepted: true },
    fetchedAt: new Date("2026-09-13T12:00:00.000Z"),
  });
  getByKind.mockResolvedValue([
    config("good", "fixture", {
      data: {
        operations: ["tests.read", "tests.read", "tests.undeclared"],
      },
    }),
    config("disabled", "fixture", {
      enabled: false,
      data: { operations: ["tests.read"] },
    }),
    config("gated", "gated", { data: { operations: ["tests.read"] } }),
  ]);
  countsByConfiguration.mockResolvedValue([
    {
      configurationId: "good",
      service: "Google",
      requestType: "tests.read",
      calls: 11,
      todayCalls: 3,
    },
  ]);
});

async function getOverview() {
  const response = await fetch(`${baseUrl}/api/admin/wc-overview`);
  return { status: response.status, body: await response.json() };
}

async function postRun(
  configId: string,
  operation: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `${baseUrl}/api/admin/wc-overview/${configId}/${operation}/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

describe("WC overview route", () => {
  it("returns zero-call operations and exact config-attributed today/7-day totals", async () => {
    checker.mockResolvedValue(false);
    const { status, body } = await getOverview();

    expect(status).toBe(200);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        configurationId: "good",
        requestType: "tests.read",
        service: "Google",
        isVendorDefault: true,
        isAnyVendorDefault: true,
        callsToday: 3,
        callsLast7Days: 11,
      }),
      expect.objectContaining({
        configurationId: "good",
        requestType: "tests.private",
        isVendorDefault: true,
        isAnyVendorDefault: false,
        callsToday: 0,
        callsLast7Days: 0,
      }),
      expect.objectContaining({
        configurationId: "good",
        requestType: "tests.write",
        callsToday: 0,
        callsLast7Days: 0,
      }),
    ]));
    expect(body).toHaveLength(4);
    expect(body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ configurationId: "disabled" }),
        expect.objectContaining({ configurationId: "gated" }),
      ]),
    );
    expect(countsByConfiguration).toHaveBeenCalledWith(
      {
        configurationIds: ["good"],
        end: getTodayYmd(),
        start: addDaysYmd(getTodayYmd(), -6),
      },
    );
  });

  it("marks no default when vendor and any-vendor selection are ambiguous", async () => {
    getByKind.mockResolvedValue([
      config("first", "fixture", { data: { operations: ["tests.read"] } }),
      config("second", "fixture", { data: { operations: ["tests.read"] } }),
    ]);
    countsByConfiguration.mockResolvedValue([]);

    const { status, body } = await getOverview();

    expect(status).toBe(200);
    const readRows = body.filter((row: any) => row.requestType === "tests.read");
    expect(readRows).toHaveLength(2);
    expect(readRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          configurationId: "first",
          isVendorDefault: false,
          isAnyVendorDefault: false,
        }),
        expect.objectContaining({
          configurationId: "second",
          isVendorDefault: false,
          isAnyVendorDefault: false,
        }),
      ]),
    );
  });

  it("shows a different any-vendor default for the same request type", async () => {
    getByKind.mockResolvedValue([
      config("external", "fixture"),
      config("local", "gated", { data: { operations: ["tests.read"] } }),
    ]);
    countsByConfiguration.mockResolvedValue([]);

    const { status, body } = await getOverview();

    expect(status).toBe(200);
    const readRows = body.filter((row: any) => row.requestType === "tests.read");
    expect(readRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          configurationId: "external",
          isVendorDefault: true,
          isAnyVendorDefault: false,
        }),
        expect.objectContaining({
          configurationId: "local",
          isVendorDefault: true,
          isAnyVendorDefault: true,
        }),
      ]),
    );
  });

  it("excludes disabled and component-gated configurations", async () => {
    checker.mockResolvedValue(false);
    const { status, body } = await getOverview();
    expect(status).toBe(200);
    expect(body).toHaveLength(4);
    expect(body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ configurationId: "gated" })]),
    );
    expect(countsByConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ configurationIds: ["good"] }),
    );
  });
});

describe("WC manual operation route", () => {
  beforeEach(() => {
    getByKind.mockResolvedValue([config("good", "fixture")]);
  });

  it.each([
    ["wrong kind", config("wrong", "fixture", { pluginKind: "other" }), "wrong", "tests.read", 404],
    ["missing", undefined, "missing", "tests.read", 404],
    ["disabled", config("disabled", "fixture", { enabled: false }), "disabled", "tests.read", 409],
  ])("rejects %s config ownership/state", async (_label, row, id, operation, status) => {
    getConfig.mockResolvedValue(row);
    const result = await postRun(id, operation, { args: { value: "x" } });
    expect(result.status).toBe(status);
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("rejects component-gated, non-runnable, and malformed operations", async () => {
    getConfig.mockResolvedValue(config("gated", "gated"));
    checker.mockResolvedValue(false);
    expect((await postRun("gated", "tests.read", { args: { value: "x" } })).status).toBe(403);

    getConfig.mockResolvedValue(config("good", "fixture"));
    checker.mockResolvedValue(true);
    expect((await postRun("good", "tests.private", { args: {} })).status).toBe(409);
    expect((await postRun("good", "tests.read", { args: {} })).status).toBe(400);
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("requires write confirmation", async () => {
    getConfig.mockResolvedValue(config("good", "fixture"));
    const result = await postRun("good", "tests.write", { args: { value: "x" } });
    expect(result.status).toBe(400);
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("calls wcRequest once through the explicit config and returns the complete WcResult", async () => {
    const row = config("good", "fixture");
    getConfig.mockResolvedValue(row);
    const args = { value: "x" };
    const result = await postRun("good", "tests.read", { args });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      source: "network",
      outcome: "success",
      fresh: true,
      value: { accepted: true },
    });
    expect(wcRequest).toHaveBeenCalledTimes(1);
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { configId: "good" },
      operation: "tests.read",
      args: { value: "x", mode: "safe" },
    });
    expect(args).toEqual({ value: "x" });
  });

  it("forces cached manual operations and rejects force mode for uncached ones", async () => {
    getConfig.mockResolvedValue(config("good", "fixture"));

    expect(
      (await postRun("good", "tests.read", {
        args: { value: "x" },
        forceFresh: true,
      })).status,
    ).toBe(200);
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { configId: "good" },
      operation: "tests.read",
      args: { value: "x", mode: "safe" },
      mode: "force",
    });

    wcRequest.mockClear();
    const rejected = await postRun("good", "tests.write", {
      args: { value: "x" },
      confirmedWrite: true,
      forceFresh: true,
    });
    expect(rejected.status).toBe(400);
    expect(wcRequest).not.toHaveBeenCalled();
  });
});