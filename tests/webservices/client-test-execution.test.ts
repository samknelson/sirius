import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeWsTestHttp, getClient, validateSecret, getByClientKey, recordUsage } = vi.hoisted(() => ({
  executeWsTestHttp: vi.fn(),
  getClient: vi.fn(),
  validateSecret: vi.fn(),
  getByClientKey: vi.fn(),
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
  requiresFreemanBearerAuthorization: (client: { data?: { freemanBearerAuthorizationConfigId?: string } }) =>
    Boolean(client.data?.freemanBearerAuthorizationConfigId),
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { get: vi.fn(), getMany: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    wsClients: { get: getClient },
    wsClientCredentials: { validateSecret, getByClientKey, recordUsage },
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

async function execute(baseUrl = "/api/ws/", overrides: Record<string, unknown> = {}) {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  await handler({
    params: { id: "client-1" },
    body: {
      baseUrl, clientKey: "remote-client", clientSecret: "remote-secret",
      method: "POST", configRef: "portable-alias", operation: "inspect",
      queryParams: { page: "2" }, body: { test: true },
      ...overrides,
    },
  }, res);
  return { data: json.mock.calls[0]?.[0], res };
}

beforeEach(() => {
  vi.clearAllMocks();
  getClient.mockResolvedValue({ id: "client-1", status: "active", data: null });
  validateSecret.mockResolvedValue({ valid: true, credential: { id: "credential-1", clientId: "client-1", isActive: true } });
  executeWsTestHttp.mockResolvedValue({
    status: 200, statusText: "OK", headers: {},
    data: { result: "ok" },
  });
});

describe("admin web service test execution", () => {
  it("sends the local request even for credentials not known to this database, then shows the target's 401", async () => {
    validateSecret.mockResolvedValue({ valid: false });
    executeWsTestHttp.mockResolvedValue({
      status: 401, statusText: "Unauthorized",
      headers: { "content-type": "application/json" },
      data: { error: "INVALID_CREDENTIALS", message: "The service refused the client ID" },
    });
    const { data } = await execute();
    expect(validateSecret).not.toHaveBeenCalled();
    expect(getByClientKey).not.toHaveBeenCalled();
    expect(executeWsTestHttp).toHaveBeenCalledWith(
      "http://127.0.0.1:5000/api/ws/portable-alias/inspect?page=2",
      "POST", expect.objectContaining({
        "X-WS-Client-ID": "remote-client",
        "X-WS-Client-Secret": "remote-secret",
        "Content-Type": "application/json",
      }),
      '{"test":true}', true,
    );
    expect(recordUsage).not.toHaveBeenCalled();
    expect(data.success).toBe(false);
    expect(data.status).toBe(401);
    expect(data.statusText).toBe("Unauthorized");
    expect(data.headers).toEqual({ "content-type": "application/json" });
    expect(data.data).toEqual({ error: "INVALID_CREDENTIALS", message: "The service refused the client ID" });
    expect(data.error).toBeUndefined();
    expect(data.requestInfo.url).toBe("/api/ws/portable-alias/inspect?page=2");
  });

  it("shows the destination's 403 even when the locally selected client is inactive", async () => {
    getClient.mockResolvedValue({ id: "client-1", status: "inactive", data: null });
    executeWsTestHttp.mockResolvedValue({
      status: 403, statusText: "Forbidden", headers: {},
      data: { message: "This target denied the request" },
    });
    const { data } = await execute();
    expect(validateSecret).not.toHaveBeenCalled();
    expect(executeWsTestHttp).toHaveBeenCalledOnce();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(data.status).toBe(403);
    expect(data.data).toEqual({ message: "This target denied the request" });
  });

  it("sends a bearer request without a local client-ID credential lookup", async () => {
    getClient.mockResolvedValue({
      id: "client-1", status: "active",
      data: { freemanBearerAuthorizationConfigId: "auth-config" },
    });
    getByClientKey.mockResolvedValue(null);
    const { data } = await execute("/api/ws/", { bearerToken: "entered-token" });
    expect(getByClientKey).not.toHaveBeenCalled();
    expect(validateSecret).not.toHaveBeenCalled();
    expect(executeWsTestHttp).toHaveBeenCalledWith(
      expect.any(String), "POST",
      expect.objectContaining({
        "X-WS-Client-ID": "remote-client",
        Authorization: "Bearer entered-token",
      }),
      expect.any(String), true,
    );
    expect(executeWsTestHttp.mock.calls[0][2]).not.toHaveProperty("X-WS-Client-Secret");
    expect(data.success).toBe(true);
  });

  it("sends the same GET headers as cURL without an unnecessary content type", async () => {
    await execute("/api/ws/", { method: "GET" });
    expect(executeWsTestHttp.mock.calls[0][2]).not.toHaveProperty("Content-Type");
    expect(executeWsTestHttp.mock.calls[0][3]).toBeUndefined();
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