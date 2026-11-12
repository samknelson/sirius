import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  variables: new Map<string, { id: string; name: string; value: unknown }>(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  getAllRoles: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    variables: {
      getByName: mocks.getByName,
      create: mocks.create,
      update: mocks.update,
    },
    users: { getAllRoles: mocks.getAllRoles },
  },
}));

vi.mock("../../server/auth", () => ({
  providerRegistry: {
    getAll: () => [{ type: "saml" }],
    getDefault: () => ({ type: "saml" }),
  },
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.header("x-test-admin") !== "yes") {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  },
}));

const { registerAuthSettingsRoutes } = await import("../../server/modules/auth-settings");

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAuthSettingsRoutes(app);
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
  mocks.variables.clear();
  mocks.getByName.mockReset().mockImplementation(async (name: string) => mocks.variables.get(name));
  mocks.create.mockReset().mockImplementation(async (input: { name: string; value: unknown }) => {
    const row = { id: `id-${input.name}`, ...input };
    mocks.variables.set(input.name, row);
    return row;
  });
  mocks.update.mockReset().mockImplementation(async (id: string, input: { value: unknown }) => {
    const row = Array.from(mocks.variables.values()).find((item) => item.id === id);
    if (!row) return undefined;
    const updated = { ...row, value: input.value };
    mocks.variables.set(row.name, updated);
    return updated;
  });
  mocks.getAllRoles.mockReset().mockResolvedValue([{ id: "role-1" }]);
});

describe("auth settings routes", () => {
  it("requires administrator access", async () => {
    const getResponse = await fetch(`${baseUrl}/api/admin/auth-settings`);
    const putResponse = await fetch(`${baseUrl}/api/admin/auth-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(getResponse.status).toBe(403);
    expect(putResponse.status).toBe(403);
    expect(mocks.getByName).not.toHaveBeenCalled();
  });

  it("returns disabled idle timeout defaults from its separate setting", async () => {
    const response = await fetch(`${baseUrl}/api/admin/auth-settings`, {
      headers: { "x-test-admin": "yes" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: [{ type: "saml", isDefault: true }],
      settings: { provisioning: {}, samlRoleMappings: [] },
      sessionIdleTimeout: { enabled: false, timeoutMinutes: 60 },
    });
  });

  it("validates and persists provider and idle settings in separate rows", async () => {
    const body = {
      settings: {
        provisioning: { saml: "create" },
        samlRoleMappings: [{ attribute: "groups", value: "staff", roleId: "role-1" }],
      },
      sessionIdleTimeout: { enabled: true, timeoutMinutes: 45 },
    };
    const response = await fetch(`${baseUrl}/api/admin/auth-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-admin": "yes" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    expect(mocks.variables.get("auth_settings")?.value).toEqual(body.settings);
    expect(mocks.variables.get("session_idle_timeout")?.value).toEqual(body.sessionIdleTimeout);
  });

  it("rejects malformed idle settings without writing either row", async () => {
    const response = await fetch(`${baseUrl}/api/admin/auth-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-admin": "yes" },
      body: JSON.stringify({
        settings: { provisioning: {}, samlRoleMappings: [] },
        sessionIdleTimeout: { enabled: true, timeoutMinutes: 1 },
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
