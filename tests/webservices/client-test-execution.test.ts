import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeWsTestHttp, validateSecret, recordUsage } = vi.hoisted(() => ({
  executeWsTestHttp: vi.fn(),
  validateSecret: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("../../server/modules/webservices/test-request-http", () => ({ executeWsTestHttp }));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (name: string) => name === "PORT" ? "5000" : undefined,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/middleware/webservice-auth", () => ({
  requiresFreemanBearerAuthorization: () => false,
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { get: vi.fn(), getMany: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    wsClients: { get: async () => ({ id: "client-1", status: "active", data: null }) },
    wsClientCredentials: { validateSecret, recordUsage },
  },
}));

import { registerWebServiceAdminRoutes } from "../../server/modules/webservices/admin";
import { MaintenanceModeError } from "../../server/services/maintenance-flag";

type Handler = (req: any, res: any) => Promise<void>;
let handler: Handler;
const app = {
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  post: (path: string, ...handlers: Handler[]) => {
    if (path === "/api/admin/ws-clients/:id/test") handler = handlers.at(-1)!;
  },
};
registerWebServiceAdminRoutes(app as any, (() => {}) as any, (() => () => {}) as any);

async function execute(baseUrl = "/api/ws/") {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  await handler({
    params: { id: "client-1" },
    body: {
      baseUrl, clientKey: "remote-client", clientSecret: "remote-secret",
      method: "POST", configRef: "portable-alias", operation: "inspect",
      queryParams: { page: "2" }, body: { test: true },
    },
  }, res);
  return { data: json.mock.calls[0]?.[0], res };
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSecret.mockResolvedValue({ valid: true, credential: { id: "credential-1", clientId: "client-1", isActive: true } });
  executeWsTestHttp.mockResolvedValue({
    status: 200, statusText: "OK", headers: {},
    data: { result: "ok" },
  });
});

describe("admin web service test execution", () => {
  it("preserves local credential checks and usage counting", async () => {
    const { data } = await execute();
    expect(validateSecret).toHaveBeenCalledWith("remote-client", "remote-secret");
    expect(executeWsTestHttp).toHaveBeenCalledWith(
      "http://127.0.0.1:5000/api/ws/portable-alias/inspect?page=2",
      "POST", expect.objectContaining({ "X-WS-Client-Secret": "remote-secret" }),
      '{"test":true}', true,
    );
    expect(recordUsage).toHaveBeenCalledWith("credential-1");
    expect(data.requestInfo.url).toBe("/api/ws/portable-alias/inspect?page=2");
  });

  it("lets a remote server judge credentials without recording local usage", async () => {
    validateSecret.mockResolvedValue({ valid: false });
    const { data } = await execute("https://remote.example/gateway/ws/");
    expect(validateSecret).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(executeWsTestHttp).toHaveBeenCalledWith(
      "https://remote.example/gateway/ws/portable-alias/inspect?page=2",
      "POST", expect.anything(), '{"test":true}', false,
    );
    expect(data.requestInfo.url).toBe("https://remote.example/gateway/ws/portable-alias/inspect?page=2");
    expect(data.success).toBe(true);
  });

  it("relays remote refusal, but redacts echoed credentials", async () => {
    executeWsTestHttp.mockResolvedValue({
      status: 403, statusText: "remote-secret refused",
      headers: { "x-result": "remote-secret" },
      data: { message: "remote-secret refused" },
    });
    const { data } = await execute("https://remote.example/");
    expect(data.success).toBe(false);
    expect(data.status).toBe(403);
    expect(JSON.stringify(data)).not.toContain("remote-secret");
  });

  it("returns a safe connection error without leaking credentials", async () => {
    executeWsTestHttp.mockRejectedValue(new Error("remote-secret in low-level error"));
    const { data } = await execute("https://remote.example/");
    expect(data.success).toBe(false);
    expect(data.status).toBe(0);
    expect(JSON.stringify(data)).not.toContain("remote-secret");
  });

  it("preserves the shared maintenance refusal instead of reporting a remote outage", async () => {
    executeWsTestHttp.mockRejectedValue(new MaintenanceModeError("Web service test", "execute request"));
    const { data, res } = await execute("https://remote.example/");
    expect(res.status).toHaveBeenCalledWith(503);
    expect(data.maintenance).toBe(true);
    expect(recordUsage).not.toHaveBeenCalled();
  });
});