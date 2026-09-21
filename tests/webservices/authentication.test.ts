import type { AddressInfo } from "node:net";
import http from "node:http";

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getByClientKey = vi.fn();
const validateSecret = vi.fn();
const recordUsage = vi.fn();
const getClient = vi.fn();
const isIpAllowed = vi.fn();
const wcRequest = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    wsClientCredentials: { getByClientKey, validateSecret, recordUsage },
    wsClients: { get: getClient },
    wsClientIpRules: { isIpAllowed },
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  logWsRequest: vi.fn(),
}));

vi.mock("../../server/services/webclient/client", () => ({
  wcRequest,
}));

const { createWebServiceAuthMiddleware } = await import(
  "../../server/middleware/webservice-auth"
);

const CREDENTIAL = {
  id: "credential-1",
  clientId: "client-1",
  clientKey: "public-client-id",
  isActive: true,
};

const NORMAL_CLIENT = {
  id: "client-1",
  name: "Normal partner",
  status: "active",
  ipAllowlistEnabled: false,
  data: {},
};

const FREEMAN_CLIENT = {
  ...NORMAL_CLIENT,
  name: "Freeman partner",
  data: { freemanBearerAuthorizationConfigId: "freeman-auth-config" },
};

let server: http.Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(createWebServiceAuthMiddleware());
  app.get("/protected", (_req, res) => res.json({ authenticated: true }));

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  getByClientKey.mockResolvedValue(CREDENTIAL);
  validateSecret.mockResolvedValue({ valid: true, credential: CREDENTIAL });
  recordUsage.mockResolvedValue(undefined);
  getClient.mockResolvedValue(NORMAL_CLIENT);
  isIpAllowed.mockResolvedValue(true);
  wcRequest.mockResolvedValue({
    value: { outcome: "success", success: true, status: 200 },
  });
});

async function call(headers: Record<string, string>) {
  const response = await fetch(`${origin}/protected`, { headers });
  return {
    status: response.status,
    body: await response.json(),
  };
}

describe("incoming web-service authentication", () => {
  it("accepts X-WS-Client-ID with the matching secret", async () => {
    const result = await call({
      "X-WS-Client-ID": "public-client-id",
      "X-WS-Client-Secret": "secret",
    });

    expect(result).toEqual({ status: 200, body: { authenticated: true } });
    expect(getByClientKey).toHaveBeenCalledWith("public-client-id");
    expect(validateSecret).toHaveBeenCalledWith("public-client-id", "secret");
    expect(recordUsage).toHaveBeenCalledWith("credential-1");
  });

  it("still accepts HTTP Basic for a normal client", async () => {
    const encoded = Buffer.from("public-client-id:secret").toString("base64");
    const result = await call({ Authorization: `Basic ${encoded}` });

    expect(result.status).toBe(200);
    expect(validateSecret).toHaveBeenCalledWith("public-client-id", "secret");
  });

  it("does not accept the retired X-WS-Client-Key header", async () => {
    const result = await call({
      "X-WS-Client-Key": "public-client-id",
      "X-WS-Client-Secret": "secret",
    });

    expect(result.body).toMatchObject({ code: "MISSING_CREDENTIALS" });
    expect(getByClientKey).not.toHaveBeenCalled();
    expect(validateSecret).not.toHaveBeenCalled();
  });

  it("uses the Freeman bearer as the only checked credential", async () => {
    getClient.mockResolvedValue(FREEMAN_CLIENT);
    getByClientKey.mockResolvedValue({ ...CREDENTIAL, isActive: false });

    const result = await call({
      "X-WS-Client-ID": "public-client-id",
      "X-WS-Client-Secret": "deliberately-wrong",
      Authorization: "Bearer valid-freeman-token",
    });

    expect(result.status).toBe(200);
    expect(validateSecret).not.toHaveBeenCalled();
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { configId: "freeman-auth-config" },
      operation: "sitespecific.freeman.authorization.bearer",
      args: { bearerCredential: "valid-freeman-token" },
    });
  });

  it("does not let Basic authentication replace a required Freeman bearer", async () => {
    getClient.mockResolvedValue(FREEMAN_CLIENT);
    const encoded = Buffer.from("public-client-id:secret").toString("base64");

    const result = await call({ Authorization: `Basic ${encoded}` });

    expect(result.body).toMatchObject({ code: "FREEMAN_BEARER_REQUIRED" });
    expect(validateSecret).not.toHaveBeenCalled();
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("fails closed when the configured Freeman verifier is unavailable", async () => {
    getClient.mockResolvedValue(FREEMAN_CLIENT);
    wcRequest.mockRejectedValue(new Error("component disabled"));

    const result = await call({
      "X-WS-Client-ID": "public-client-id",
      "X-WS-Client-Secret": "otherwise-valid-secret",
      Authorization: "Bearer valid-freeman-token",
    });

    expect(result.body).toMatchObject({
      code: "FREEMAN_AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(validateSecret).not.toHaveBeenCalled();
  });

  it("applies client status before spending a Freeman bearer request", async () => {
    getClient.mockResolvedValue({ ...FREEMAN_CLIENT, status: "inactive" });

    const result = await call({
      "X-WS-Client-ID": "public-client-id",
      Authorization: "Bearer valid-freeman-token",
    });

    expect(result.body).toMatchObject({ code: "CLIENT_INACTIVE" });
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("applies the client IP allowlist before spending a Freeman bearer request", async () => {
    getClient.mockResolvedValue({ ...FREEMAN_CLIENT, ipAllowlistEnabled: true });
    isIpAllowed.mockResolvedValue(false);

    const result = await call({
      "X-WS-Client-ID": "public-client-id",
      Authorization: "Bearer valid-freeman-token",
    });

    expect(result.body).toMatchObject({ code: "IP_NOT_ALLOWED" });
    expect(wcRequest).not.toHaveBeenCalled();
  });
});