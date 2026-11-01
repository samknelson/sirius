import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setEnvironmentVariableOverrideSource,
} from "../../server/config/env-registry";

const mocks = vi.hoisted(() => ({
  hasAnyUsers: vi.fn(),
  getAllPermissions: vi.fn(),
  createRole: vi.fn(),
  assignPermissionToRole: vi.fn(),
  createUser: vi.fn(),
  assignRoleToUser: vi.fn(),
  ensureLocalAdminAccount: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { users: {
    hasAnyUsers: mocks.hasAnyUsers,
    getAllPermissions: mocks.getAllPermissions,
    createRole: mocks.createRole,
    assignPermissionToRole: mocks.assignPermissionToRole,
    createUser: mocks.createUser,
    assignRoleToUser: mocks.assignRoleToUser,
  } },
}));
vi.mock("../../server/auth/local-seed", () => ({
  ensureLocalAdminAccount: mocks.ensureLocalAdminAccount,
}));
import { registerBootstrapRoutes } from "../../server/modules/system/bootstrap";

let server: http.Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerBootstrapRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LOCAL_AUTH_EMAIL", "");
  vi.stubEnv("LOCAL_AUTH_PASSWORD_HASH", "");
  mocks.hasAnyUsers.mockResolvedValue(false);
  mocks.getAllPermissions.mockResolvedValue([{ key: "admin" }]);
  mocks.createRole.mockResolvedValue({ id: "role", name: "admin" });
  mocks.createUser.mockImplementation(async (data) => ({ id: "user", ...data }));
  mocks.ensureLocalAdminAccount.mockResolvedValue({});
});
afterEach(() => {
  setEnvironmentVariableOverrideSource(null);
  vi.unstubAllEnvs();
});
const post = (body: unknown = { email: "claimant@example.test" }) => fetch(`${baseUrl}/api/bootstrap`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const assertNoProvisioning = () => {
  for (const key of ["getAllPermissions", "createRole", "assignPermissionToRole",
    "createUser", "assignRoleToUser", "ensureLocalAdminAccount"] as const) {
    expect(mocks[key]).not.toHaveBeenCalled();
  }
};

describe("operator-managed public bootstrap refusal", () => {
  it.each([
    { email: "operator@example.test", hash: "", provider: "local" },
    { email: "operator@example.test", hash: "invalid-hash-canary", provider: "local" },
    { email: "operator@example.test", hash: "", provider: "saml" },
    { email: " not-an-email-canary ", hash: "", provider: "saml" },
  ])("blocks before database access regardless of reconciliation prerequisites: %j", async (config) => {
    vi.stubEnv("LOCAL_AUTH_EMAIL", config.email);
    vi.stubEnv("LOCAL_AUTH_PASSWORD_HASH", config.hash);
    vi.stubEnv("AUTH_PROVIDER", config.provider);
    vi.stubEnv("AUTH_LOCAL_ENABLED", "false");
    // Even unavailable storage must not reopen operator-managed provisioning.
    mocks.hasAnyUsers.mockRejectedValue(new Error("should not be queried"));
    const status = await fetch(`${baseUrl}/api/bootstrap/needed`);
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(await status.json()).toEqual({ needed: false });
    for (const body of [{ email: "claimant@example.test" }, { email: config.email.trim() },
      { email: config.email.trim().toUpperCase() }, {}]) {
      const response = await post(body);
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toContain("operator-managed");
      expect(text).not.toContain(config.email.trim());
      expect(text).not.toContain("hash-canary");
    }
    expect(mocks.hasAnyUsers).not.toHaveBeenCalled();
    assertNoProvisioning();
  });

  it.each(["", "__UNSET__", "   ", undefined])("preserves empty-database bootstrap when email is absent: %s", async (email) => {
    vi.stubEnv("LOCAL_AUTH_EMAIL", email);
    const status = await fetch(`${baseUrl}/api/bootstrap/needed`);
    expect(await status.json()).toEqual({ needed: true });
    const response = await post({ email: "first@example.test", firstName: "First", lastName: "Admin" });
    expect(response.status).toBe(200);
    expect((await response.json()).user.email).toBe("first@example.test");
    expect(mocks.createRole).toHaveBeenCalledOnce();
    expect(mocks.assignPermissionToRole).toHaveBeenCalledWith({ roleId: "role", permissionKey: "admin" });
    expect(mocks.assignRoleToUser).toHaveBeenCalledWith({ userId: "user", roleId: "role" });
    expect(mocks.ensureLocalAdminAccount).toHaveBeenCalledOnce();
  });

  it("preserves the existing-user refusal when email is unset", async () => {
    mocks.hasAnyUsers.mockResolvedValue(true);
    expect(await (await fetch(`${baseUrl}/api/bootstrap/needed`)).json()).toEqual({ needed: false });
    expect((await post()).status).toBe(403);
    assertNoProvisioning();
  });

  it("preserves missing-email validation for an available bootstrap", async () => {
    expect((await post({})).status).toBe(400);
    assertNoProvisioning();
  });

  it("fails closed on a users-table read failure", async () => {
    mocks.hasAnyUsers.mockRejectedValue(new Error("database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await fetch(`${baseUrl}/api/bootstrap/needed`)).status).toBe(500);
      expect((await post()).status).toBe(500);
      assertNoProvisioning();
    } finally { log.mockRestore(); }
  });

  it("honors effective overrides and deployment precedence without retaining an earlier decision", async () => {
    setEnvironmentVariableOverrideSource((name) => name === "LOCAL_AUTH_EMAIL" ? "stored@example.test" : undefined);
    expect((await post()).status).toBe(403);
    vi.stubEnv("LOCAL_AUTH_EMAIL", "deployed@example.test");
    setEnvironmentVariableOverrideSource(() => "");
    expect((await post()).status).toBe(403);
    vi.stubEnv("LOCAL_AUTH_EMAIL", "__UNSET__");
    expect(await (await fetch(`${baseUrl}/api/bootstrap/needed`)).json()).toEqual({ needed: true });
    setEnvironmentVariableOverrideSource(() => "stored@example.test");
    expect(await (await fetch(`${baseUrl}/api/bootstrap/needed`)).json()).toEqual({ needed: false });
    assertNoProvisioning();
  });
});
